import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createMcpTextResult, type PiMcpResult } from "./results.js";

interface PendingToolCall {
  resolve: (result: CallToolResult) => void;
}

export class ToolBridge {
  private toolCallIds: string[] = [];
  private nextToolHandlerIndex = 0;
  private pendingToolCalls = new Map<string, PendingToolCall>();
  private pendingResults = new Map<string, CallToolResult>();

  resetTurn() {
    this.toolCallIds = [];
    this.nextToolHandlerIndex = 0;
  }

  register(toolCallId: string) {
    if (!this.toolCallIds.includes(toolCallId)) {
      this.toolCallIds.push(toolCallId);
    }
  }

  handleMcpToolCall(toolName: string): Promise<CallToolResult> {
    const toolCallId = this.toolCallIds[this.nextToolHandlerIndex++];
    if (!toolCallId) {
      return Promise.resolve(createMcpTextResult(`Tool ${toolName} was called before Pi received a matching tool call id.`, true));
    }

    const queued = this.pendingResults.get(toolCallId);
    if (queued) {
      this.pendingResults.delete(toolCallId);
      return Promise.resolve(queued);
    }

    return new Promise<CallToolResult>((resolve) => {
      this.pendingToolCalls.set(toolCallId, { resolve });
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

  clearQueuedResults() {
    this.pendingResults.clear();
  }
}
