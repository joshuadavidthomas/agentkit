import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import type { SessionEntryData } from "./persistence.js";
import type { PiStreamState } from "./pi-stream.js";
import { ToolCallMatcher } from "./tool-call-matcher.js";
import { createMcpTextResult, type PiMcpResult } from "./tools.js";

type SdkQuery = ReturnType<typeof query>;
type PersistSessionEntry = (data: SessionEntryData) => void;

export class ClaudeSession {
  readonly piSessionId: string;
  readonly toolCalls = new ToolCallMatcher();

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

  reset() {
    this.close();
    if (!this._sdkSessionId && !this._syncedThroughEntryId && !this._lastClaudeModelId) return;

    this._sdkSessionId = null;
    this._syncedThroughEntryId = null;
    this._lastClaudeModelId = null;
    this.persist();
  }

  prepareForTurn(): string | undefined {
    if (this._sdkSessionId && (!this._syncedThroughEntryId || !this.sessionManager || !hasSyncedEntryOnCurrentBranch(this.sessionManager, this))) {
      this.reset();
    }

    return buildPiSessionHandoff(this.sessionManager, this);
  }

  beginQuery(sdkQuery: SdkQuery) {
    this._activeQuery = sdkQuery;
  }

  finishQuery(sdkQuery: SdkQuery) {
    if (this._activeQuery !== sdkQuery) return;

    this.resolvePendingToolCalls(createMcpTextResult("Query ended", true));
    this.toolCalls.clearQueuedResults();
    this._activeQuery = null;
    this._currentStreamState = null;
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
    return this.toolCalls.handleMcpToolCall(toolName);
  }

  deliverToolResults(results: PiMcpResult[]) {
    this.toolCalls.deliverToolResults(results);
  }

  resolvePendingToolCalls(result: CallToolResult) {
    this.toolCalls.resolvePendingToolCalls(result);
  }

  abortActiveTurn(message: string) {
    const state = this._currentStreamState;
    if (state && !state.finished) {
      state.fail(message, true);
    }

    this.close();
  }

  close() {
    this.resolvePendingToolCalls(createMcpTextResult("Session closed", true));
    this.toolCalls.clearQueuedResults();
    this._currentStreamState = null;
    this.toolCalls.resetTurn();

    const sdkQuery = this._activeQuery;
    this._activeQuery = null;
    try {
      sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }
  }

  private persist() {
    this.persistSessionEntry?.({
      sdkSessionId: this._sdkSessionId,
      syncedThroughEntryId: this._syncedThroughEntryId,
      lastClaudeModelId: this._lastClaudeModelId,
    });
  }
}
