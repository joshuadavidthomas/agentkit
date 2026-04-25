import { createRequire } from "node:module";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { extractSessionId, parseClaudeMessage } from "./claude-stream-events.js";
import { buildContextMessagesHandoff } from "./handoff.js";
import { extractLatestUserPrompt, toSdkPrompt } from "./prompt.js";
import { ClaudeSession, piSessionId } from "./session.js";
import {
  buildPiMcpServer,
  createMcpTextResult,
  DISALLOWED_BUILTIN_TOOLS,
  extractToolResults,
  MCP_SERVER_NAME,
  MCP_TOOL_PREFIX,
} from "./tools.js";
import {
  applyTurnUpdate,
  PiStreamState,
} from "./pi-stream.js";

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

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

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

function handleSdkQueryMessage(message: SDKMessage, session: ClaudeSession, state: PiStreamState): boolean {
  const update = parseClaudeMessage(message);
  return update ? applyTurnUpdate(update, state, session.toolCalls) : false;
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

function attachState(session: ClaudeSession, model: Model<Api>, stream: AssistantMessageEventStream): PiStreamState {
  const state = new PiStreamState(model, stream);
  session.attachStreamState(state);
  state.start();
  return state;
}

export function streamClaudeAgentSdkOneShot(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const session = new ClaudeSession(piSessionId("one-shot"));
  const state = attachState(session, model, stream);

  void runOneShotQuery(session, state, model, context, options);

  return stream;
}

async function runOneShotQuery(
  session: ClaudeSession,
  state: PiStreamState,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const abortController = createAbortController(options?.signal);
  let sdkQuery: ReturnType<typeof query> | undefined;

  if (abortController.signal.aborted) {
    state.fail("Claude Agent SDK one-shot request aborted", true);
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
      if (handleSdkQueryMessage(message, session, state)) {
        session.detachStreamState(state);
      }
    }

    if (!state.finished) {
      state.finish("stop");
    }
  } catch (error) {
    state.fail(errorMessage(error), abortController.signal.aborted || Boolean(options?.signal?.aborted));
  } finally {
    session.close();
    try {
      sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }
  }
}

export function streamClaudeAgentSdk(
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
    const state = new PiStreamState(model, stream);
    state.start();
    queueMicrotask(() => state.finish("stop"));
    return stream;
  }

  const state = attachState(session, model, stream);

  void runSessionQuery(session, state, model, context, options);

  return stream;
}

async function runSessionQuery(
  session: ClaudeSession,
  state: PiStreamState,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) {
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

  if (abortController.signal.aborted) {
    abortPending();
    state.fail("Claude Agent SDK request aborted", true);
    session.detachStreamState(state);
    return;
  }

  options?.signal?.addEventListener("abort", abortPending, { once: true });

  try {
    const handoff = session.prepareForTurn() ?? buildContextMessagesHandoff(context.messages);
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
      const sdkSessionId = extractSessionId(message);
      if (sdkSessionId) {
        session.captureSdkSessionId(sdkSessionId, model.id);
      }

      const currentState = session.currentStreamState;
      if (!currentState) continue;

      if (handleSdkQueryMessage(message, session, currentState)) {
        session.detachStreamState(currentState);
      }
    }

    const currentState = session.currentStreamState;
    if (currentState && !currentState.finished) {
      currentState.finish("stop");
      session.detachStreamState(currentState);
    }
  } catch (error) {
    const currentState = session.currentStreamState ?? state;
    currentState.fail(errorMessage(error), abortController.signal.aborted || Boolean(options?.signal?.aborted));
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
}
