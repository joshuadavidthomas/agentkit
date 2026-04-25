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

function closeSdkQuery(sdkQuery: SdkQuery | null | undefined) {
  try {
    sdkQuery?.close();
  } catch {
    // Ignore close failures.
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
    session?.setSessionManager(sessionManager);
    session?.resetContinuity();
  }

  markSessionSynced(sessionManager: PiSessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
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
  readonly toolCallMatcher = new ToolCallMatcher();

  private _sdkSessionId: string | null;
  private _syncedThroughEntryId: string | null;
  private _lastClaudeModelId: string | null;
  private sessionManager: HandoffSessionReader | undefined;
  private _activeQuery: SdkQuery | null = null;
  private _currentStreamState: PiStreamState | null = null;

  constructor(
    piSessionId: string,
    data?: Partial<SessionEntryData>,
    sessionManager?: HandoffSessionReader,
    private readonly persistSessionEntry?: PersistSessionEntry,
  ) {
    this.piSessionId = piSessionId;
    this._sdkSessionId = data?.sdkSessionId ?? null;
    this._syncedThroughEntryId = data?.syncedThroughEntryId ?? null;
    this._lastClaudeModelId = data?.lastClaudeModelId ?? null;
    this.sessionManager = sessionManager;
  }

  get sdkSessionId() {
    return this._sdkSessionId;
  }

  get syncedThroughEntryId() {
    return this._syncedThroughEntryId;
  }

  get lastClaudeModelId() {
    return this._lastClaudeModelId;
  }

  get activeQuery() {
    return this._activeQuery;
  }

  get currentStreamState() {
    return this._currentStreamState;
  }

  setSessionManager(sessionManager: HandoffSessionReader | undefined) {
    this.sessionManager = sessionManager;
  }

  captureSdkSessionId(sdkSessionId: string, claudeModelId: string) {
    if (this._sdkSessionId === sdkSessionId && this._lastClaudeModelId === claudeModelId) return;

    this._sdkSessionId = sdkSessionId;
    this._lastClaudeModelId = claudeModelId;
    this.persist();
  }

  markSyncedThrough(entryId: string) {
    if (this._syncedThroughEntryId === entryId) return;

    this._syncedThroughEntryId = entryId;
    this.persist();
  }

  resetContinuity() {
    this.closeActiveTurn();
    if (!this._sdkSessionId && !this._syncedThroughEntryId && !this._lastClaudeModelId) return;

    this._sdkSessionId = null;
    this._syncedThroughEntryId = null;
    this._lastClaudeModelId = null;
    this.persist();
  }

  prepareForTurn(): string | undefined {
    if (this._sdkSessionId && (!this._syncedThroughEntryId || !this.sessionManager || !hasSyncedEntryOnCurrentBranch(this.sessionManager, this))) {
      this.resetContinuity();
    }

    return buildPiSessionHandoff(this.sessionManager, this);
  }

  beginActiveQuery(sdkQuery: SdkQuery) {
    this._activeQuery = sdkQuery;
  }

  finishActiveQuery(sdkQuery: SdkQuery) {
    if (this._activeQuery !== sdkQuery) return;

    this.resolvePendingToolCalls(createMcpTextResult("Query ended", true));
    this.toolCallMatcher.clearQueuedResults();
    this._activeQuery = null;
    this._currentStreamState = null;
    closeSdkQuery(sdkQuery);
  }

  attachStreamState(state: PiStreamState) {
    this._currentStreamState = state;
  }

  detachStreamState(state: PiStreamState) {
    if (this._currentStreamState === state) {
      this._currentStreamState = null;
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

  abortActiveTurn(message: string) {
    const state = this._currentStreamState;
    if (state && !state.finished) {
      state.fail(message, true);
    }

    this.closeActiveTurn();
  }

  closeActiveTurn() {
    this.resolvePendingToolCalls(createMcpTextResult("Session closed", true));
    this.toolCallMatcher.clearQueuedResults();
    this._currentStreamState = null;
    this.toolCallMatcher.resetTurn();

    const sdkQuery = this._activeQuery;
    this._activeQuery = null;
    closeSdkQuery(sdkQuery);
  }

  private persist() {
    this.persistSessionEntry?.({
      sdkSessionId: this._sdkSessionId,
      syncedThroughEntryId: this._syncedThroughEntryId,
      lastClaudeModelId: this._lastClaudeModelId,
    });
  }
}
