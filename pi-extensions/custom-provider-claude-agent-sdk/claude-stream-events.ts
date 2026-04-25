import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeStreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

export type ProviderStreamEvent =
  | { type: "messageStart"; usage?: unknown }
  | { type: "textStart"; sdkIndex: number }
  | { type: "textDelta"; sdkIndex: number; delta: string }
  | { type: "thinkingStart"; sdkIndex: number }
  | { type: "thinkingDelta"; sdkIndex: number; delta: string }
  | { type: "thinkingSignature"; sdkIndex: number; signature: string }
  | {
      type: "toolCallStart";
      sdkIndex: number;
      id: string;
      rawName: string;
      input: unknown;
    }
  | { type: "toolCallDelta"; sdkIndex: number; delta: string }
  | { type: "contentBlockStop"; sdkIndex: number }
  | { type: "messageDelta"; stopReason: string | null; usage?: unknown }
  | { type: "messageStop" };

export function parseClaudeStreamEvent(event: ClaudeStreamEvent): ProviderStreamEvent | undefined {
  switch (event.type) {
    case "message_start":
      return { type: "messageStart", usage: event.message.usage };

    case "content_block_start":
      switch (event.content_block.type) {
        case "text":
          return { type: "textStart", sdkIndex: event.index };
        case "thinking":
          return { type: "thinkingStart", sdkIndex: event.index };
        case "tool_use":
        case "mcp_tool_use":
          return {
            type: "toolCallStart",
            sdkIndex: event.index,
            id: event.content_block.id,
            rawName: event.content_block.name,
            input: event.content_block.input,
          };
        default:
          return undefined;
      }

    case "content_block_delta":
      switch (event.delta.type) {
        case "text_delta":
          return { type: "textDelta", sdkIndex: event.index, delta: event.delta.text };
        case "thinking_delta":
          return { type: "thinkingDelta", sdkIndex: event.index, delta: event.delta.thinking };
        case "signature_delta":
          return { type: "thinkingSignature", sdkIndex: event.index, signature: event.delta.signature };
        case "input_json_delta":
          return { type: "toolCallDelta", sdkIndex: event.index, delta: event.delta.partial_json };
        default:
          return undefined;
      }

    case "content_block_stop":
      return { type: "contentBlockStop", sdkIndex: event.index };

    case "message_delta":
      return { type: "messageDelta", stopReason: event.delta.stop_reason, usage: event.usage };

    case "message_stop":
      return { type: "messageStop" };
  }
}

