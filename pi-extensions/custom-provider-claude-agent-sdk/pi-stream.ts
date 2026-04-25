import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  calculateCost,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type StopReason,
  type ThinkingContent,
  type ToolCall,
} from "@mariozechner/pi-ai";
import { parseClaudeStreamEvent, type ClaudeStreamEvent, type ProviderStreamEvent } from "./claude-stream-events.js";
import type { ClaudeSession } from "./session.js";
import { stripMcpToolName } from "./tools.js";
import type { FinishedStopReason, StreamState } from "./types.js";

type ActiveBlock =
  | { type: "text"; contentIndex: number }
  | { type: "thinking"; contentIndex: number }
  | { type: "toolCall"; contentIndex: number; partialJson: string };

class PiStreamState implements StreamState {
  readonly output: AssistantMessage;

  private activeBlocks = new Map<number, ActiveBlock>();
  private started = false;
  private isFinished = false;
  private didSeeStreamEvent = false;
  private didSeeToolCall = false;

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

  get sawStreamEvent() {
    return this.didSeeStreamEvent;
  }

  get sawToolCall() {
    return this.didSeeToolCall;
  }

  markSawStreamEvent() {
    this.didSeeStreamEvent = true;
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

  fail(error: unknown, aborted: boolean) {
    if (this.isFinished) return;

    this.start();
    this.isFinished = true;
    this.output.stopReason = aborted ? "aborted" : "error";
    this.output.errorMessage = error instanceof Error ? error.message : String(error);
    this.stream.push({ type: "error", reason: this.output.stopReason, error: this.output });
    this.stream.end();
  }

  beginMessage(usage?: unknown) {
    this.activeBlocks.clear();
    if (usage) this.applyUsage(usage);
  }

  applyUsage(rawUsage: unknown) {
    const usage = (rawUsage ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };

    this.output.usage.input = usage.input_tokens ?? this.output.usage.input;
    this.output.usage.output = usage.output_tokens ?? this.output.usage.output;
    this.output.usage.cacheRead = usage.cache_read_input_tokens ?? this.output.usage.cacheRead;
    this.output.usage.cacheWrite = usage.cache_creation_input_tokens ?? this.output.usage.cacheWrite;
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
    this.didSeeToolCall = true;
    this.output.content.push({
      type: "toolCall",
      id,
      name,
      arguments: args,
    });
  }

  beginTextBlock(sdkIndex: number) {
    this.start();
    this.output.content.push({ type: "text", text: "" });
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sdkIndex, { type: "text", contentIndex });
    this.stream.push({ type: "text_start", contentIndex, partial: this.output });
  }

  appendTextDelta(sdkIndex: number, delta: string) {
    const active = this.activeBlocks.get(sdkIndex);
    if (active?.type !== "text") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "text") return;

    block.text += delta;
    this.stream.push({ type: "text_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  beginThinkingBlock(sdkIndex: number) {
    this.start();
    this.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as ThinkingContent);
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sdkIndex, { type: "thinking", contentIndex });
    this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
  }

  appendThinkingDelta(sdkIndex: number, delta: string) {
    const active = this.activeBlocks.get(sdkIndex);
    if (active?.type !== "thinking") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "thinking") return;

    block.thinking += delta;
    this.stream.push({ type: "thinking_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  appendThinkingSignature(sdkIndex: number, signature: string) {
    const active = this.activeBlocks.get(sdkIndex);
    if (active?.type !== "thinking") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type === "thinking") {
      block.thinkingSignature = `${block.thinkingSignature ?? ""}${signature}`;
    }
  }

  beginToolCall(sdkIndex: number, id: string, name: string, args: ToolCall["arguments"]) {
    this.start();
    this.didSeeToolCall = true;
    this.output.content.push({ type: "toolCall", id, name, arguments: args });
    const contentIndex = this.output.content.length - 1;
    this.activeBlocks.set(sdkIndex, { type: "toolCall", contentIndex, partialJson: "" });
    this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
  }

  appendToolCallJson(sdkIndex: number, delta: string) {
    const active = this.activeBlocks.get(sdkIndex);
    if (active?.type !== "toolCall") return;

    const block = this.output.content[active.contentIndex];
    if (block?.type !== "toolCall") return;

    active.partialJson += delta;
    block.arguments = parseToolArguments(active.partialJson, block.arguments);
    this.stream.push({ type: "toolcall_delta", contentIndex: active.contentIndex, delta, partial: this.output });
  }

  finishContentBlock(sdkIndex: number) {
    const active = this.activeBlocks.get(sdkIndex);
    if (!active) return;

    const block = this.output.content[active.contentIndex];
    this.activeBlocks.delete(sdkIndex);

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

export function createStreamState(model: Model<Api>, stream: AssistantMessageEventStream): StreamState {
  return new PiStreamState(model, stream);
}

export function startStream(state: StreamState) {
  state.start();
}

export function finishStream(state: StreamState, reason: Extract<StopReason, "stop" | "length" | "toolUse">) {
  state.finish(reason);
}

export function failStream(error: unknown, state: StreamState, aborted: boolean) {
  state.fail(error, aborted);
}

export function handleClaudeStreamEvent(event: ClaudeStreamEvent, session: ClaudeSession, state: StreamState) {
  const providerEvent = parseClaudeStreamEvent(event);
  if (!providerEvent) return;

  state.markSawStreamEvent();
  applyProviderStreamEvent(providerEvent, session, state);
}

export function backfillAssistantContent(
  message: Extract<SDKMessage, { type: "assistant" }>,
  session: ClaudeSession,
  state: StreamState,
) {
  if (state.sawStreamEvent) return;

  const blocks = (message.message as { content?: unknown; usage?: unknown }).content;
  if (!Array.isArray(blocks)) return;

  session.resetToolCallIds();

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const item = block as Record<string, unknown>;

    if (item.type === "text" && typeof item.text === "string") {
      state.backfillText(item.text);
      continue;
    }

    if (item.type === "thinking") {
      state.backfillThinking(
        typeof item.thinking === "string" ? item.thinking : "",
        typeof item.signature === "string" ? item.signature : "",
      );
      continue;
    }

    if (item.type === "tool_use") {
      const toolCallId = typeof item.id === "string" ? item.id : `tool-${state.output.content.length}`;
      const rawName = typeof item.name === "string" ? item.name : "tool";
      state.backfillToolCall(toolCallId, stripMcpToolName(rawName), item.input as ToolCall["arguments"]);
      session.registerToolCallId(toolCallId);
    }
  }

  if (state.sawToolCall) {
    finishToolUse(session, state);
  }
}

export function completeFromResult(result: SDKResultMessage, session: ClaudeSession, state: StreamState | null) {
  if (!state || state.finished) return;

  state.applyUsage(result.usage);

  if (result.is_error) {
    const resultText = "result" in result && result.result.trim() ? result.result : undefined;
    state.output.errorMessage = resultText ?? (result.subtype === "success" ? "Unknown Claude Agent SDK error" : result.errors.join("\n"));
    if (resultText) {
      state.backfillText(resultText);
    }
    state.fail(state.output.errorMessage, false);
    session.detachStreamState(state);
    return;
  }

  const hasText = state.output.content.some((block) => block.type === "text" && block.text.trim().length > 0);
  if (!hasText && "result" in result && result.result.trim()) {
    state.backfillText(result.result);
  }

  state.finish(mapStopReason(result.stop_reason));
  session.detachStreamState(state);
}

function applyProviderStreamEvent(event: ProviderStreamEvent, session: ClaudeSession, state: StreamState) {
  switch (event.type) {
    case "messageStart":
      state.beginMessage(event.usage);
      session.resetToolCallIds();
      return;
    case "textStart":
      state.beginTextBlock(event.sdkIndex);
      return;
    case "textDelta":
      state.appendTextDelta(event.sdkIndex, event.delta);
      return;
    case "thinkingStart":
      state.beginThinkingBlock(event.sdkIndex);
      return;
    case "thinkingDelta":
      state.appendThinkingDelta(event.sdkIndex, event.delta);
      return;
    case "thinkingSignature":
      state.appendThinkingSignature(event.sdkIndex, event.signature);
      return;
    case "toolCallStart":
      state.beginToolCall(event.sdkIndex, event.id, stripMcpToolName(event.rawName), event.input as ToolCall["arguments"]);
      session.registerToolCallId(event.id);
      return;
    case "toolCallDelta":
      state.appendToolCallJson(event.sdkIndex, event.delta);
      return;
    case "contentBlockStop":
      state.finishContentBlock(event.sdkIndex);
      return;
    case "messageDelta":
      state.setStopReason(mapStopReason(event.stopReason));
      state.applyUsage(event.usage);
      return;
    case "messageStop":
      if (state.sawToolCall) finishToolUse(session, state);
  }
}

function mapStopReason(reason: string | null): FinishedStopReason {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "toolUse";
  return "stop";
}

function parseToolArguments(partialJson: string, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!partialJson) return fallback;
  try {
    return JSON.parse(partialJson) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function finishToolUse(session: ClaudeSession, state: StreamState) {
  state.finish("toolUse");
  session.detachStreamState(state);
}
