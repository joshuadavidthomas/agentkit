import type { ExtensionAPI, SessionManager as PiSessionManager } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff } from "./handoff.js";
import type { PiStreamState } from "./pi-stream.js";
import { debug } from "./sdk/debug.js";
import type { SdkQuery } from "./sdk/query.js";
import { SdkInputQueue, type SdkUserMessage } from "./sdk/queue.js";
import { ToolBridge } from "./tools/bridge.js";

const SESSION_ENTRY_TYPE = "claude-agent-sdk-session";

export type SessionManager = Pick<PiSessionManager, "getBranch" | "getEntries" | "getSessionId" | "getLeafId">;

export interface SessionContinuity {
  sdkSessionId: string | null;
  syncedThroughEntryId: string | null;
  lastClaudeModelId: string | null;
}

type PersistSessionEntry = (data: SessionContinuity) => void;

function loadContinuity(sessionManager: SessionManager): SessionContinuity {
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

    const value = entry.data;
    if (!value || typeof value !== "object") {
      data = { sdkSessionId: null, syncedThroughEntryId: null, lastClaudeModelId: null };
      continue;
    }
    const record = value as Record<string, unknown>;
    data = {
      sdkSessionId: typeof record.sdkSessionId === "string" ? record.sdkSessionId : null,
      syncedThroughEntryId: typeof record.syncedThroughEntryId === "string" ? record.syncedThroughEntryId : null,
      lastClaudeModelId: typeof record.lastClaudeModelId === "string" ? record.lastClaudeModelId : null,
    };
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

// Pi can evaluate this extension more than once in the same process: explicit
// `-e` plus installed extension, reloads, parent sessions plus scouts/subagents.
// Keep the session manager global so provider re-registration on reload uses
// the existing session map instead of routing tool-result callbacks to a fresh,
// empty manager.
const ACTIVE_CLAUDE_SESSION_MANAGER_KEY = Symbol.for("agentkit.claude-agent-sdk.active-session-manager");

type ClaudeSessionManagerGlobal = typeof globalThis & { [ACTIVE_CLAUDE_SESSION_MANAGER_KEY]?: ClaudeSessionManager };

export class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  static claim(pi: ExtensionAPI): ClaudeSessionManager {
    const persist: PersistSessionEntry = (data) => {
      debug("continuity:append", {
        sdkSessionId: data.sdkSessionId,
        syncedThroughEntryId: data.syncedThroughEntryId,
        lastClaudeModelId: data.lastClaudeModelId,
      });
      pi.appendEntry<SessionContinuity>(SESSION_ENTRY_TYPE, data);
    };

    const state = globalThis as ClaudeSessionManagerGlobal;
    const existing = state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY];
    if (existing) {
      existing.persistSessionEntry = persist;
      return existing;
    }

    const manager = new ClaudeSessionManager(persist);
    state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
    return manager;
  }

  private constructor(private persistSessionEntry: PersistSessionEntry) { }

  hydrateSession(sessionManager: SessionManager): ClaudeSession {
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

  currentSession(sessionManager: SessionManager): ClaudeSession | undefined {
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

  resetSessionForStructuralChange(sessionManager: SessionManager) {
    const session = this.currentSession(sessionManager);
    debug("manager:resetSessionForStructuralChange", {
      piSessionId: sessionManager.getSessionId(),
      hasSession: Boolean(session),
    });
    session?.setSessionManager(sessionManager);
    session?.resetContinuity("Structural change");
  }

  markSessionSynced(sessionManager: SessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    debug("manager:markSessionSynced", {
      piSessionId: sessionManager.getSessionId(),
      leafId,
      hasSession: Boolean(session),
    });
    session?.setSessionManager(sessionManager);
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

type TurnHandoffPlan =
  | { skipHandoff: true }
  | { skipHandoff: false; handoff: string | undefined };

interface LiveSdkConnection {
  query: SdkQuery;
  inputQueue: SdkInputQueue;
  abort: AbortController;
  // Captured from the first SDK message that carries one. Until then the
  // connection is "starting" — process up, identity unconfirmed.
  sdkSessionId: string | null;
}

type ContinuityState =
  | { kind: "live" }
  | { kind: "starting" }
  | { kind: "resumable" }
  | { kind: "stale"; reason: string }
  | { kind: "cold" };

export class ClaudeSession {
  readonly piSessionId: string;

  private continuity: SessionContinuity;
  private sessionManager: SessionManager | undefined;
  private activeTurn: ClaudeTurn | null = null;
  private requestedClaudeModelId: string | null = null;
  private liveConnection: LiveSdkConnection | null = null;
  private mcpFingerprint: string | null = null;

  constructor(
    piSessionId: string,
    data?: Partial<SessionContinuity>,
    sessionManager?: SessionManager,
    private readonly persistSessionEntry?: PersistSessionEntry,
  ) {
    this.piSessionId = piSessionId;
    this.continuity = {
      sdkSessionId: data?.sdkSessionId ?? null,
      syncedThroughEntryId: data?.syncedThroughEntryId ?? null,
      lastClaudeModelId: data?.lastClaudeModelId ?? null,
    };
    this.sessionManager = sessionManager;
  }

  continuityState(): SessionContinuity {
    return { ...this.continuity };
  }

  currentTurn(): ClaudeTurn | undefined {
    return this.activeTurn ?? undefined;
  }

  liveQuery(): SdkQuery | undefined {
    return this.liveConnection?.query;
  }

  startLiveQuery(process: Pick<LiveSdkConnection, "query" | "inputQueue" | "abort">) {
    debug("session:startLiveQuery", {
      piSessionId: this.piSessionId,
      replacingPriorQuery: Boolean(this.liveConnection),
      hasSdkSessionId: Boolean(this.continuity.sdkSessionId),
    });
    this.tearDownLiveConnection();
    this.liveConnection = { ...process, sdkSessionId: null };
  }

  pushUserMessage(message: SdkUserMessage): boolean {
    const queueOpen = Boolean(this.liveConnection);
    const accepted = this.liveConnection?.inputQueue.push(message) ?? false;
    debug("session:pushUserMessage", { queueOpen, accepted });
    return accepted;
  }

  async setMcpServers(servers: Parameters<SdkQuery["setMcpServers"]>[0], fingerprint: string) {
    if (this.mcpFingerprint === fingerprint) {
      debug("session:setMcpServers", { skipped: "fingerprint-match", fingerprintBytes: fingerprint.length });
      return;
    }
    this.mcpFingerprint = fingerprint;
    if (!this.liveConnection) {
      debug("session:setMcpServers", { skipped: "no-live-query", fingerprintBytes: fingerprint.length });
      return;
    }
    await this.liveConnection.query.setMcpServers(servers);
  }

  async setModel(modelId: string) {
    if (this.requestedClaudeModelId === modelId) {
      debug("session:setModel", { skipped: "already-set", modelId });
      return;
    }
    debug("session:setModel", { modelId, hasSdkQuery: Boolean(this.liveConnection) });
    this.requestedClaudeModelId = modelId;
    await this.liveConnection?.query.setModel(modelId);
  }

  beginTurn(streamState: PiStreamState): ClaudeTurn {
    debug("session:beginTurn", { piSessionId: this.piSessionId, replacingPriorTurn: Boolean(this.activeTurn) });
    this.abortActiveTurn("Turn replaced");
    const turn = new ClaudeTurn(streamState);
    this.activeTurn = turn;
    return turn;
  }

  setSessionManager(handoffReader: SessionManager | undefined) {
    this.sessionManager = handoffReader;
  }

  captureSdkSessionId(sdkSessionId: string, claudeModelId: string) {
    if (this.liveConnection) {
      this.liveConnection.sdkSessionId = sdkSessionId;
    }

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
    if (this.liveConnection?.sdkSessionId) return { kind: "live" };
    if (this.liveConnection) return { kind: "starting" };
    if (!this.continuity.sdkSessionId) return { kind: "cold" };
    if (!this.continuity.syncedThroughEntryId) return { kind: "stale", reason: "missing-syncedThroughEntryId" };
    if (!this.sessionManager) return { kind: "stale", reason: "missing-handoffReader" };

    const branch = this.sessionManager.getBranch();
    const onBranch = branch.some((entry) => entry.id === this.continuity.syncedThroughEntryId);
    debug("session:syncedEntryCheck", {
      syncedThroughEntryId: this.continuity.syncedThroughEntryId,
      branchLength: branch.length,
      onBranch,
    });
    return onBranch ? { kind: "resumable" } : { kind: "stale", reason: "synced-entry-not-on-branch" };
  }

  prepareForTurn(): TurnHandoffPlan {
    let state = this.classifyContinuity();
    // A prior turn left a connection whose sdkSessionId never landed. Tear it
    // down before classifying the actionable case — otherwise we'd push a fresh
    // handoff into a stranded connection from before, or skip the handoff
    // because we mistook the half-started connection for a cold start.
    if (state.kind === "starting") {
      debug("session:prepareForTurn", { piSessionId: this.piSessionId, state: "starting", action: "tear-down" });
      this.closeLiveQuery("Stranded starting connection at turn start");
      state = this.classifyContinuity();
    }

    switch (state.kind) {
      case "live":
      case "resumable":
        debug("session:prepareForTurn", { piSessionId: this.piSessionId, state: state.kind });
        return { skipHandoff: true };
      case "starting":
        // Unreachable — closeLiveQuery clears liveConnection, so the second
        // classifyContinuity above can't return "starting".
        throw new Error("classifyContinuity returned starting after closeLiveQuery");
      case "stale":
        this.resetContinuity(`prepareForTurn: ${state.reason}`);
      // falls through to cold
      case "cold": {
        const handoff = buildPiSessionHandoff(this.sessionManager);
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
    debug("session:closeLiveQuery", {
      piSessionId: this.piSessionId,
      reason: message,
      hadLive: Boolean(this.liveConnection),
      hadActiveTurn: Boolean(this.activeTurn),
    });

    this.abortActiveTurn(message);
    this.requestedClaudeModelId = null;
    this.mcpFingerprint = null;
    this.tearDownLiveConnection();
  }

  // Null `this.liveConnection` *before* aborting/closing so re-entrant callbacks (the SDK
  // query's close can fire handlers that hop back into the session) observe the
  // connection as already gone. inputQueue.close is sync and safe — running it
  // first stops accepting input before we tear down the consumer.
  private tearDownLiveConnection() {
    const connection = this.liveConnection;
    if (!connection) return;
    this.liveConnection = null;
    connection.inputQueue.close();
    try {
      connection.abort.abort();
      connection.query.close();
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
  private completion!: Promise<void>;
  private complete!: () => void;

  constructor(streamState: PiStreamState) {
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
