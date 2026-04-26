import { buildSessionContext, type SessionEntry } from "@mariozechner/pi-coding-agent";
import { CONTINUITY_ENTRY_TYPE, type SessionContinuity } from "./continuity.js";

export interface HandoffSessionReader {
  getBranch(): SessionEntry[];
  getEntries(): SessionEntry[];
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

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
      const args = block.arguments ? truncateText(JSON.stringify(block.arguments), 800) : "{}";
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
    return text ? `User:\n${truncateText(text, 4000)}` : undefined;
  }

  if (entry.role === "assistant") {
    const text = extractContentText(entry.content);
    return text ? `Assistant:\n${truncateText(text, 4000)}` : undefined;
  }

  if (entry.role === "toolResult") {
    const toolName = typeof entry.toolName === "string" ? entry.toolName : "tool";
    const text = extractContentText(entry.content);
    const prefix = entry.isError ? `Tool result (${toolName}, error):` : `Tool result (${toolName}):`;
    return text ? `${prefix}\n${truncateText(text, 4000)}` : prefix;
  }

  if (entry.role === "bashExecution") {
    const command = typeof entry.command === "string" ? entry.command : "";
    const output = typeof entry.output === "string" ? entry.output : "";
    return truncateText(`Ran \`${command}\`\n\n${output || "(no output)"}`, 4000);
  }

  if (entry.role === "custom") {
    const text = extractContentText(entry.content);
    return text ? `Context:\n${truncateText(text, 4000)}` : undefined;
  }

  if (entry.role === "compactionSummary" && typeof entry.summary === "string") {
    return `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  if (entry.role === "branchSummary" && typeof entry.summary === "string") {
    return `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  return undefined;
}

function formatSessionEntryForHandoff(entry: SessionEntry): string | undefined {
  if (entry.type === "message") {
    return formatAgentMessageForHandoff(entry.message);
  }

  if (entry.type === "custom_message") {
    const text = extractContentText(entry.content);
    return text ? `Context:\n${truncateText(text, 4000)}` : undefined;
  }

  if (entry.type === "model_change") {
    return `Model switched to ${entry.provider}/${entry.modelId}.`;
  }

  if (entry.type === "compaction") {
    return `The Pi session compacted part of this interval into the following summary:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  if (entry.type === "branch_summary") {
    return `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${entry.summary}\n</summary>`;
  }

  return undefined;
}

function joinHandoffSections(title: string, sections: string[]): string | undefined {
  const cleaned = sections.map((section) => section.trim()).filter(Boolean);
  if (cleaned.length === 0) return undefined;

  return truncateText(
    `${title}\n\nUse this as authoritative prior conversation history for continuity. Do not answer this handoff by itself; answer only the current user message that follows.\n\n${cleaned.join("\n\n")}`,
    20000,
  );
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

function buildFreshSeedHandoff(sessionManager: HandoffSessionReader, currentPromptIndex: number): string | undefined {
  const branch = sessionManager.getBranch();
  const targetLeafId = currentPromptIndex > 0 ? branch[currentPromptIndex - 1]?.id ?? null : null;
  const visible = buildSessionContext(sessionManager.getEntries(), targetLeafId).messages;
  const sections = visible.map((message) => formatAgentMessageForHandoff(message)).filter(Boolean) as string[];

  return joinHandoffSections("Pi session handoff for Claude Agent SDK:", sections);
}

function buildDeltaHandoff(
  sessionManager: HandoffSessionReader,
  branch: SessionEntry[],
  currentPromptIndex: number,
  syncedThroughEntryId: string,
): string | undefined {
  const endIndex = currentPromptIndex >= 0 ? currentPromptIndex : branch.length;
  const syncedIndex = branch.findIndex((entry) => entry.id === syncedThroughEntryId);
  if (syncedIndex < 0 || syncedIndex > endIndex) {
    return buildFreshSeedHandoff(sessionManager, currentPromptIndex);
  }

  const sections: string[] = [];
  for (const entry of branch.slice(syncedIndex + 1, endIndex)) {
    if (entry.type === "custom" && entry.customType === CONTINUITY_ENTRY_TYPE) continue;

    const section = formatSessionEntryForHandoff(entry);
    if (!section) continue;

    if (entry.type === "compaction") {
      sections.length = 0;
    }

    sections.push(section);
  }

  return joinHandoffSections("Pi session handoff since Claude Agent SDK last synced:", sections);
}

export function hasSyncedEntryOnCurrentBranch(sessionManager: HandoffSessionReader, continuity: SessionContinuity): boolean {
  if (!continuity.syncedThroughEntryId) return false;
  return sessionManager.getBranch().some((entry) => entry.id === continuity.syncedThroughEntryId);
}

export function buildPiSessionHandoff(
  sessionManager: HandoffSessionReader | undefined,
  continuity: SessionContinuity,
): string | undefined {
  if (!sessionManager) return undefined;

  const branch = sessionManager.getBranch();
  const currentPromptIndex = findCurrentPromptIndex(branch);

  if (!continuity.sdkSessionId || !continuity.syncedThroughEntryId) {
    return buildFreshSeedHandoff(sessionManager, currentPromptIndex);
  }

  return buildDeltaHandoff(sessionManager, branch, currentPromptIndex, continuity.syncedThroughEntryId);
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

  return joinHandoffSections("Pi context handoff for Claude Agent SDK:", sections);
}
