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
import { ClaudeSession } from "./session.js";
import { stripMcpToolName } from "./tools.js";
import type { StreamState } from "./types.js";

export function createStreamState(model: Model<Api>, stream: AssistantMessageEventStream): StreamState {
  return {
    model,
    output: {
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
    },
    stream,
    blockIndex: new Map(),
    toolJsonByIndex: new Map(),
    finished: false,
    started: false,
    sawStreamEvent: false,
    sawToolCall: false,
  };
}

export function startStream(state: StreamState) {
  if (state.started) return;

  state.started = true;
  state.stream.push({ type: "start", partial: state.output });
}

export function finishStream(state: StreamState, reason: Extract<StopReason, "stop" | "length" | "toolUse">) {
  if (state.finished) return;

  startStream(state);
  state.finished = true;
  state.output.stopReason = reason;
  state.stream.push({ type: "done", reason, message: state.output });
  state.stream.end();
}

export function failStream(error: unknown, state: StreamState, aborted: boolean) {
  if (state.finished) return;

  startStream(state);
  state.finished = true;
  state.output.stopReason = aborted ? "aborted" : "error";
  state.output.errorMessage = error instanceof Error ? error.message : String(error);
  state.stream.push({ type: "error", reason: state.output.stopReason, error: state.output });
  state.stream.end();
}

export function handleClaudeStreamEvent(event: ClaudeStreamEvent, session: ClaudeSession, state: StreamState) {
  const providerEvent = parseClaudeStreamEvent(event);
  if (!providerEvent) return;

  state.sawStreamEvent = true;
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
      const alreadyPresent = state.output.content.some((existing) => existing.type === "text" && existing.text === item.text);
      if (!alreadyPresent) {
        state.output.content.push({ type: "text", text: item.text });
      }
      continue;
    }

    if (item.type === "thinking" && state.output.content.length === 0) {
      state.output.content.push({
        type: "thinking",
        thinking: typeof item.thinking === "string" ? item.thinking : "",
        thinkingSignature: typeof item.signature === "string" ? item.signature : "",
      } as ThinkingContent);
      continue;
    }

    if (item.type === "tool_use") {
      const toolCallId = typeof item.id === "string" ? item.id : `tool-${state.output.content.length}`;
      const rawName = typeof item.name === "string" ? item.name : "tool";
      const args = item.input && typeof item.input === "object" && !Array.isArray(item.input) ? item.input as Record<string, unknown> : {};
      const toolCall: ToolCall = {
        type: "toolCall",
        id: toolCallId,
        name: stripMcpToolName(rawName),
        arguments: args,
      };
      state.sawToolCall = true;
      session.registerToolCallId(toolCallId);
      state.output.content.push(toolCall);
    }
  }

  if (state.sawToolCall) {
    finishToolUse(session, state);
  }
}

export function completeFromResult(result: SDKResultMessage, session: ClaudeSession, state: StreamState | null) {
  if (!state || state.finished) return;

  updateUsage(state.model, state.output, result);

  if (result.is_error) {
    const resultText = "result" in result && result.result.trim() ? result.result : undefined;
    state.output.stopReason = "error";
    state.output.errorMessage = resultText ?? (result.subtype === "success" ? "Unknown Claude Agent SDK error" : result.errors.join("\n"));
    if (resultText && !state.output.content.some((block) => block.type === "text" && block.text === resultText)) {
      state.output.content.push({ type: "text", text: resultText });
    }
    failStream(state.output.errorMessage, state, false);
    session.detachStreamState(state);
    return;
  }

  const hasText = state.output.content.some((block) => block.type === "text" && block.text.trim().length > 0);
  if (!hasText && "result" in result && result.result.trim()) {
    state.output.content.push({ type: "text", text: result.result });
  }

  const doneReason = mapStopReason(result.stop_reason);
  finishStream(state, doneReason);
  session.detachStreamState(state);
}

function applyProviderStreamEvent(event: ProviderStreamEvent, session: ClaudeSession, state: StreamState) {
  switch (event.type) {
    case "messageStart":
      state.blockIndex.clear();
      state.toolJsonByIndex.clear();
      session.resetToolCallIds();
      if (event.usage) updateUsage(state.model, state.output, { usage: event.usage });
      return;

    case "textStart": {
      startStream(state);
      state.output.content.push({ type: "text", text: "" });
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(event.sdkIndex, contentIndex);
      state.stream.push({ type: "text_start", contentIndex, partial: state.output });
      return;
    }

    case "thinkingStart": {
      startStream(state);
      state.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as ThinkingContent);
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(event.sdkIndex, contentIndex);
      state.stream.push({ type: "thinking_start", contentIndex, partial: state.output });
      return;
    }

    case "toolCallStart": {
      startStream(state);
      const toolCall: ToolCall = {
        type: "toolCall",
        id: event.id,
        name: stripMcpToolName(event.rawName),
        arguments: event.input as ToolCall["arguments"],
      };
      state.sawToolCall = true;
      session.registerToolCallId(event.id);
      state.output.content.push(toolCall);
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(event.sdkIndex, contentIndex);
      state.toolJsonByIndex.set(event.sdkIndex, "");
      state.stream.push({ type: "toolcall_start", contentIndex, partial: state.output });
      return;
    }

    case "textDelta": {
      const contentIndex = state.blockIndex.get(event.sdkIndex);
      const block = contentIndex === undefined ? undefined : state.output.content[contentIndex];
      if (contentIndex === undefined || block?.type !== "text") return;

      block.text += event.delta;
      state.stream.push({ type: "text_delta", contentIndex, delta: event.delta, partial: state.output });
      return;
    }

    case "thinkingDelta": {
      const contentIndex = state.blockIndex.get(event.sdkIndex);
      const block = contentIndex === undefined ? undefined : state.output.content[contentIndex];
      if (contentIndex === undefined || block?.type !== "thinking") return;

      block.thinking += event.delta;
      state.stream.push({ type: "thinking_delta", contentIndex, delta: event.delta, partial: state.output });
      return;
    }

    case "thinkingSignature": {
      const contentIndex = state.blockIndex.get(event.sdkIndex);
      const block = contentIndex === undefined ? undefined : state.output.content[contentIndex];
      if (block?.type === "thinking") {
        block.thinkingSignature = `${block.thinkingSignature ?? ""}${event.signature}`;
      }
      return;
    }

    case "toolCallDelta": {
      const contentIndex = state.blockIndex.get(event.sdkIndex);
      const block = contentIndex === undefined ? undefined : state.output.content[contentIndex];
      if (contentIndex === undefined || block?.type !== "toolCall") return;

      const partialJson = `${state.toolJsonByIndex.get(event.sdkIndex) ?? ""}${event.delta}`;
      state.toolJsonByIndex.set(event.sdkIndex, partialJson);
      block.arguments = parseToolArguments(partialJson, block.arguments);
      state.stream.push({ type: "toolcall_delta", contentIndex, delta: event.delta, partial: state.output });
      return;
    }

    case "contentBlockStop": {
      const contentIndex = state.blockIndex.get(event.sdkIndex);
      if (contentIndex === undefined) return;

      const block = state.output.content[contentIndex];
      if (block?.type === "text") {
        state.stream.push({ type: "text_end", contentIndex, content: block.text, partial: state.output });
      } else if (block?.type === "thinking") {
        state.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: state.output });
      } else if (block?.type === "toolCall") {
        block.arguments = parseToolArguments(state.toolJsonByIndex.get(event.sdkIndex) ?? "", block.arguments);
        state.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: state.output });
      }
      return;
    }

    case "messageDelta":
      state.output.stopReason = mapStopReason(event.stopReason);
      if (event.usage) updateUsage(state.model, state.output, { usage: event.usage });
      return;

    case "messageStop":
      if (state.sawToolCall) finishToolUse(session, state);
  }
}

function updateUsage(model: Model<Api>, output: AssistantMessage, result: SDKResultMessage | { usage?: unknown }) {
  const usage = (result.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  output.usage.input = usage.input_tokens ?? output.usage.input;
  output.usage.output = usage.output_tokens ?? output.usage.output;
  output.usage.cacheRead = usage.cache_read_input_tokens ?? output.usage.cacheRead;
  output.usage.cacheWrite = usage.cache_creation_input_tokens ?? output.usage.cacheWrite;
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
}

function mapStopReason(reason: string | null): Extract<StopReason, "stop" | "length" | "toolUse"> {
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
  state.sawToolCall = true;
  finishStream(state, "toolUse");
  session.detachStreamState(state);
}
