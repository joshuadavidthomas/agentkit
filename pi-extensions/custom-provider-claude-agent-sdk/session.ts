import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadContinuity, appendContinuity, type SessionContinuity } from "./continuity.js";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import type { PiStreamState } from "./pi-stream.js";
import { debug, time } from "./sdk/debug.js";
import type { SdkQuery } from "./sdk/query.js";
import { SdkInputQueue, type SdkUserMessage } from "./sdk/queue.js";
import { ToolBridge } from "./tools/bridge.js";

type PersistSessionEntry = (data: SessionContinuity) => void;

// Pi can evaluate this extension more than once in the same process: explicit
// `-e` plus installed extension, reloads, parent sessions plus scouts/subagents.
// Keep the session manager global so provider re-registration on reload uses
// the existing session map instead of routing tool-result callbacks to a fresh,
// empty manager.
const ACTIVE_CLAUDE_SESSION_MANAGER_KEY = Symbol.for("agentkit.claude-agent-sdk.active-session-manager");

type ClaudeSessionManagerGlobal = typeof globalThis & { [ACTIVE_CLAUDE_SESSION_MANAGER_KEY]?: ClaudeSessionManager };

export type PiSessionManager = HandoffSessionReader & {
  getSessionId(): string;
  getLeafId(): string | null | undefined;
};

export type TurnHandoffPlan =
  | { skipHandoff: true }
  | { skipHandoff: false; handoff: string | undefined };

type ContinuityState =
  | { kind: "live" }
  | { kind: "resumable" }
  | { kind: "stale"; reason: string }
  | { kind: "cold" };

export function claimClaudeSessionManager(pi: ExtensionAPI): ClaudeSessionManager {
  const state = globalThis as ClaudeSessionManagerGlobal;
  const existing = state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY];
  if (existing) {
    existing.setPersistSessionEntry((data) => appendContinuity(pi, data));
    return existing;
  }

  const manager = new ClaudeSessionManager((data) => appendContinuity(pi, data));
  state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
  return manager;
}

export class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private persistSessionEntry: PersistSessionEntry) { }

  setPersistSessionEntry(persistSessionEntry: PersistSessionEntry) {
    this.persistSessionEntry = persistSessionEntry;
  }

  hydrateSession(sessionManager: PiSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    const replacing = this.sessions.has(piSessionId);
    this.sessions.get(piSessionId)?.closeLiveQuery("Session hydrated");

    const continuity = loadContinuity(sessionManager);
    debug("manager:hydrateSession", {
      piSessionId,
      replacing,
      hasSdkSessionId: Boolean(continuity.sdkSessionId),
      hasSyncedEntryId: Boolean(continuity.syncedThroughEntryId),
    });
    const session = new ClaudeSession(piSessionId, continuity, sessionManager, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  currentSession(sessionManager: PiSessionManager): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  createSession(piSessionId: string): ClaudeSession {
    debug("manager:createSession", { piSessionId, replacing: this.sessions.has(piSessionId) });
    const session = new ClaudeSession(piSessionId, undefined, undefined, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  getSession(piSessionId: string): ClaudeSession | undefined {
    return this.sessions.get(piSessionId);
  }

  resetSessionForStructuralChange(sessionManager: PiSessionManager) {
    const session = this.currentSession(sessionManager);
    debug("manager:resetSessionForStructuralChange", {
      piSessionId: sessionManager.getSessionId(),
      hasSession: Boolean(session),
    });
    session?.setHandoffReader(sessionManager);
    session?.resetContinuity("Structural change");
  }

  markSessionSynced(sessionManager: PiSessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    debug("manager:markSessionSynced", {
      piSessionId: sessionManager.getSessionId(),
      leafId,
      hasSession: Boolean(session),
    });
    session?.setHandoffReader(sessionManager);
    session?.markSyncedThrough(leafId);
  }

  shutdownSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
    debug("manager:shutdownSession", { piSessionId, hasSession: Boolean(session) });
    session?.closeLiveQuery("Session shutdown");
    this.sessions.delete(piSessionId);

    if (this.sessions.size === 0) {
      const state = globalThis as ClaudeSessionManagerGlobal;
      if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] === this) {
        delete state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY];
      }
    }
  }
}

export class ClaudeSession {
  readonly piSessionId: string;

  private continuity: SessionContinuity;
  private handoffReader: HandoffSessionReader | undefined;
  private activeTurn: ClaudeTurn | null = null;
  private requestedClaudeModelId: string | null = null;
  private sdkQuery: SdkQuery | null = null;
  private sdkAbortController: AbortController | null = null;
  private inputQueue: SdkInputQueue | null = null;
  private mcpFingerprint: string | null = null;

  constructor(
    piSessionId: string,
    data?: Partial<SessionContinuity>,
    sessionManager?: HandoffSessionReader,
    private readonly persistSessionEntry?: PersistSessionEntry,
  ) {
    this.piSessionId = piSessionId;
    this.continuity = {
      sdkSessionId: data?.sdkSessionId ?? null,
      syncedThroughEntryId: data?.syncedThroughEntryId ?? null,
      lastClaudeModelId: data?.lastClaudeModelId ?? null,
    };
    this.handoffReader = sessionManager;
  }

  continuityState(): SessionContinuity {
    return { ...this.continuity };
  }

  currentTurn(): ClaudeTurn | undefined {
    return this.activeTurn ?? undefined;
  }

  liveQuery(): SdkQuery | undefined {
    return this.sdkQuery ?? undefined;
  }

  startLiveQuery(sdkQuery: SdkQuery, inputQueue: SdkInputQueue, abortController: AbortController) {
    const replacingPriorQuery = Boolean(this.sdkQuery);
    this.inputQueue?.close();
    try {
      this.sdkAbortController?.abort();
      this.sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }

    debug("session:startLiveQuery", {
      piSessionId: this.piSessionId,
      replacingPriorQuery,
      hasSdkSessionId: Boolean(this.continuity.sdkSessionId),
    });

    this.sdkQuery = sdkQuery;
    this.sdkAbortController = abortController;
    this.inputQueue = inputQueue;
  }

  pushUserMessage(message: SdkUserMessage): boolean {
    const queueOpen = Boolean(this.inputQueue);
    const accepted = this.inputQueue?.push(message) ?? false;
    debug("session:pushUserMessage", { queueOpen, accepted });
    return accepted;
  }

  async setMcpServers(servers: Parameters<SdkQuery["setMcpServers"]>[0], fingerprint: string) {
    if (this.mcpFingerprint === fingerprint) {
      debug("session:setMcpServers", { skipped: "fingerprint-match", fingerprintBytes: fingerprint.length });
      return;
    }
    this.mcpFingerprint = fingerprint;
    if (!this.sdkQuery) {
      debug("session:setMcpServers", { skipped: "no-live-query", fingerprintBytes: fingerprint.length });
      return;
    }
    const end = time("setMcpServers");
    try {
      await this.sdkQuery.setMcpServers(servers);
    } finally {
      end({ fingerprintBytes: fingerprint.length });
    }
  }

  async setModel(modelId: string) {
    if (this.requestedClaudeModelId === modelId) {
      debug("session:setModel", { skipped: "already-set", modelId });
      return;
    }
    debug("session:setModel", { modelId, hasSdkQuery: Boolean(this.sdkQuery) });
    this.requestedClaudeModelId = modelId;
    await this.sdkQuery?.setModel(modelId);
  }

  beginTurn(streamState: PiStreamState): ClaudeTurn {
    debug("session:beginTurn", { piSessionId: this.piSessionId, replacingPriorTurn: Boolean(this.activeTurn) });
    this.abortActiveTurn("Turn replaced");
    const turn = new ClaudeTurn(streamState);
    this.activeTurn = turn;
    return turn;
  }

  setHandoffReader(handoffReader: HandoffSessionReader | undefined) {
    this.handoffReader = handoffReader;
  }

  captureSdkSessionId(sdkSessionId: string, claudeModelId: string) {
    if (this.continuity.sdkSessionId === sdkSessionId && this.continuity.lastClaudeModelId === claudeModelId) return;
    debug("session:captureSdkSessionId", {
      piSessionId: this.piSessionId,
      sdkSessionId,
      claudeModelId,
      changed: this.continuity.sdkSessionId !== sdkSessionId,
      modelChanged: this.continuity.lastClaudeModelId !== claudeModelId,
    });

    this.continuity = {
      ...this.continuity,
      sdkSessionId,
      lastClaudeModelId: claudeModelId,
    };
    this.persist();
  }

  markSyncedThrough(entryId: string) {
    if (!this.continuity.sdkSessionId) {
      debug("session:markSyncedThrough", { entryId, skipped: "no-sdk-session-id" });
      return;
    }
    if (this.continuity.syncedThroughEntryId === entryId) {
      debug("session:markSyncedThrough", { entryId, skipped: "unchanged" });
      return;
    }
    debug("session:markSyncedThrough", { entryId, prior: this.continuity.syncedThroughEntryId });

    this.continuity = {
      ...this.continuity,
      syncedThroughEntryId: entryId,
    };
    this.persist();
  }

  resetContinuity(message = "Session closed") {
    debug("session:resetContinuity", {
      piSessionId: this.piSessionId,
      reason: message,
      hadSdkSessionId: Boolean(this.continuity.sdkSessionId),
      hadSyncedEntryId: Boolean(this.continuity.syncedThroughEntryId),
    });
    this.closeLiveQuery(message);
    if (!this.continuity.sdkSessionId && !this.continuity.syncedThroughEntryId && !this.continuity.lastClaudeModelId) return;

    this.continuity = {
      sdkSessionId: null,
      syncedThroughEntryId: null,
      lastClaudeModelId: null,
    };
    this.persist();
  }

  private classifyContinuity(): ContinuityState {
    if (this.sdkQuery && this.continuity.sdkSessionId) return { kind: "live" };
    if (!this.continuity.sdkSessionId) return { kind: "cold" };
    if (!this.continuity.syncedThroughEntryId) return { kind: "stale", reason: "missing-syncedThroughEntryId" };
    if (!this.handoffReader) return { kind: "stale", reason: "missing-handoffReader" };
    if (!hasSyncedEntryOnCurrentBranch(this.handoffReader, this.continuity)) {
      return { kind: "stale", reason: "synced-entry-not-on-branch" };
    }
    return { kind: "resumable" };
  }

  prepareForTurn(): TurnHandoffPlan {
    const state = this.classifyContinuity();

    switch (state.kind) {
      case "live":
      case "resumable":
        debug("session:prepareForTurn", { piSessionId: this.piSessionId, state: state.kind });
        return { skipHandoff: true };
      case "stale":
        this.resetContinuity(`prepareForTurn: ${state.reason}`);
      // falls through to cold
      case "cold": {
        const handoff = buildPiSessionHandoff(this.handoffReader);
        debug("session:prepareForTurn", {
          piSessionId: this.piSessionId,
          state: state.kind,
          ...(state.kind === "stale" ? { reason: state.reason } : {}),
          builtHandoff: Boolean(handoff),
          handoffBytes: handoff?.length ?? 0,
        });
        return { skipHandoff: false, handoff };
      }
    }
  }

  finishActiveTurn(turn: ClaudeTurn) {
    if (this.activeTurn !== turn) {
      debug("session:finishActiveTurn", { skipped: "stale-turn" });
      return;
    }
    debug("session:finishActiveTurn", {});
    turn.finish();
    this.activeTurn = null;
  }

  abortActiveTurn(message: string) {
    debug("session:abortActiveTurn", { reason: message, hadActiveTurn: Boolean(this.activeTurn) });
    this.activeTurn?.abort(message);
    this.activeTurn = null;
  }

  currentModelId(): string | null {
    return this.requestedClaudeModelId ?? this.continuity.lastClaudeModelId;
  }

  closeLiveQuery(message = "Session closed") {
    const hadLiveQuery = Boolean(this.sdkQuery);
    const hadActiveTurn = Boolean(this.activeTurn);
    const hadInputQueue = Boolean(this.inputQueue);
    debug("session:closeLiveQuery", {
      piSessionId: this.piSessionId,
      reason: message,
      hadLiveQuery,
      hadActiveTurn,
      hadInputQueue,
    });

    this.abortActiveTurn(message);
    this.inputQueue?.close();
    this.inputQueue = null;
    this.requestedClaudeModelId = null;
    this.mcpFingerprint = null;

    const sdkQuery = this.sdkQuery;
    const abortController = this.sdkAbortController;
    this.sdkQuery = null;
    this.sdkAbortController = null;
    try {
      abortController?.abort();
      sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }
  }

  private persist() {
    this.persistSessionEntry?.(this.continuityState());
  }
}

export class ClaudeTurn {
  readonly toolBridge = new ToolBridge();

  private currentStreamState: PiStreamState | null = null;
  private lastStopReason: string | undefined;
  private completion: Promise<void>;
  private complete!: () => void;

  constructor(streamState: PiStreamState) {
    this.completion = new Promise((resolve) => {
      this.complete = resolve;
    });
    this.attachStreamState(streamState);
  }

  done(): Promise<void> {
    return this.completion;
  }

  streamState(): PiStreamState | undefined {
    return this.currentStreamState ?? undefined;
  }

  streamOutputStopReason(): string | undefined {
    return this.currentStreamState?.output.stopReason ?? this.lastStopReason;
  }

  attachStreamState(state: PiStreamState) {
    this.completion = new Promise((resolve) => {
      this.complete = resolve;
    });
    this.currentStreamState = state;
    state.start();
  }

  detachStreamState(state: PiStreamState) {
    if (this.currentStreamState === state) {
      this.lastStopReason = state.output.stopReason;
      this.currentStreamState = null;
      this.complete();
    }
  }

  abort(message: string) {
    const state = this.currentStreamState;
    if (state && !state.finished) {
      state.fail(message, true);
    }

    this.end(message);
  }

  finish() {
    this.end("Turn ended");
  }

  private end(message: string) {
    this.toolBridge.resolvePendingWithError(message);
    this.toolBridge.clearQueuedResults();
    this.lastStopReason = this.currentStreamState?.output.stopReason ?? this.lastStopReason;
    this.currentStreamState = null;
    this.toolBridge.beginMessage();
    this.complete();
  }
}

