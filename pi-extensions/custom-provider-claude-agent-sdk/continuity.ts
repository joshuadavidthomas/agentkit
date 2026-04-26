import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const CONTINUITY_ENTRY_TYPE = "claude-agent-sdk-session";

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
    if (entry.type !== "custom" || entry.customType !== CONTINUITY_ENTRY_TYPE) continue;
    data = normalizeSessionContinuity(entry.data);
  }

  return data;
}

export function appendContinuity(pi: ExtensionAPI, data: SessionContinuity) {
  pi.appendEntry<SessionContinuity>(CONTINUITY_ENTRY_TYPE, data);
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
