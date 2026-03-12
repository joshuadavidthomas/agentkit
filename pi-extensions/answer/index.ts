// Answer extension — /answer command (user-initiated Q&A extraction) and
// ask_user_question tool (model-initiated questions).

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader } from "@mariozechner/pi-coding-agent";

import { type ExtractionResult, extractQuestions, selectExtractionModel } from "./extract.ts";
import { QnAComponent } from "./qna-component.ts";
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

    // Send the answers directly as a message and trigger a turn
    pi.sendMessage(
      {
        customType: "answers",
        content: "I answered your questions in the following way:\n\n" + answersResult,
        display: true,
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

  registerAskUserTool(pi);
}
