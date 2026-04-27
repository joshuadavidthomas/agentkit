import { buildSessionContext, type SessionEntry } from "@mariozechner/pi-coding-agent";
import type { SessionContinuity, SessionManager } from "./session.js";
import { debug } from "./sdk/debug.js";

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      parts.push("[Image attached]");
      continue;
    }

    if (block.type === "toolCall") {
      const name = typeof block.name === "string" ? block.name : "tool";
      const args = block.arguments ? JSON.stringify(block.arguments) : "{}";
      parts.push(`[Tool call ${name} ${args}]`);
    }
  }

  return parts.join("\n").trim();
}

function formatAgentMessageForHandoff(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;

  if (entry.role === "user") {
    const text = extractContentText(entry.content);
    return text ? `User:\n${text}` : undefined;
  }

  if (entry.role === "assistant") {
    const text = extractContentText(entry.content);
    return text ? `Assistant:\n${text}` : undefined;
  }

  if (entry.role === "toolResult") {
    const toolName = typeof entry.toolName === "string" ? entry.toolName : "tool";
    const text = extractContentText(entry.content);
    const prefix = entry.isError ? `Tool result (${toolName}, error):` : `Tool result (${toolName}):`;
    return text ? `${prefix}\n${text}` : prefix;
  }

  if (entry.role === "bashExecution") {
    const command = typeof entry.command === "string" ? entry.command : "";
    const output = typeof entry.output === "string" ? entry.output : "";
    return `Ran \`${command}\`\n\n${output || "(no output)"}`;
  }

  if (entry.role === "custom") {
    const text = extractContentText(entry.content);
    return text ? `Context:\n${text}` : undefined;
  }

  if (entry.role === "compactionSummary" && typeof entry.summary === "string") {
    return `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  if (entry.role === "branchSummary" && typeof entry.summary === "string") {
    return `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  return undefined;
}

function joinHandoffSections(title: string, sections: string[]): string | undefined {
  const cleaned = sections.map((section) => section.trim()).filter(Boolean);
  if (cleaned.length === 0) return undefined;

  return `${title}\n\nUse this as authoritative prior conversation history for continuity. The user's next message follows in a separate turn.\n\n${cleaned.join("\n\n")}`;
}

function findCurrentPromptIndex(branch: SessionEntry[]): number {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message.role === "user") {
      return i;
    }
  }
  return -1;
}

function buildFreshSeedHandoff(sessionManager: SessionManager, currentPromptIndex: number): string | undefined {
  const branch = sessionManager.getBranch();
  const targetLeafId = currentPromptIndex > 0 ? branch[currentPromptIndex - 1]?.id ?? null : null;
  const visible = buildSessionContext(sessionManager.getEntries(), targetLeafId).messages;
  const sections = visible.map((message) => formatAgentMessageForHandoff(message)).filter(Boolean) as string[];
  const handoff = joinHandoffSections("Pi session handoff for Claude Agent SDK:", sections);

  debug("handoff:freshSeed", {
    branchLength: branch.length,
    currentPromptIndex,
    targetLeafId,
    visibleMessages: visible.length,
    sections: sections.length,
    bytes: handoff?.length ?? 0,
  });

  return handoff;
}

export function hasSyncedEntryOnCurrentBranch(sessionManager: SessionManager, continuity: SessionContinuity): boolean {
  if (!continuity.syncedThroughEntryId) return false;
  const branch = sessionManager.getBranch();
  const found = branch.some((entry) => entry.id === continuity.syncedThroughEntryId);
  debug("handoff:hasSyncedEntryOnCurrentBranch", {
    syncedThroughEntryId: continuity.syncedThroughEntryId,
    branchLength: branch.length,
    found,
  });
  return found;
}

export function buildPiSessionHandoff(
  sessionManager: SessionManager | undefined,
): string | undefined {
  if (!sessionManager) {
    debug("handoff:buildPiSessionHandoff", { skipped: "no-session-manager" });
    return undefined;
  }

  const branch = sessionManager.getBranch();
  const currentPromptIndex = findCurrentPromptIndex(branch);

  debug("handoff:buildPiSessionHandoff", {
    branchLength: branch.length,
    currentPromptIndex,
  });
  return buildFreshSeedHandoff(sessionManager, currentPromptIndex);
}

export function buildContextMessagesHandoff(messages: unknown[]): string | undefined {
  let currentPromptIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && typeof message === "object" && (message as { role?: unknown }).role === "user") {
      currentPromptIndex = i;
      break;
    }
  }

  const priorMessages = currentPromptIndex >= 0 ? messages.slice(0, currentPromptIndex) : messages;
  const sections = priorMessages.map((message) => formatAgentMessageForHandoff(message)).filter(Boolean) as string[];
  const handoff = joinHandoffSections("Pi context handoff for Claude Agent SDK:", sections);

  debug("handoff:contextFallback", {
    totalMessages: messages.length,
    priorMessages: priorMessages.length,
    sections: sections.length,
    bytes: handoff?.length ?? 0,
  });

  return handoff;
}
