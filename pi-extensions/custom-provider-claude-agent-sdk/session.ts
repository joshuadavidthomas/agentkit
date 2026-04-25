import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import { appendSessionEntry, loadSessionEntry, type SessionEntryData } from "./persistence.js";
import type { PiStreamState } from "./pi-stream.js";
import { ToolCallMatcher } from "./tool-call-matcher.js";
import { createMcpTextResult, type PiMcpResult } from "./tools.js";

type SdkQuery = ReturnType<typeof query>;
type PersistSessionEntry = (data: SessionEntryData) => void;

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

  constructor(private readonly persistSessionEntry: PersistSessionEntry) {}

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

export class ClaudeTurn {
  readonly toolCallMatcher = new ToolCallMatcher();

  private activeQuery: SdkQuery | null = null;
  private currentStreamState: PiStreamState | null = null;

  constructor(streamState: PiStreamState) {
    this.attachStreamState(streamState);
  }

  hasActiveQuery(): boolean {
    return Boolean(this.activeQuery);
  }

  streamState(): PiStreamState | undefined {
    return this.currentStreamState ?? undefined;
  }

  beginActiveQuery(sdkQuery: SdkQuery) {
    this.activeQuery = sdkQuery;
  }

  finishActiveQuery(sdkQuery: SdkQuery): boolean {
    if (this.activeQuery !== sdkQuery) return false;

    this.resolvePendingToolCalls(createMcpTextResult("Query ended", true));
    this.toolCallMatcher.clearQueuedResults();
    this.activeQuery = null;
    this.currentStreamState = null;
    this.closeSdkQuery(sdkQuery);
    return true;
  }

  attachStreamState(state: PiStreamState) {
    this.currentStreamState = state;
    state.start();
  }

  detachStreamState(state: PiStreamState) {
    if (this.currentStreamState === state) {
      this.currentStreamState = null;
    }
  }

  handleMcpToolCall(toolName: string): Promise<CallToolResult> {
    return this.toolCallMatcher.handleMcpToolCall(toolName);
  }

  deliverToolResults(results: PiMcpResult[]) {
    this.toolCallMatcher.deliverToolResults(results);
  }

  resolvePendingToolCalls(result: CallToolResult) {
    this.toolCallMatcher.resolvePendingToolCalls(result);
  }

  abort(message: string) {
    const state = this.currentStreamState;
    if (state && !state.finished) {
      state.fail(message, true);
    }

    this.close("Session closed");
  }

  close(message = "Session closed") {
    this.resolvePendingToolCalls(createMcpTextResult(message, true));
    this.toolCallMatcher.clearQueuedResults();
    this.currentStreamState = null;
    this.toolCallMatcher.resetTurn();

    const sdkQuery = this.activeQuery;
    this.activeQuery = null;
    this.closeSdkQuery(sdkQuery);
  }

  private closeSdkQuery(sdkQuery: SdkQuery | null | undefined) {
    try {
      sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }
  }
}

export class ClaudeSession {
  readonly piSessionId: string;

  private continuity: SessionEntryData;
  private handoffReader: HandoffSessionReader | undefined;
  private activeTurn: ClaudeTurn | null = null;

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
    this.closeActiveTurn();
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
      (!this.continuity.syncedThroughEntryId || !this.handoffReader || !hasSyncedEntryOnCurrentBranch(this.handoffReader, this))
    ) {
      this.resetContinuity();
    }

    return buildPiSessionHandoff(this.handoffReader, this);
  }

  finishActiveTurn(turn: ClaudeTurn, sdkQuery: SdkQuery) {
    if (this.activeTurn !== turn) return;
    if (turn.finishActiveQuery(sdkQuery)) {
      this.activeTurn = null;
    }
  }

  closeActiveTurn() {
    this.activeTurn?.close();
    this.activeTurn = null;
  }

  abortActiveTurn(message: string) {
    this.activeTurn?.abort(message);
    this.activeTurn = null;
  }

  private persist() {
    this.persistSessionEntry?.(this.continuityState());
  }
}
