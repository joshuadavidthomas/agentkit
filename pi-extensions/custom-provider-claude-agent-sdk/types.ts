import type { Query, SDKSession } from "@anthropic-ai/claude-agent-sdk";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@mariozechner/pi-ai";
import type { Component } from "@mariozechner/pi-tui";

export type UiHandle = {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
  confirm: (title: string, message: string) => Promise<boolean>;
  notify: (message: string, type?: "info" | "warning" | "error") => void;
};

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

export interface PersistedState {
  sdkSessionId?: string;
  syncedThroughEntryId?: string;
  lastClaudeModelId?: string;
}

export interface SessionManagerHandle {
  getBranch(fromId?: string): SessionEntry[];
  getEntries(): SessionEntry[];
  getLeafId(): string | null;
}

export interface ToolRenderState {
  toolUseId: string;
  rawName: string;
  args: Record<string, unknown>;
  partialJson: string;
  resultText?: string;
  isError: boolean;
  isComplete: boolean;
  elapsedSeconds?: number;
}

export interface TurnRenderState {
  running: boolean;
  sessionId?: string;
  model?: string;
  tools: ToolRenderState[];
  startedAt: number;
  finishedAt?: number;
}

export type ClaudeQueryHandle = Pick<
  Query,
  "accountInfo" | "getContextUsage" | "initializationResult" | "mcpServerStatus" | "reloadPlugins" | "supportedModels"
>;

export interface SessionRuntime {
  handle: SDKSession;
  model: string;
}

export interface ActiveTurn {
  model: Model<Api>;
  output: AssistantMessage;
  stream: AssistantMessageEventStream;
  blockMap: Map<number, number>;
  toolNameByIndex: Map<number, string>;
  toolIdByIndex: Map<number, string>;
  startedWithPersistedSession: boolean;
  shouldRetryFreshSession: boolean;
  finished: boolean;
}

export interface ClaudeExtensionState {
  sdkSessionId?: string;
  syncedThroughEntryId?: string;
  lastClaudeModelId?: string;
  debugLogPath?: string;
  ui?: UiHandle;
  cwd: string;
  turn?: TurnRenderState;
  widget?: Component & { dispose?(): void };
  session?: SessionRuntime;
  sessionManager?: SessionManagerHandle;
  activeTurn?: ActiveTurn;
  turnQueue: Promise<void>;
}
