import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadContinuity, appendContinuity, type SessionContinuity } from "./continuity.js";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import type { PiStreamState } from "./pi-stream.js";
import type { SdkQuery } from "./sdk/query.js";
import { SdkInputQueue, type SdkUserMessage } from "./sdk/queue.js";
import { ToolBridge } from "./tools/bridge.js";

type PersistSessionEntry = (data: SessionContinuity) => void;

// Pi can evaluate this extension more than once in the same process: explicit
// `-e` plus installed extension, reloads, parent sessions plus scouts/subagents.
// The model registry is shared, so a later instance must not overwrite the
// registered `streamSimple` function for an active parent turn; tool-result
// callbacks would then route to an instance with an empty session map. Keep one
// active Claude session manager as the owner of this provider registration.
const ACTIVE_CLAUDE_SESSION_MANAGER_KEY = Symbol.for("agentkit.claude-agent-sdk.active-session-manager");

type ClaudeSessionManagerGlobal = typeof globalThis & { [ACTIVE_CLAUDE_SESSION_MANAGER_KEY]?: ClaudeSessionManager };

export type PiSessionManager = HandoffSessionReader & {
  getSessionId(): string;
  getLeafId(): string | null | undefined;
};

export function claimClaudeSessionManager(pi: ExtensionAPI): ClaudeSessionManager | undefined {
  const state = globalThis as ClaudeSessionManagerGlobal;
  if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY]) return undefined;

  const manager = new ClaudeSessionManager((data) => appendContinuity(pi, data));
  state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
  return manager;
}

export class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly persistSessionEntry: PersistSessionEntry) { }

  hydrateSession(sessionManager: PiSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    this.sessions.get(piSessionId)?.closeLiveQuery("Session hydrated");

    const session = new ClaudeSession(piSessionId, loadContinuity(sessionManager), sessionManager, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  currentSession(sessionManager: PiSessionManager): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  createSession(piSessionId: string): ClaudeSession {
    const session = new ClaudeSession(piSessionId, undefined, undefined, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  getSession(piSessionId: string): ClaudeSession | undefined {
    return this.sessions.get(piSessionId);
  }

  resetSessionForStructuralChange(sessionManager: PiSessionManager) {
    const session = this.currentSession(sessionManager);
    session?.setHandoffReader(sessionManager);
    session?.resetContinuity();
  }

  markSessionSynced(sessionManager: PiSessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    session?.setHandoffReader(sessionManager);
    session?.markSyncedThrough(leafId);
  }

  shutdownSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
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
    this.inputQueue?.close();
    try {
      this.sdkAbortController?.abort();
      this.sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }

    this.sdkQuery = sdkQuery;
    this.sdkAbortController = abortController;
    this.inputQueue = inputQueue;
  }

  createInputQueue(): SdkInputQueue {
    return new SdkInputQueue();
  }

  pushUserMessage(message: SdkUserMessage): boolean {
    return this.inputQueue?.push(message) ?? false;
  }

  async setMcpServers(servers: Parameters<SdkQuery["setMcpServers"]>[0]) {
    return this.sdkQuery?.setMcpServers(servers);
  }

  async setModel(modelId: string) {
    if (this.requestedClaudeModelId === modelId) return;
    this.requestedClaudeModelId = modelId;
    await this.sdkQuery?.setModel(modelId);
  }

  beginTurn(streamState: PiStreamState): ClaudeTurn {
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

    this.continuity = {
      ...this.continuity,
      sdkSessionId,
      lastClaudeModelId: claudeModelId,
    };
    this.persist();
  }

  markSyncedThrough(entryId: string) {
    if (this.continuity.syncedThroughEntryId === entryId) return;

    this.continuity = {
      ...this.continuity,
      syncedThroughEntryId: entryId,
    };
    this.persist();
  }

  resetContinuity() {
    this.closeLiveQuery();
    if (!this.continuity.sdkSessionId && !this.continuity.syncedThroughEntryId && !this.continuity.lastClaudeModelId) return;

    this.continuity = {
      sdkSessionId: null,
      syncedThroughEntryId: null,
      lastClaudeModelId: null,
    };
    this.persist();
  }

  prepareForTurn(): string | undefined {
    if (
      this.continuity.sdkSessionId &&
      (!this.continuity.syncedThroughEntryId || !this.handoffReader || !hasSyncedEntryOnCurrentBranch(this.handoffReader, this.continuity))
    ) {
      this.resetContinuity();
    }

    return buildPiSessionHandoff(this.handoffReader, this.continuity);
  }

  finishActiveTurn(turn: ClaudeTurn) {
    if (this.activeTurn !== turn) return;
    turn.finish();
    this.activeTurn = null;
  }

  abortActiveTurn(message: string) {
    this.activeTurn?.abort(message);
    this.activeTurn = null;
  }

  currentModelId(): string | null {
    return this.requestedClaudeModelId ?? this.continuity.lastClaudeModelId;
  }

  closeLiveQuery(message = "Session closed") {
    this.abortActiveTurn(message);
    this.inputQueue?.close();
    this.inputQueue = null;
    this.requestedClaudeModelId = null;

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

