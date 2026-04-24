import type { query } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildPiSessionHandoff, hasSyncedEntryOnCurrentBranch, type ContinuitySessionManager } from "./continuity.js";
import { appendSessionEntry, type SessionEntryData } from "./persistence.js";
import { createMcpTextResult, type PiMcpResult } from "./tools.js";
import type { StreamState } from "./types.js";

export type SdkQuery = ReturnType<typeof query>;

interface PendingToolCall {
  toolName: string;
  resolve: (result: CallToolResult) => void;
}

export class ClaudeSession {
  readonly piSessionId: string;
  sdkSessionId: string | null;
  syncedThroughEntryId: string | null;
  lastClaudeModelId: string | null;
  sessionManager: ContinuitySessionManager | undefined;
  activeQuery: SdkQuery | null;
  currentStreamState: StreamState | null;
  pendingToolCalls: Map<string, PendingToolCall>;
  pendingResults: Map<string, CallToolResult>;
  turnToolCallIds: string[];
  nextToolHandlerIndex: number;

  constructor(piSessionId: string, data?: Partial<SessionEntryData>, sessionManager?: ContinuitySessionManager) {
    this.piSessionId = piSessionId;
    this.sdkSessionId = data?.sdkSessionId ?? null;
    this.syncedThroughEntryId = data?.syncedThroughEntryId ?? null;
    this.lastClaudeModelId = data?.lastClaudeModelId ?? null;
    this.sessionManager = sessionManager;
    this.activeQuery = null;
    this.currentStreamState = null;
    this.pendingToolCalls = new Map();
    this.pendingResults = new Map();
    this.turnToolCallIds = [];
    this.nextToolHandlerIndex = 0;
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
    this.pendingResults.clear();
    this.activeQuery = null;
    this.currentStreamState = null;
  }

  attachStreamState(state: StreamState) {
    this.currentStreamState = state;
  }

  detachStreamState(state: StreamState) {
    if (this.currentStreamState === state) {
      this.currentStreamState = null;
    }
  }

  resetToolCallIds() {
    this.turnToolCallIds = [];
    this.nextToolHandlerIndex = 0;
  }

  registerToolCallId(toolCallId: string) {
    if (!this.turnToolCallIds.includes(toolCallId)) {
      this.turnToolCallIds.push(toolCallId);
    }
  }

  handleMcpToolCall(toolName: string): Promise<CallToolResult> {
    const toolCallId = this.turnToolCallIds[this.nextToolHandlerIndex++];
    if (!toolCallId) {
      return Promise.resolve(createMcpTextResult(`Tool ${toolName} was called before Pi received a matching tool call id.`, true));
    }

    const queued = this.pendingResults.get(toolCallId);
    if (queued) {
      this.pendingResults.delete(toolCallId);
      return Promise.resolve(queued);
    }

    return new Promise<CallToolResult>((resolve) => {
      this.pendingToolCalls.set(toolCallId, { toolName, resolve });
    });
  }

  deliverToolResults(results: PiMcpResult[]) {
    for (const result of results) {
      const toolCallId = result.toolCallId;
      if (!toolCallId) continue;

      const pending = this.pendingToolCalls.get(toolCallId);
      if (pending) {
        this.pendingToolCalls.delete(toolCallId);
        pending.resolve(result);
      } else {
        this.pendingResults.set(toolCallId, result);
      }
    }
  }

  resolvePendingToolCalls(result: CallToolResult) {
    for (const pending of this.pendingToolCalls.values()) {
      pending.resolve(result);
    }
    this.pendingToolCalls.clear();
  }

  close() {
    this.resolvePendingToolCalls(createMcpTextResult("Session closed", true));
    this.pendingResults.clear();
    this.currentStreamState = null;
    this.turnToolCallIds = [];
    this.nextToolHandlerIndex = 0;

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
