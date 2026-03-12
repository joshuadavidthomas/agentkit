// ask_user_question tool — model-callable tool for asking the user a question mid-turn.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function registerAskUserTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User",
    description:
      "Ask the user a question and wait for their answer. Use when you need user input, a decision, or clarification before proceeding. Supports free-text input or selectable choices.",
    parameters: Type.Object({
      question: Type.String({ description: "The question to ask the user" }),
      options: Type.Optional(
        Type.Array(Type.String(), { description: "Selectable choices to present to the user" }),
      ),
      allowCustom: Type.Optional(
        Type.Boolean({
          description:
            'When options are provided, whether to also allow free-text input (adds an "Other" option). Defaults to true.',
          default: true,
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { question, options, allowCustom = true } = params as {
        question: string;
        options?: string[];
        allowCustom?: boolean;
      };

      if (!ctx.hasUI) {
        return { content: [{ type: "text" as const, text: "User cancelled." }] };
      }

      let answer: string | undefined;

      if (!options || options.length === 0) {
        answer = await ctx.ui.input(question);
      } else if (allowCustom) {
        const OTHER = "Other";
        const choice = await ctx.ui.select(question, [...options, OTHER]);
        if (choice === OTHER) {
          answer = await ctx.ui.input("Your answer:");
        } else {
          answer = choice;
        }
      } else {
        answer = await ctx.ui.select(question, options);
      }

      if (answer === undefined) {
        return { content: [{ type: "text" as const, text: "User cancelled." }] };
      }

      return { content: [{ type: "text" as const, text: answer }] };
    },
  });
}
