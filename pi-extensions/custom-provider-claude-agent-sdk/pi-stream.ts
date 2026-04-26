import {
  calculateCost,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type ThinkingContent,
  type ToolCall,
} from "@mariozechner/pi-ai";
import type {
  AssistantBackfill,
  FinishedStopReason,
  TurnBlockDelta,
  TurnBlockStart,
  TurnEvent,
  TurnResult,
  TurnUpdate,
  TurnUsage,
} from "./claude-stream-events.js";
import type { ToolBridge } from "./tools/bridge.js";
import { stripMcpToolName } from "./tools/names.js";
interface StreamDelta {
  sourceBlockIndex: number;
  delta: string;
}

interface StreamSignature {
  sourceBlockIndex: number;
  signature: string;
}

interface StreamToolCallStart {
  sourceBlockIndex: number;
  id: string;
  name: string;
  args: ToolCall["arguments"];
}

type ActiveBlock =
  | { type: "text"; contentIndex: number }
  | { type: "thinking"; contentIndex: number }
  | { type: "toolCall"; contentIndex: number; partialJson: string };

export class PiStreamState {
  readonly output: AssistantMessage;

  private activeBlocks = new Map<number, ActiveBlock>();
  private started = false;
  private isFinished = false;
  private streamEventsReceived = false;
  private toolCallStarted = false;

  constructor(readonly model: Model<Api>, readonly stream: AssistantMessageEventStream) {
    this.output = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  get finished() {
    return this.isFinished;
  }

  markStreamingContentReceived() {
    this.streamEventsReceived = true;
  }

  acceptsAssistantBackfill() {
    return !this.streamEventsReceived;
  }

  finishToolUseIfPresent() {
    if (!this.toolCallStarted) return false;

    this.finish("toolUse");
    return true;
  }

  start() {
    if (this.started) return;

    this.started = true;
    this.stream.push({ type: "start", partial: this.output });
  }

  finish(reason: FinishedStopReason) {
    if (this.isFinished) return;

    this.start();
    this.isFinished = true;
    this.output.stopReason = reason;
    this.stream.push({ type: "done", reason, message: this.output });
    this.stream.end();
  }

  fail(message: string, aborted: boolean) {
    if (this.isFinished) return;

    this.start();
    this.isFinished = true;
    this.output.stopReason = aborted ? "aborted" : "error";
    this.output.errorMessage = message;
    this.stream.push({ type: "error", reason: this.output.stopReason, error: this.output });
    this.stream.end();
  }

  beginMessage(usage?: TurnUsage) {
    this.activeBlocks.clear();
    if (usage) this.applyUsage(usage);
  }

  applyUsage(usage: TurnUsage | undefined) {
    if (!usage) return;

    this.output.usage.input = usage.inputTokens ?? this.output.usage.input;
    this.output.usage.output = usage.outputTokens ?? this.output.usage.output;
    this.output.usage.cacheRead = usage.cacheReadTokens ?? this.output.usage.cacheRead;
    this.output.usage.cacheWrite = usage.cacheWriteTokens ?? this.output.usage.cacheWrite;
    this.output.usage.totalTokens =
      this.output.usage.input + this.output.usage.output + this.output.usage.cacheRead + this.output.usage.cacheWrite;
    calculateCost(this.model, this.output.usage);
  }

  setStopReason(reason: FinishedStopReason) {
    this.output.stopReason = reason;
  }

  backfillText(text: string) {
    const alreadyPresent = this.output.content.some((existing) => existing.type === "text" && existing.text === text);
    if (!alreadyPresent) {
      this.output.content.push({ type: "text", text });
    }
  }

  backfillThinking(thinking: string, signature: string) {
    if (this.output.content.length > 0) return;

    this.output.content.push({
      type: "thinking",
      thinking,
      thinkingSignature: signature,
    } as ThinkingContent);
  }

  backfillToolCall(id: string, name: string, args: ToolCall["arguments"]) {
    this.toolCallStarted = true;
    this.output.content.push({
      type: "toolCall",
      id,
      name,
      arguments: args,
    });
  }

  beginTextBlock(sourceBlockIndex: number) {
    this.start();
    this.output.content.push({ type: "text", text: "" });
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sourceBlockIndex, { type: "text", contentIndex });
    this.stream.push({ type: "text_start", contentIndex, partial: this.output });
  }

  appendTextDelta({ sourceBlockIndex, delta }: StreamDelta) {
    const active = this.activeBlocks.get(sourceBlockIndex);
    if (active?.type !== "text") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "text") return;

    block.text += delta;
    this.stream.push({ type: "text_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  beginThinkingBlock(sourceBlockIndex: number) {
    this.start();
    this.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as ThinkingContent);
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sourceBlockIndex, { type: "thinking", contentIndex });
    this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
  }

  appendThinkingDelta({ sourceBlockIndex, delta }: StreamDelta) {
    const active = this.activeBlocks.get(sourceBlockIndex);
    if (active?.type !== "thinking") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "thinking") return;

    block.thinking += delta;
    this.stream.push({ type: "thinking_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  appendThinkingSignature({ sourceBlockIndex, signature }: StreamSignature) {
    const active = this.activeBlocks.get(sourceBlockIndex);
    if (active?.type !== "thinking") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type === "thinking") {
      block.thinkingSignature = `${block.thinkingSignature ?? ""}${signature}`;
    }
  }

  beginToolCall({ sourceBlockIndex, id, name, args }: StreamToolCallStart) {
    this.start();
    this.toolCallStarted = true;
    this.output.content.push({ type: "toolCall", id, name, arguments: args });
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sourceBlockIndex, { type: "toolCall", contentIndex, partialJson: "" });
    this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
  }

  appendToolCallJson({ sourceBlockIndex, delta }: StreamDelta) {
    const active = this.activeBlocks.get(sourceBlockIndex);
    if (active?.type !== "toolCall") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "toolCall") return;

    active.partialJson += delta;
    block.arguments = parseToolArguments(active.partialJson, block.arguments);
    this.stream.push({ type: "toolcall_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  finishContentBlock(sourceBlockIndex: number) {
    const active = this.activeBlocks.get(sourceBlockIndex);
    if (!active) return;

    const block = this.output.content[active.contentIndex];
    this.activeBlocks.delete(sourceBlockIndex);

    if (block?.type === "text") {
      this.stream.push({ type: "text_end", contentIndex: active.contentIndex, content: block.text, partial: this.output });
    } else if (block?.type === "thinking") {
      this.stream.push({ type: "thinking_end", contentIndex: active.contentIndex, content: block.thinking, partial: this.output });
    } else if (block?.type === "toolCall" && active.type === "toolCall") {
      block.arguments = parseToolArguments(active.partialJson, block.arguments);
      this.stream.push({ type: "toolcall_end", contentIndex: active.contentIndex, toolCall: block, partial: this.output });
    }
  }
}

export function applyTurnUpdate(update: TurnUpdate, state: PiStreamState, toolBridge: ToolBridge): boolean {
  switch (update.type) {
    case "event":
      state.markStreamingContentReceived();
      return applyTurnEvent(update.event, state, toolBridge);
    case "assistantBackfill":
      return applyAssistantBackfill(update.backfill, state, toolBridge);
    case "result":
      return applyTurnResult(update.result, state);
  }
}

function applyAssistantBackfill(backfill: AssistantBackfill[], state: PiStreamState, toolBridge: ToolBridge): boolean {
  if (!state.acceptsAssistantBackfill() || backfill.length === 0) return false;

  toolBridge.beginMessage();
  for (const item of backfill) {
    applyAssistantBackfillItem(item, state, toolBridge);
  }

  return state.finishToolUseIfPresent();
}

function applyTurnResult(result: TurnResult, state: PiStreamState): boolean {
  if (state.finished) return false;

  state.applyUsage(result.usage);

  if (result.type === "error") {
    state.output.errorMessage = result.message;
    if (result.text) {
      state.backfillText(result.text);
    }
    state.fail(result.message, false);
    return true;
  }

  const hasText = state.output.content.some((block) => block.type === "text" && block.text.trim().length > 0);
  if (!hasText && result.text) {
    state.backfillText(result.text);
  }

  state.finish(result.stopReason);
  return true;
}

function applyTurnEvent(event: TurnEvent, state: PiStreamState, toolBridge: ToolBridge): boolean {
  switch (event.type) {
    case "messageStarted":
      state.beginMessage(event.usage);
      toolBridge.beginMessage();
      return false;
    case "blockStarted":
      applyBlockStart(event.block, state, toolBridge);
      return false;
    case "blockDelta":
      applyBlockDelta(event.sourceBlockIndex, event.delta, state);
      return false;
    case "blockFinished":
      state.finishContentBlock(event.sourceBlockIndex);
      return false;
    case "messageUpdated":
      state.setStopReason(event.stopReason);
      state.applyUsage(event.usage);
      return false;
    case "messageFinished":
      return state.finishToolUseIfPresent();
  }
}

function applyBlockStart(block: TurnBlockStart, state: PiStreamState, toolBridge: ToolBridge) {
  switch (block.kind) {
    case "text":
      state.beginTextBlock(block.sourceBlockIndex);
      return;
    case "thinking":
      state.beginThinkingBlock(block.sourceBlockIndex);
      return;
    case "toolCall": {
      const toolCall = {
        sourceBlockIndex: block.sourceBlockIndex,
        id: block.id,
        name: stripMcpToolName(block.mcpToolName),
        args: block.input as ToolCall["arguments"],
      };
      state.beginToolCall(toolCall);
      toolBridge.register(toolCall.id);
    }
  }
}

function applyBlockDelta(sourceBlockIndex: number, delta: TurnBlockDelta, state: PiStreamState) {
  switch (delta.kind) {
    case "text":
      state.appendTextDelta({ sourceBlockIndex, delta: delta.text });
      return;
    case "thinking":
      state.appendThinkingDelta({ sourceBlockIndex, delta: delta.thinking });
      return;
    case "thinkingSignature":
      state.appendThinkingSignature({ sourceBlockIndex, signature: delta.signature });
      return;
    case "toolInputJson":
      state.appendToolCallJson({ sourceBlockIndex, delta: delta.partialJson });
  }
}

function applyAssistantBackfillItem(item: AssistantBackfill, state: PiStreamState, toolBridge: ToolBridge) {
  switch (item.type) {
    case "text":
      state.backfillText(item.text);
      return;
    case "thinking":
      state.backfillThinking(item.thinking, item.signature);
      return;
    case "toolCall": {
      const name = stripMcpToolName(item.mcpToolName);
      state.backfillToolCall(item.id, name, item.input as ToolCall["arguments"]);
      toolBridge.register(item.id);
    }
  }
}

function parseToolArguments(partialJson: string, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!partialJson) return fallback;
  try {
    return JSON.parse(partialJson) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}
