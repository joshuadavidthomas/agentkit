import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SESSION_ENTRY_TYPE = "claude-agent-sdk-session";
const LEGACY_V3_SESSION_ENTRY_TYPE = "claude-agent-sdk-v3-session";

export function isClaudeAgentSdkSessionEntryType(customType: string | undefined): boolean {
  return customType === SESSION_ENTRY_TYPE || customType === LEGACY_V3_SESSION_ENTRY_TYPE;
}

export interface SessionEntryData {
  sdkSessionId: string | null;
  syncedThroughEntryId: string | null;
  lastClaudeModelId: string | null;
}

interface SessionEntryLike {
  id: string;
  type: string;
  customType?: string;
  data?: unknown;
}

interface SessionBranchReader {
  getBranch(): SessionEntryLike[];
}

export function loadSessionEntry(sessionManager: SessionBranchReader): SessionEntryData {
  let data: SessionEntryData = {
    sdkSessionId: null,
    syncedThroughEntryId: null,
    lastClaudeModelId: null,
  };

  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== "custom" || !isClaudeAgentSdkSessionEntryType(entry.customType)) continue;
    data = normalizeSessionEntryData(entry.data);
  }

  return data;
}

export function appendSessionEntry(pi: ExtensionAPI, data: SessionEntryData) {
  pi.appendEntry<SessionEntryData>(SESSION_ENTRY_TYPE, data);
}

function normalizeSessionEntryData(value: unknown): SessionEntryData {
  if (!value || typeof value !== "object") {
    return { sdkSessionId: null, syncedThroughEntryId: null, lastClaudeModelId: null };
  }

  const record = value as Record<string, unknown>;
  return {
    sdkSessionId: typeof record.sdkSessionId === "string" ? record.sdkSessionId : null,
    syncedThroughEntryId: typeof record.syncedThroughEntryId === "string" ? record.syncedThroughEntryId : null,
    lastClaudeModelId: typeof record.lastClaudeModelId === "string" ? record.lastClaudeModelId : null,
  };
}
