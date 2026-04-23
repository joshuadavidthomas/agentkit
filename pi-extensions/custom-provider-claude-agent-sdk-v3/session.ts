import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type ContinuitySessionManager } from "./continuity.js";
import { appendSessionEntry, type SessionEntryData } from "./persistence.js";

export class ClaudeSession {
  readonly piSessionId: string;
  sdkSessionId: string | null;
  syncedThroughEntryId: string | null;
  lastClaudeModelId: string | null;
  sessionManager: ContinuitySessionManager | undefined;

  constructor(piSessionId: string, data?: Partial<SessionEntryData>, sessionManager?: ContinuitySessionManager) {
    this.piSessionId = piSessionId;
    this.sdkSessionId = data?.sdkSessionId ?? null;
    this.syncedThroughEntryId = data?.syncedThroughEntryId ?? null;
    this.lastClaudeModelId = data?.lastClaudeModelId ?? null;
    this.sessionManager = sessionManager;
  }

  setSessionManager(sessionManager: ContinuitySessionManager | undefined) {
    this.sessionManager = sessionManager;
  }

  captureSdkSessionId(pi: ExtensionAPI, sdkSessionId: string, claudeModelId: string) {
    if (this.sdkSessionId === sdkSessionId && this.lastClaudeModelId === claudeModelId) return;

    this.sdkSessionId = sdkSessionId;
    this.lastClaudeModelId = claudeModelId;
    this.persist(pi);
  }

  markSyncedThrough(pi: ExtensionAPI, entryId: string) {
    if (this.syncedThroughEntryId === entryId) return;

    this.syncedThroughEntryId = entryId;
    this.persist(pi);
  }

  reset(pi: ExtensionAPI) {
    if (!this.sdkSessionId && !this.syncedThroughEntryId && !this.lastClaudeModelId) return;

    this.sdkSessionId = null;
    this.syncedThroughEntryId = null;
    this.lastClaudeModelId = null;
    this.persist(pi);
  }

  prepareForTurn(pi: ExtensionAPI): string | undefined {
    if (this.sdkSessionId && (!this.syncedThroughEntryId || !this.sessionManager || !hasSyncedEntryOnCurrentBranch(this.sessionManager, this))) {
      this.reset(pi);
    }

    return buildPiSessionHandoff(this.sessionManager, this);
  }

  close() {
    // Stable query() calls are one-shot. There is no live session handle to close in M2.
  }

  private persist(pi: ExtensionAPI) {
    appendSessionEntry(pi, {
      sdkSessionId: this.sdkSessionId,
      syncedThroughEntryId: this.syncedThroughEntryId,
      lastClaudeModelId: this.lastClaudeModelId,
    });
  }
}
