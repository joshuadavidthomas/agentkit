import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type HandoffSessionReader } from "./handoff.js";
import { appendSessionEntry, type SessionEntryData } from "./persistence.js";
import { ToolCallMatcher } from "./tool-call-matcher.js";
import { createMcpTextResult, type PiMcpResult } from "./tools.js";
import type { PiStreamState } from "./pi-stream.js";

type SdkQuery = ReturnType<typeof query>;

export class ClaudeSession {
  readonly piSessionId: string;
  sdkSessionId: string | null;
  syncedThroughEntryId: string | null;
  lastClaudeModelId: string | null;
  sessionManager: HandoffSessionReader | undefined;
  activeQuery: SdkQuery | null;
  currentStreamState: PiStreamState | null;
  toolCalls: ToolCallMatcher;

  constructor(piSessionId: string, data?: Partial<SessionEntryData>, sessionManager?: HandoffSessionReader) {
    this.piSessionId = piSessionId;
    this.sdkSessionId = data?.sdkSessionId ?? null;
    this.syncedThroughEntryId = data?.syncedThroughEntryId ?? null;
    this.lastClaudeModelId = data?.lastClaudeModelId ?? null;
    this.sessionManager = sessionManager;
    this.activeQuery = null;
    this.currentStreamState = null;
    this.toolCalls = new ToolCallMatcher();
  }

  setSessionManager(sessionManager: HandoffSessionReader | undefined) {
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
    this.close();
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

  beginQuery(sdkQuery: SdkQuery) {
    this.activeQuery = sdkQuery;
  }

  finishQuery(sdkQuery: SdkQuery) {
    if (this.activeQuery !== sdkQuery) return;

    this.resolvePendingToolCalls(createMcpTextResult("Query ended", true));
    this.toolCalls.clearQueuedResults();
    this.activeQuery = null;
    this.currentStreamState = null;
  }

  attachStreamState(state: PiStreamState) {
    this.currentStreamState = state;
  }

  detachStreamState(state: PiStreamState) {
    if (this.currentStreamState === state) {
      this.currentStreamState = null;
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
    const state = this.currentStreamState;
    if (state && !state.finished) {
      state.fail(message, true);
    }

    this.close();
  }

  close() {
    this.resolvePendingToolCalls(createMcpTextResult("Session closed", true));
    this.toolCalls.clearQueuedResults();
    this.currentStreamState = null;
    this.toolCalls.resetTurn();

    const query = this.activeQuery;
    this.activeQuery = null;
    try {
      query?.close();
    } catch {
      // Ignore close failures.
    }
  }

  private persist(pi: ExtensionAPI) {
    appendSessionEntry(pi, {
      sdkSessionId: this.sdkSessionId,
      syncedThroughEntryId: this.syncedThroughEntryId,
      lastClaudeModelId: this.lastClaudeModelId,
    });
  }
}
