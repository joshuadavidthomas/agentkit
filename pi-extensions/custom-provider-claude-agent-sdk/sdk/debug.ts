import { appendFileSync } from "node:fs";

export function debug(message: string, data?: Record<string, unknown>) {
  if (!process.env.PI_CLAUDE_AGENT_SDK_DEBUG) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[${new Date().toISOString()}] ${message}${suffix}\n`;
  try {
    appendFileSync("/tmp/pi-claude-agent-sdk-provider.log", line);
  } catch {
    // Ignore debug logging failures.
  }
}
