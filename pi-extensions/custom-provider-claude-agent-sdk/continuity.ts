import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { debug } from "./sdk/debug.js";

export const SESSION_ENTRY_TYPE = "claude-agent-sdk-session";

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

  const branch = sessionManager.getBranch();
  let entriesScanned = 0;
  let matchesFound = 0;
  for (const entry of branch) {
    entriesScanned += 1;
    if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) continue;
    matchesFound += 1;
    data = normalizeSessionContinuity(entry.data);
  }

  debug("continuity:load", {
    branchLength: branch.length,
    entriesScanned,
    matchesFound,
    sdkSessionId: data.sdkSessionId,
    syncedThroughEntryId: data.syncedThroughEntryId,
    lastClaudeModelId: data.lastClaudeModelId,
  });

  return data;
}

export function appendContinuity(pi: ExtensionAPI, data: SessionContinuity) {
  debug("continuity:append", {
    sdkSessionId: data.sdkSessionId,
    syncedThroughEntryId: data.syncedThroughEntryId,
    lastClaudeModelId: data.lastClaudeModelId,
  });
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
