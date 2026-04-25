import type { StopReason, ToolCall } from "@mariozechner/pi-ai";

export interface PromptTextBlock {
  type: "text";
  text: string;
}

export interface PromptImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

export type PromptBlock = PromptTextBlock | PromptImageBlock;

export type FinishedStopReason = Extract<StopReason, "stop" | "length" | "toolUse">;

export interface StreamDelta {
  sourceBlockIndex: number;
  delta: string;
}

export interface StreamSignature {
  sourceBlockIndex: number;
  signature: string;
}

export interface StreamToolCallStart {
  sourceBlockIndex: number;
  id: string;
  name: string;
  args: ToolCall["arguments"];
}
