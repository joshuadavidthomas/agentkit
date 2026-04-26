import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SESSION_ENTRY_TYPE = "claude-agent-sdk-session";
const LEGACY_V3_SESSION_ENTRY_TYPE = "claude-agent-sdk-v3-session";

export function isContinuityEntryType(customType: string | undefined): boolean {
  return customType === SESSION_ENTRY_TYPE || customType === LEGACY_V3_SESSION_ENTRY_TYPE;
}

export interface SessionContinuity {
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

export function loadContinuity(sessionManager: SessionBranchReader): SessionContinuity {
  let data: SessionContinuity = {
    sdkSessionId: null,
    syncedThroughEntryId: null,
    lastClaudeModelId: null,
  };

  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== "custom" || !isContinuityEntryType(entry.customType)) continue;
    data = normalizeSessionContinuity(entry.data);
  }

  return data;
}

export function appendContinuity(pi: ExtensionAPI, data: SessionContinuity) {
  pi.appendEntry<SessionContinuity>(SESSION_ENTRY_TYPE, data);
}

function normalizeSessionContinuity(value: unknown): SessionContinuity {
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
