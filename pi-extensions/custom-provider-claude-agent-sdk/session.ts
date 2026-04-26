import type { query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import { appendSessionEntry, loadSessionEntry, type SessionEntryData } from "./persistence.js";
import type { PiStreamState } from "./pi-stream.js";
import { ToolBridge } from "./tools/bridge.js";

type SdkQuery = ReturnType<typeof query>;
type PersistSessionEntry = (data: SessionEntryData) => void;

export class SdkInputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  private closed = false;

  push(message: SDKUserMessage) {
    if (this.closed) throw new Error("Claude SDK input stream is closed");

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: message, done: false });
      return;
    }

    this.pending.push(message);
  }

  close() {
    if (this.closed) return;

    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const message = this.pending.shift();
        if (message) return Promise.resolve({ value: message, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

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

  const manager = new ClaudeSessionManager((data) => appendSessionEntry(pi, data));
  state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
  return manager;
}

export class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly persistSessionEntry: PersistSessionEntry) { }

  hydrateSession(sessionManager: PiSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    this.sessions.get(piSessionId)?.closeActiveTurn();

    const session = new ClaudeSession(piSessionId, loadSessionEntry(sessionManager), sessionManager, this.persistSessionEntry);
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
    session?.closeActiveTurn();
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

  private continuity: SessionEntryData;
  private handoffReader: HandoffSessionReader | undefined;
  private activeTurn: ClaudeTurn | null = null;
  private sdkQuery: SdkQuery | null = null;
  private inputQueue: SdkInputQueue | null = null;
  private outputPump: Promise<void> | null = null;

  constructor(
    piSessionId: string,
    data?: Partial<SessionEntryData>,
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

  continuityState(): SessionEntryData {
    return { ...this.continuity };
  }

  currentTurn(): ClaudeTurn | undefined {
    return this.activeTurn ?? undefined;
  }

  liveQuery(): SdkQuery | undefined {
    return this.sdkQuery ?? undefined;
  }

  startLiveQuery(sdkQuery: SdkQuery, inputQueue: SdkInputQueue, outputPump: Promise<void>) {
    this.inputQueue?.close();
    try {
      this.sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }

    this.sdkQuery = sdkQuery;
    this.inputQueue = inputQueue;
    this.outputPump = outputPump;
  }

  createInputQueue(): SdkInputQueue {
    return new SdkInputQueue();
  }

  pushUserMessage(message: SDKUserMessage) {
    this.inputQueue?.push(message);
  }

  async setMcpServers(servers: Parameters<SdkQuery["setMcpServers"]>[0]) {
    return this.sdkQuery?.setMcpServers(servers);
  }

  async setModel(modelId: string) {
    await this.sdkQuery?.setModel(modelId);
  }

  beginTurn(streamState: PiStreamState): ClaudeTurn {
    this.closeActiveTurn();
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

  closeActiveTurn() {
    this.activeTurn?.close();
    this.activeTurn = null;
  }

  abortActiveTurn(message: string) {
    this.activeTurn?.abort(message);
    this.activeTurn = null;
  }

  closeLiveQuery(message = "Session closed") {
    this.closeActiveTurn();
    this.inputQueue?.close();
    this.inputQueue = null;
    this.outputPump = null;

    const sdkQuery = this.sdkQuery;
    this.sdkQuery = null;
    try {
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

  hasActiveQuery(): boolean {
    return Boolean(this.currentStreamState);
  }

  streamState(): PiStreamState | undefined {
    return this.currentStreamState ?? undefined;
  }

  streamOutputStopReason(): string | undefined {
    return this.currentStreamState?.output.stopReason ?? this.lastStopReason;
  }

  beginActiveQuery(_sdkQuery: SdkQuery) {
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

    this.close("Session closed");
  }

  finish() {
    this.toolBridge.resolvePendingWithError("Turn ended");
    this.toolBridge.clearQueuedResults();
    this.lastStopReason = this.currentStreamState?.output.stopReason ?? this.lastStopReason;
    this.currentStreamState = null;
    this.complete();
  }

  close(message = "Session closed") {
    this.toolBridge.resolvePendingWithError(message);
    this.toolBridge.clearQueuedResults();
    this.lastStopReason = this.currentStreamState?.output.stopReason ?? this.lastStopReason;
    this.currentStreamState = null;
    this.toolBridge.beginMessage();
    this.complete();
  }
}

