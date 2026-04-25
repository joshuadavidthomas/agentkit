import type { Api, AssistantMessage, AssistantMessageEventStream, Model, StopReason, ToolCall } from "@mariozechner/pi-ai";

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

export interface StreamState {
  readonly model: Model<Api>;
  readonly output: AssistantMessage;
  readonly stream: AssistantMessageEventStream;
  readonly finished: boolean;
  readonly sawStreamEvent: boolean;
  readonly sawToolCall: boolean;

  markSawStreamEvent(): void;
  start(): void;
  finish(reason: FinishedStopReason): void;
  fail(error: unknown, aborted: boolean): void;

  beginMessage(usage?: unknown): void;
  applyUsage(usage: unknown): void;
  setStopReason(reason: FinishedStopReason): void;
  backfillText(text: string): void;
  backfillThinking(thinking: string, signature: string): void;
  backfillToolCall(id: string, name: string, args: ToolCall["arguments"]): void;
  beginTextBlock(sdkIndex: number): void;
  appendTextDelta(sdkIndex: number, delta: string): void;
  beginThinkingBlock(sdkIndex: number): void;
  appendThinkingDelta(sdkIndex: number, delta: string): void;
  appendThinkingSignature(sdkIndex: number, signature: string): void;
  beginToolCall(sdkIndex: number, id: string, name: string, args: ToolCall["arguments"]): void;
  appendToolCallJson(sdkIndex: number, delta: string): void;
  finishContentBlock(sdkIndex: number): void;
}
