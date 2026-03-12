// Answer extension — /answer command (user-initiated Q&A extraction) and
// ask_user_question tool (model-initiated questions).

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import { type ExtractionResult, extractQuestions, selectExtractionModel } from "./extract.ts";
import { QnAComponent, renderQAPairs } from "./components.ts";
import { registerAskUserTool } from "./ask-user.ts";

export default function (pi: ExtensionAPI) {
  const answerHandler = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      ctx.ui.notify("answer requires interactive mode", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected", "error");
      return;
    }

    // Find the last assistant message on the current branch
    const branch = ctx.sessionManager.getBranch();
    let lastAssistantText: string | undefined;

    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry.type === "message") {
        const msg = entry.message;
        if ("role" in msg && msg.role === "assistant") {
          if (msg.stopReason !== "stop") {
            ctx.ui.notify(`Last assistant message incomplete (${msg.stopReason})`, "error");
            return;
          }
          const textParts = msg.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
            break;
          }
        }
      }
    }

    if (!lastAssistantText) {
      ctx.ui.notify("No assistant messages found", "error");
      return;
    }

    // Select the best model for extraction (prefer Codex mini, then haiku)
    const extractionModel = await selectExtractionModel(ctx.model, ctx.modelRegistry);

    // Run extraction with loader UI
    const extractionResult = await ctx.ui.custom<ExtractionResult | null>((tui, theme, _kb, done) => {
      const loader = new BorderedLoader(tui, theme, `Extracting questions using ${extractionModel.id}...`);
      loader.onAbort = () => done(null);

      const doExtract = async () => {
        const apiKey = await ctx.modelRegistry.getApiKey(extractionModel);
        return extractQuestions(lastAssistantText!, extractionModel, apiKey, loader.signal);
      };

      doExtract()
        .then(done)
        .catch(() => done(null));

      return loader;
    });

    if (extractionResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    if (extractionResult.questions.length === 0) {
      ctx.ui.notify("No questions found in the last message", "info");
      return;
    }

    // Show the Q&A component
    const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
      return new QnAComponent(extractionResult.questions, tui, done);
    });

    if (answersResult === null) {
      ctx.ui.notify("Cancelled", "info");
      return;
    }

    // Parse Q&A pairs from the component output
    const qaPairs: Array<{ question: string; answer: string }> = [];
    const qBlocks = answersResult.split(/(?=^Q: )/m).filter((b) => b.trim());
    for (const block of qBlocks) {
      const qMatch = block.match(/^Q:\s*(.+)$/m);
      const aMatch = block.match(/^A:\s*([\s\S]+)/m);
      if (qMatch && aMatch) {
        qaPairs.push({ question: qMatch[1].trim(), answer: aMatch[1].trim() });
      }
    }

    // Send the answers as a message and trigger a turn
    pi.sendMessage(
      {
        customType: "answers",
        content: "I answered your questions in the following way:\n\n" + answersResult,
        display: true,
        details: { qaPairs },
      },
      { triggerTurn: true },
    );
  };

  pi.registerCommand("answer", {
    description: "Extract questions from last assistant message into interactive Q&A",
    handler: (_args, ctx) => answerHandler(ctx),
  });

  pi.registerShortcut("ctrl+.", {
    description: "Extract and answer questions",
    handler: answerHandler,
  });

  pi.registerMessageRenderer("answers", (message, _options, theme) => {
    const details = message.details as { qaPairs: Array<{ question: string; answer: string }> } | undefined;
    if (!details?.qaPairs?.length) return undefined;

    const box = new Box(1, 1, (t: string) => theme.bg("toolSuccessBg", t));
    box.addChild(new Text(theme.fg("toolTitle", theme.bold("answer")), 0, 0));
    box.addChild(renderQAPairs(details.qaPairs, {
      dim: (s: string) => theme.fg("dim", s),
      accent: (s: string) => theme.fg("accent", s),
      italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
    }));
    return box;
  });

  registerAskUserTool(pi);
}
