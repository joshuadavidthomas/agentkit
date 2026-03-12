// ask_user_question tool — model-callable tool for asking the user questions mid-turn.
// Uses the same QnAComponent as the /answer command.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";

import type { ExtractedQuestion } from "./extract.ts";
import { QnAComponent, renderQAPairs } from "./components.ts";

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
      questions: Type.Array(
        Type.Object({
          question: Type.String({ description: "The question to ask the user" }),
          context: Type.Optional(
            Type.String({ description: "Context that helps the user answer the question" }),
          ),
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
        { description: "One or more questions to ask the user" },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { questions } = params as {
        questions: Array<{
          question: string;
          context?: string;
          options?: string[];
          allowCustom?: boolean;
        }>;
      };

      if (!ctx.hasUI) {
        return { content: [{ type: "text" as const, text: "User cancelled." }] };
      }

      const extracted: ExtractedQuestion[] = questions.map((q) => ({
        question: q.question,
        context: q.context,
        options: q.options && q.options.length > 0 ? q.options : undefined,
        allowCustom: q.allowCustom ?? true,
      }));

      const result = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
        return new QnAComponent(extracted, tui, done);
      });

      if (result === null) {
        return { content: [{ type: "text" as const, text: "User cancelled." }] };
      }

      // Parse Q&A pairs from the component output
      const qaPairs: QAPair[] = [];
      const qBlocks = result.split(/(?=^Q: )/m).filter((b) => b.trim());
      for (let i = 0; i < qBlocks.length; i++) {
        const block = qBlocks[i];
        const qMatch = block.match(/^Q:\s*(.+)$/m);
        const aMatch = block.match(/^A:\s*(.+)$/m);
        if (qMatch && aMatch) {
          qaPairs.push({
            question: qMatch[1].trim(),
            options: extracted[i]?.options,
            answer: aMatch[1].trim(),
          });
        }
      }

      return {
        content: [{ type: "text" as const, text: result }],
        details: { qaPairs } as AskUserDetails,
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

      const qaTheme = {
        dim: (s: string) => theme.fg("dim", s),
        accent: (s: string) => theme.fg("accent", s),
        italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
      };
      const lines = renderQAPairs(details.qaPairs, qaTheme);
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
