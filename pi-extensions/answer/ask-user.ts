// ask_user_question tool — model-callable tool for asking the user a question mid-turn.
// Uses the same QnAComponent as the /answer command.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

import type { ExtractedQuestion } from "./extract.ts";
import { QnAComponent } from "./qna-component.ts";

interface QAPair {
  question: string;
  options?: string[];
  answer: string;
}

interface AskUserDetails {
  qaPairs: QAPair[];
}

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

      const q: ExtractedQuestion = {
        question,
        options: options && options.length > 0 ? options : undefined,
        allowCustom,
      };

      const result = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
        return new QnAComponent([q], tui, done);
      });

      if (result === null) {
        return { content: [{ type: "text" as const, text: "User cancelled." }] };
      }

      const answerMatch = result.match(/^A:\s*(.*)$/m);
      const answer = answerMatch ? answerMatch[1].trim() : result;

      return {
        content: [{ type: "text" as const, text: answer }],
        details: {
          qaPairs: [{
            question,
            options: options && options.length > 0 ? options : undefined,
            answer,
          }],
        } as AskUserDetails,
      };
    },

    renderCall(_args: any, theme: any) {
      return new Text(theme.fg("toolTitle", theme.bold("ask_user_question")), 0, 0);
    },

    renderResult(result: any, _options: any, theme: any) {
      const details = result.details as AskUserDetails | undefined;
      if (!details) {
        const text = result.content?.[0];
        return new Text(text?.text ?? "(no output)", 0, 0);
      }

      const lines: string[] = [];
      for (const qa of details.qaPairs) {
        lines.push(theme.fg("dim", "Q: ") + qa.question);
        if (qa.options && qa.options.length > 0) {
          lines.push(theme.fg("dim", `   Options: ${qa.options.join(", ")}`));
        }
        lines.push(theme.fg("accent", "A: ") + qa.answer);
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
