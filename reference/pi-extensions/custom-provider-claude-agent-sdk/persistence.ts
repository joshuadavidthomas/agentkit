import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SESSION_ENTRY_TYPE } from "./constants.js";
import type { ClaudeExtensionState, PersistedState } from "./types.js";

type PersistedRuntimeFields = Pick<ClaudeExtensionState, "sdkSessionId" | "syncedThroughEntryId" | "lastClaudeModelId">;

type PersistedContext = {
  sessionManager: {
    getBranch(): Array<{ type: string; customType?: string; data?: unknown }>;
  };
};

export function loadPersistedState(state: PersistedRuntimeFields, ctx: PersistedContext) {
  state.sdkSessionId = undefined;
  state.syncedThroughEntryId = undefined;
  state.lastClaudeModelId = undefined;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY_TYPE) continue;
    const data = entry.data as PersistedState | undefined;
    state.sdkSessionId = data?.sdkSessionId;
    state.syncedThroughEntryId = data?.syncedThroughEntryId;
    state.lastClaudeModelId = data?.lastClaudeModelId;
  }
}

export function savePersistedState(
  state: PersistedRuntimeFields,
  pi: ExtensionAPI,
  patch: Partial<PersistedState>,
  onChange?: () => void,
) {
  const next: PersistedState = {
    sdkSessionId: Object.prototype.hasOwnProperty.call(patch, "sdkSessionId")
      ? patch.sdkSessionId
      : state.sdkSessionId,
    syncedThroughEntryId: Object.prototype.hasOwnProperty.call(patch, "syncedThroughEntryId")
      ? patch.syncedThroughEntryId
      : state.syncedThroughEntryId,
    lastClaudeModelId: Object.prototype.hasOwnProperty.call(patch, "lastClaudeModelId")
      ? patch.lastClaudeModelId
      : state.lastClaudeModelId,
  };

  if (
    next.sdkSessionId === state.sdkSessionId &&
    next.syncedThroughEntryId === state.syncedThroughEntryId &&
    next.lastClaudeModelId === state.lastClaudeModelId
  ) {
    return;
  }

  state.sdkSessionId = next.sdkSessionId;
  state.syncedThroughEntryId = next.syncedThroughEntryId;
  state.lastClaudeModelId = next.lastClaudeModelId;
  pi.appendEntry<PersistedState>(SESSION_ENTRY_TYPE, next);
  onChange?.();
}

export function saveSessionId(
  state: PersistedRuntimeFields,
  pi: ExtensionAPI,
  sessionId: string,
  onChange?: () => void,
) {
  savePersistedState(state, pi, { sdkSessionId: sessionId }, onChange);
}
