import { createRequire } from "node:module";
import { query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type ThinkingContent,
  type ToolCall,
} from "@mariozechner/pi-ai";
import { buildContextMessagesHandoff } from "./handoff.js";
import { ClaudeSession } from "./session.js";
import {
  buildPiMcpServer,
  createMcpTextResult,
  DISALLOWED_BUILTIN_TOOLS,
  extractToolResults,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
  stripMcpToolName,
} from "./tools.js";
import type { PromptBlock, PromptImageBlock, PromptTextBlock, StreamState } from "./types.js";

const require = createRequire(import.meta.url);

// Local Linux x64 quirk: the SDK resolver selected its musl package on this
// machine, but the installed/working binary is the glibc package. Prefer that
// known-good binary here; other platforms and missing packages fall back to the
// SDK's normal executable resolution.
function resolveClaudeExecutable(): string | undefined {
  if (process.platform !== "linux" || process.arch !== "x64") return undefined;

  try {
    return require.resolve("@anthropic-ai/claude-agent-sdk-linux-x64/claude");
  } catch {
    return undefined;
  }
}

function createStreamState(model: Model<Api>, stream: AssistantMessageEventStream): StreamState {
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

function startStream(state: StreamState) {
  if (state.started) return;

  state.started = true;
  state.stream.push({ type: "start", partial: state.output });
}

function extractLatestUserPrompt(context: Context): string | PromptBlock[] {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message.role !== "user") continue;

    if (typeof message.content === "string") {
      return message.content;
    }

    const blocks = message.content.flatMap<PromptBlock>((item) => {
      if (item.type === "text") {
        return [{ type: "text", text: item.text }];
      }

      if (item.type === "image") {
        const mediaType = item.mimeType as PromptImageBlock["source"]["media_type"];
        if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
          return [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: item.data,
              },
            },
          ];
        }
      }

      return [];
    });

    if (blocks.length === 0) continue;

    if (blocks.every((block): block is PromptTextBlock => block.type === "text")) {
      return blocks.map((block) => block.text).join("\n");
    }

    return blocks;
  }

  throw new Error("No user prompt found in context");
}

function toSdkPrompt(prompt: string | PromptBlock[]): string | AsyncIterable<SDKUserMessage> {
  if (typeof prompt === "string") return prompt;

  return (async function* () {
    yield {
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
      shouldQuery: true,
    } satisfies SDKUserMessage;
  })();
}

function mapStopReason(reason: string | null): Extract<StopReason, "stop" | "length" | "toolUse"> {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "toolUse";
  return "stop";
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

function parseToolArguments(partialJson: string, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!partialJson) return fallback;
  try {
    return JSON.parse(partialJson) as Record<string, unknown>;
  } catch {
    return fallback;
  }
}

function finishStream(state: StreamState, reason: Extract<StopReason, "stop" | "length" | "toolUse">) {
  if (state.finished) return;

  startStream(state);
  state.finished = true;
  state.output.stopReason = reason;
  state.stream.push({ type: "done", reason, message: state.output });
  state.stream.end();
}

function finishToolUse(session: ClaudeSession, state: StreamState) {
  state.sawToolCall = true;
  finishStream(state, "toolUse");
  session.detachStreamState(state);
}

function failStream(error: unknown, state: StreamState, aborted: boolean) {
  if (state.finished) return;

  startStream(state);
  state.finished = true;
  state.output.stopReason = aborted ? "aborted" : "error";
  state.output.errorMessage = error instanceof Error ? error.message : String(error);
  state.stream.push({ type: "error", reason: state.output.stopReason, error: state.output });
  state.stream.end();
}

function handleStreamEvent(event: unknown, session: ClaudeSession, state: StreamState) {
  if (!event || typeof event !== "object") return;

  state.sawStreamEvent = true;
  const streamEvent = event as {
    type?: string;
    index?: number;
    message?: { usage?: unknown };
    content_block?: { type?: string; id?: string; name?: string; input?: Record<string, unknown> };
    delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; signature?: string; stop_reason?: string | null };
    usage?: unknown;
  };

  if (streamEvent.type === "message_start") {
    state.blockIndex.clear();
    state.toolJsonByIndex.clear();
    session.resetToolCallIds();
    if (streamEvent.message?.usage) updateUsage(state.model, state.output, streamEvent.message);
    return;
  }

  if (streamEvent.type === "content_block_start" && typeof streamEvent.index === "number") {
    startStream(state);

    if (streamEvent.content_block?.type === "text") {
      state.output.content.push({ type: "text", text: "" });
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(streamEvent.index, contentIndex);
      state.stream.push({ type: "text_start", contentIndex, partial: state.output });
      return;
    }

    if (streamEvent.content_block?.type === "thinking") {
      state.output.content.push({ type: "thinking", thinking: "", thinkingSignature: "" } as ThinkingContent);
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(streamEvent.index, contentIndex);
      state.stream.push({ type: "thinking_start", contentIndex, partial: state.output });
      return;
    }

    if (streamEvent.content_block?.type === "tool_use") {
      const toolCallId = streamEvent.content_block.id ?? `tool-${streamEvent.index}`;
      const rawName = streamEvent.content_block.name ?? "tool";
      const toolCall: ToolCall = {
        type: "toolCall",
        id: toolCallId,
        name: stripMcpToolName(rawName),
        arguments: streamEvent.content_block.input ?? {},
      };
      state.sawToolCall = true;
      session.registerToolCallId(toolCallId);
      state.output.content.push(toolCall);
      const contentIndex = state.output.content.length - 1;
      state.blockIndex.set(streamEvent.index, contentIndex);
      state.toolJsonByIndex.set(streamEvent.index, "");
      state.stream.push({ type: "toolcall_start", contentIndex, partial: state.output });
    }
    return;
  }

  if (streamEvent.type === "content_block_delta" && typeof streamEvent.index === "number") {
    const contentIndex = state.blockIndex.get(streamEvent.index);
    if (contentIndex === undefined) return;

    const block = state.output.content[contentIndex];
    if (streamEvent.delta?.type === "text_delta" && block?.type === "text") {
      const delta = streamEvent.delta.text ?? "";
      block.text += delta;
      state.stream.push({ type: "text_delta", contentIndex, delta, partial: state.output });
      return;
    }

    if (streamEvent.delta?.type === "thinking_delta" && block?.type === "thinking") {
      const delta = streamEvent.delta.thinking ?? "";
      block.thinking += delta;
      state.stream.push({ type: "thinking_delta", contentIndex, delta, partial: state.output });
      return;
    }

    if (streamEvent.delta?.type === "signature_delta" && block?.type === "thinking") {
      block.thinkingSignature = `${block.thinkingSignature ?? ""}${streamEvent.delta.signature ?? ""}`;
      return;
    }

    if (streamEvent.delta?.type === "input_json_delta" && block?.type === "toolCall") {
      const delta = streamEvent.delta.partial_json ?? "";
      const partialJson = `${state.toolJsonByIndex.get(streamEvent.index) ?? ""}${delta}`;
      state.toolJsonByIndex.set(streamEvent.index, partialJson);
      block.arguments = parseToolArguments(partialJson, block.arguments);
      state.stream.push({ type: "toolcall_delta", contentIndex, delta, partial: state.output });
    }
    return;
  }

  if (streamEvent.type === "content_block_stop" && typeof streamEvent.index === "number") {
    const contentIndex = state.blockIndex.get(streamEvent.index);
    if (contentIndex === undefined) return;

    const block = state.output.content[contentIndex];
    if (block?.type === "text") {
      state.stream.push({ type: "text_end", contentIndex, content: block.text, partial: state.output });
    } else if (block?.type === "thinking") {
      state.stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: state.output });
    } else if (block?.type === "toolCall") {
      block.arguments = parseToolArguments(state.toolJsonByIndex.get(streamEvent.index) ?? "", block.arguments);
      state.stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: state.output });
    }
    return;
  }

  if (streamEvent.type === "message_delta") {
    state.output.stopReason = mapStopReason(streamEvent.delta?.stop_reason ?? null);
    if (streamEvent.usage) updateUsage(state.model, state.output, streamEvent);
    return;
  }

  if (streamEvent.type === "message_stop" && state.sawToolCall) {
    finishToolUse(session, state);
  }
}

function backfillAssistantContent(message: Extract<SDKMessage, { type: "assistant" }>, session: ClaudeSession, state: StreamState) {
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

function completeFromResult(result: SDKResultMessage, session: ClaudeSession, state: StreamState | null) {
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

function createSdkEnv(apiKey?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "agentkit/pi-custom-provider-claude-agent-sdk",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };

  if (apiKey && apiKey !== "ANTHROPIC_API_KEY") {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  return env;
}

const baseQueryOptions = (model: Model<Api>, abortController: AbortController, apiKey?: string) => ({
  abortController,
  cwd: process.cwd(),
  pathToClaudeCodeExecutable: resolveClaudeExecutable(),
  model: model.id,
  disallowedTools: DISALLOWED_BUILTIN_TOOLS,
  includePartialMessages: true,
  settingSources: [],
  env: createSdkEnv(apiKey),
});

function handleSdkQueryMessage(message: SDKMessage, session: ClaudeSession, state: StreamState) {
  if (message.type === "stream_event") {
    handleStreamEvent(message.event, session, state);
    return;
  }

  if (message.type === "assistant") {
    backfillAssistantContent(message, session, state);
    return;
  }

  if (message.type === "result") {
    completeFromResult(message, session, state);
  }
}

function createAbortController(signal?: AbortSignal): AbortController {
  const abortController = new AbortController();
  if (!signal) return abortController;

  if (signal.aborted) {
    abortController.abort(signal.reason);
    return abortController;
  }

  signal.addEventListener("abort", () => abortController.abort(signal.reason), { once: true });
  return abortController;
}

function attachState(session: ClaudeSession, model: Model<Api>, stream: AssistantMessageEventStream): StreamState {
  const state = createStreamState(model, stream);
  session.attachStreamState(state);
  startStream(state);
  return state;
}

export function streamClaudeAgentSdkOneShot(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const session = new ClaudeSession("one-shot");
  const state = attachState(session, model, stream);

  void (async () => {
    const abortController = createAbortController(options?.signal);
    let sdkQuery: ReturnType<typeof query> | undefined;

    if (abortController.signal.aborted) {
      failStream(new Error("Claude Agent SDK one-shot request aborted"), state, true);
      session.detachStreamState(state);
      return;
    }

    try {
      sdkQuery = query({
        prompt: toSdkPrompt(extractLatestUserPrompt(context)),
        options: {
          ...baseQueryOptions(model, abortController, options?.apiKey),
          allowedTools: [],
          systemPrompt: context.systemPrompt,
          tools: [],
        },
      });

      for await (const message of sdkQuery) {
        handleSdkQueryMessage(message, session, state);
      }

      if (!state.finished) {
        finishStream(state, "stop");
      }
    } catch (error) {
      failStream(error, state, abortController.signal.aborted || Boolean(options?.signal?.aborted));
    } finally {
      session.close();
      try {
        sdkQuery?.close();
      } catch {
        // Ignore close failures.
      }
    }
  })();

  return stream;
}

export function streamClaudeAgentSdk(
  pi: ExtensionAPI,
  session: ClaudeSession,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  if (session.activeQuery) {
    attachState(session, model, stream);
    session.deliverToolResults(extractToolResults(context));
    return stream;
  }

  if (context.messages[context.messages.length - 1]?.role === "toolResult") {
    const state = createStreamState(model, stream);
    startStream(state);
    queueMicrotask(() => finishStream(state, "stop"));
    return stream;
  }

  const state = attachState(session, model, stream);

  void (async () => {
    const abortController = createAbortController(options?.signal);
    const mcpServer = buildPiMcpServer(context.tools, (toolName) => session.handleMcpToolCall(toolName));
    let sdkQuery: ReturnType<typeof query> | undefined;

    const abortPending = () => {
      session.resolvePendingToolCalls(createMcpTextResult("Operation aborted", true));
      try {
        sdkQuery?.close();
      } catch {
        // Ignore close failures.
      }
    };

    if (options?.signal?.aborted) {
      abortPending();
      failStream(new Error("Claude Agent SDK request aborted"), state, true);
      session.detachStreamState(state);
      return;
    }

    options?.signal?.addEventListener("abort", abortPending, { once: true });

    try {
      const handoff = session.prepareForTurn(pi) ?? buildContextMessagesHandoff(context.messages);
      let prompt = extractLatestUserPrompt(context);
      if (handoff) {
        const prefix = `${handoff}\n\nCurrent user message:\n`;
        prompt = typeof prompt === "string" ? `${prefix}${prompt}` : [{ type: "text", text: prefix }, ...prompt];
      }

      sdkQuery = query({
        prompt: toSdkPrompt(prompt),
        options: {
          ...baseQueryOptions(model, abortController, options?.apiKey),
          resume: session.sdkSessionId ?? undefined,
          allowedTools: mcpServer ? [`${MCP_TOOL_PREFIX}*`] : [],
          permissionMode: "bypassPermissions",
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: context.systemPrompt,
          },
          ...(mcpServer ? { mcpServers: { [MCP_SERVER_NAME]: mcpServer } } : { tools: [] }),
        },
      });
      session.beginQuery(sdkQuery);

      for await (const message of sdkQuery) {
        const sdkSessionId = (message as { session_id?: unknown }).session_id;
        if (typeof sdkSessionId === "string") {
          session.captureSdkSessionId(pi, sdkSessionId, model.id);
        }

        const currentState = session.currentStreamState;
        if (!currentState) continue;

        handleSdkQueryMessage(message, session, currentState);
      }

      const currentState = session.currentStreamState;
      if (currentState && !currentState.finished) {
        finishStream(currentState, "stop");
        session.detachStreamState(currentState);
      }
    } catch (error) {
      const currentState = session.currentStreamState ?? state;
      failStream(error, currentState, abortController.signal.aborted || Boolean(options?.signal?.aborted));
      session.detachStreamState(currentState);
    } finally {
      options?.signal?.removeEventListener("abort", abortPending);
      if (sdkQuery) {
        session.finishQuery(sdkQuery);
        try {
          sdkQuery.close();
        } catch {
          // Ignore close failures.
        }
      }
    }
  })();

  return stream;
}
