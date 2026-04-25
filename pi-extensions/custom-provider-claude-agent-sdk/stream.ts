import { createRequire } from "node:module";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
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
} from "./tools.js";
import {
  backfillAssistantContent,
  completeFromResult,
  createStreamState,
  failStream,
  finishStream,
  handleClaudeStreamEvent,
  startStream,
} from "./pi-stream.js";
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
    handleClaudeStreamEvent(message.event, session, state);
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
