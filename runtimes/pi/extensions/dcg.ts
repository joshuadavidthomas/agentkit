/**
 * Pre-tool hook to run `dcg` in hook mode before any bash tool call.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const escapeForSingleQuotes = (value: string) => value.replace(/'/g, "'\"'\"'");

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") {
      return;
    }

    const command = event.input?.command ?? "";
    const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
    const escapedPayload = escapeForSingleQuotes(payload);

    try {
      const { stdout } = await pi.exec(
        "bash",
        ["-c", `printf '%s' '${escapedPayload}' | dcg`],
        { cwd: ctx.cwd }
      );

      const output = stdout.trim();
      if (!output) {
        return;
      }

      try {
        const parsed = JSON.parse(output) as {
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
        };
        const decision = parsed.hookSpecificOutput?.permissionDecision;
        if (decision === "deny") {
          const reason = parsed.hookSpecificOutput?.permissionDecisionReason ?? output;
          if (ctx.hasUI) {
            ctx.ui.notify("dcg blocked this bash command.", "warning");
          }
          return { block: true, reason };
        }
      } catch (parseError) {
        if (ctx.hasUI) {
          ctx.ui.notify("dcg returned non-JSON output; allowing command.", "warning");
        }
      }
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`dcg failed: ${message}`, "warning");
      }
    }
  });
}
