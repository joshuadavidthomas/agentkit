import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@mariozechner/pi-ai";

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

export interface StreamState {
  model: Model<Api>;
  output: AssistantMessage;
  stream: AssistantMessageEventStream;
  blockIndex: Map<number, number>;
  finished: boolean;
}
