/**
 * Pre-tool hook to run `dcg` before any bash tool call.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") {
      return;
    }

    try {
      await pi.exec("dcg", [], { cwd: ctx.cwd });
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`dcg failed: ${message}`, "warning");
      }
    }
  });
}
