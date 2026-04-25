import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
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

export interface ExtensionBindings {
  cwd: string;
  ui: ExtensionContext["ui"];
  sessionManager: ExtensionContext["sessionManager"];
}

export interface Turn {
  readonly model: Model<Api>;
  readonly output: AssistantMessage;
  readonly stream: AssistantMessageEventStream;
  readonly blockIndex: Map<number, number>;
  readonly toolsByIndex: Map<number, { id: string; name: string }>;
  sessionId?: string;
  done: boolean;
}
