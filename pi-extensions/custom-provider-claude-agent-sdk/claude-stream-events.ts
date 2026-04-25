import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { FinishedStopReason } from "./types.js";

export type ClaudeStreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];
export type ClaudeAssistantMessage = Extract<SDKMessage, { type: "assistant" }>;

export function extractSessionId(message: SDKMessage): string | undefined {
  return typeof message.session_id === "string" ? message.session_id : undefined;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type TurnEvent =
  | { type: "messageStarted"; usage?: TurnUsage }
  | { type: "blockStarted"; block: TurnBlockStart }
  | { type: "blockDelta"; sourceBlockIndex: number; delta: TurnBlockDelta }
  | { type: "blockFinished"; sourceBlockIndex: number }
  | { type: "messageUpdated"; stopReason: FinishedStopReason; usage?: TurnUsage }
  | { type: "messageFinished" };

export type TurnBlockStart =
  | { kind: "text"; sourceBlockIndex: number }
  | { kind: "thinking"; sourceBlockIndex: number }
  | { kind: "toolCall"; sourceBlockIndex: number; id: string; mcpToolName: string; input: unknown };

export type TurnBlockDelta =
  | { kind: "text"; text: string }
  | { kind: "thinking"; thinking: string }
  | { kind: "thinkingSignature"; signature: string }
  | { kind: "toolInputJson"; partialJson: string };

export type AssistantBackfill =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "toolCall"; id: string; mcpToolName: string; input: unknown };

export type TurnResult =
  | { type: "error"; message: string; text?: string; usage?: TurnUsage }
  | { type: "done"; stopReason: FinishedStopReason; text?: string; usage?: TurnUsage };

export function parseClaudeStreamEvent(event: ClaudeStreamEvent): TurnEvent | undefined {
  switch (event.type) {
    case "message_start":
      return { type: "messageStarted", usage: parseClaudeUsage(event.message.usage) };

    case "content_block_start":
      switch (event.content_block.type) {
        case "text":
          return { type: "blockStarted", block: { kind: "text", sourceBlockIndex: event.index } };
        case "thinking":
          return { type: "blockStarted", block: { kind: "thinking", sourceBlockIndex: event.index } };
        case "tool_use":
        case "mcp_tool_use":
          return {
            type: "blockStarted",
            block: {
              kind: "toolCall",
              sourceBlockIndex: event.index,
              id: event.content_block.id,
              mcpToolName: event.content_block.name,
              input: event.content_block.input,
            },
          };
        default:
          return undefined;
      }

    case "content_block_delta":
      switch (event.delta.type) {
        case "text_delta":
          return { type: "blockDelta", sourceBlockIndex: event.index, delta: { kind: "text", text: event.delta.text } };
        case "thinking_delta":
          return { type: "blockDelta", sourceBlockIndex: event.index, delta: { kind: "thinking", thinking: event.delta.thinking } };
        case "signature_delta":
          return {
            type: "blockDelta",
            sourceBlockIndex: event.index,
            delta: { kind: "thinkingSignature", signature: event.delta.signature },
          };
        case "input_json_delta":
          return {
            type: "blockDelta",
            sourceBlockIndex: event.index,
            delta: { kind: "toolInputJson", partialJson: event.delta.partial_json },
          };
        default:
          return undefined;
      }

    case "content_block_stop":
      return { type: "blockFinished", sourceBlockIndex: event.index };

    case "message_delta":
      return { type: "messageUpdated", stopReason: mapStopReason(event.delta.stop_reason), usage: parseClaudeUsage(event.usage) };

    case "message_stop":
      return { type: "messageFinished" };
  }
}

export function parseClaudeAssistantMessage(message: ClaudeAssistantMessage): AssistantBackfill[] {
  const backfill: AssistantBackfill[] = [];

  for (const block of message.message.content) {
    if (block.type === "text") {
      backfill.push({ type: "text", text: block.text });
      continue;
    }

    if (block.type === "thinking") {
      backfill.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
      continue;
    }

    if (block.type === "tool_use" || block.type === "mcp_tool_use") {
      backfill.push({
        type: "toolCall",
        id: block.id,
        mcpToolName: block.name,
        input: block.input,
      });
    }
  }

  return backfill;
}

export function parseClaudeResultMessage(result: SDKResultMessage): TurnResult {
  const usage = parseClaudeUsage(result.usage);
  const text = "result" in result && result.result.trim() ? result.result : undefined;

  if (result.is_error) {
    return {
      type: "error",
      message: text ?? (result.subtype === "success" ? "Unknown Claude Agent SDK error" : result.errors.join("\n")),
      text,
      usage,
    };
  }

  return { type: "done", stopReason: mapStopReason(result.stop_reason), text, usage };
}

function parseClaudeUsage(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
} | null | undefined): TurnUsage | undefined {
  if (!usage) return undefined;

  return {
    inputTokens: usage.input_tokens ?? undefined,
    outputTokens: usage.output_tokens ?? undefined,
    cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
  };
}

function mapStopReason(reason: string | null): FinishedStopReason {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "toolUse";
  return "stop";
}
