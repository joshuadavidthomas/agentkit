import { createRequire } from "node:module";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type Tool as PiTool,
} from "@mariozechner/pi-ai";
import { buildContextMessagesHandoff } from "../handoff.js";
import { PiStreamState, applyTurnUpdate } from "../pi-stream.js";
import { ClaudeSession, ClaudeTurn } from "../session.js";
import { buildPiMcpServer } from "../tools/mcp-server.js";
import { MCP_SERVER_NAME, MCP_TOOL_PREFIX } from "../tools/names.js";
import { createMcpTextResult, extractToolResults } from "../tools/results.js";
import { extractSessionId, parseClaudeMessage } from "./events.js";
import { extractLatestUserPrompt, toSdkPrompt } from "./prompt.js";
import { SdkInputQueue } from "./queue.js";
import { debug, flushTally, tally, time } from "./debug.js";

export type SdkQuery = ReturnType<typeof query>;

const require = createRequire(import.meta.url);

// Local Linux x64 quirk: the SDK resolver selected its musl package on my
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

// This provider is OAuth/subscription-only by design — if API billing is
// what you want, pi's built-in anthropic provider is the better path. Strip
// ANTHROPIC_API_KEY from the env we hand the spawned `claude` binary so the
// CLI falls back to OAuth credentials from `claude auth login`, regardless
// of what the parent shell exports.
function createSdkEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    CLAUDE_AGENT_SDK_CLIENT_APP: "agentkit/pi-custom-provider-claude-agent-sdk",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  };
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function fingerprintTools(tools: PiTool[] | undefined): string {
  if (!tools || tools.length === 0) return "[]";
  return JSON.stringify(
    tools.map((tool) => [tool.name, tool.description ?? "", tool.parameters ?? null]),
  );
}

function shouldCloseLiveQueryAfterTurn(): boolean {
  return process.argv.includes("-p") || process.argv.includes("--print");
}

const baseQueryOptions = (model: Model<Api>, abortController: AbortController) => ({
  abortController,
  cwd: process.cwd(),
  pathToClaudeCodeExecutable: resolveClaudeExecutable(),
  model: model.id,
  tools: [],
  includePartialMessages: true,
  settingSources: [],
  ...(process.env.PI_CLAUDE_AGENT_SDK_DEBUG ? {
    debugFile: "/tmp/pi-claude-code-debug.log",
    stderr: (data: string) => debug("claude-code:stderr", { data }),
  } : {}),
  env: createSdkEnv(),
});

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

export function streamClaudeAgentSdkOneShot(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const turn = new ClaudeTurn(new PiStreamState(model, stream));

  void runOneShotQuery(turn, model, context, options);

  return stream;
}

async function runOneShotQuery(
  turn: ClaudeTurn,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const abortController = createAbortController(options?.signal);
  let sdkQuery: ReturnType<typeof query> | undefined;

  if (abortController.signal.aborted) {
    turn.abort("Claude Agent SDK one-shot request aborted");
    return;
  }

  try {
    sdkQuery = query({
      prompt: toSdkPrompt(extractLatestUserPrompt(context)),
      options: {
        ...baseQueryOptions(model, abortController),
        allowedTools: [],
        systemPrompt: context.systemPrompt,
      },
    });

    for await (const message of sdkQuery) {
      const state = turn.streamState();
      if (!state) continue;

      const update = parseClaudeMessage(message);
      if (update && applyTurnUpdate(update, state, turn.toolBridge)) {
        turn.detachStreamState(state);
      }
    }

    const state = turn.streamState();
    if (state && !state.finished) {
      state.finish("stop");
    }
  } catch (error) {
    turn.streamState()?.fail(errorMessage(error), abortController.signal.aborted || Boolean(options?.signal?.aborted));
  } finally {
    try {
      sdkQuery?.close();
    } catch {
      // Ignore close failures.
    }
    turn.abort("Claude Agent SDK one-shot request ended");
  }
}

export function streamClaudeAgentSdk(
  session: ClaudeSession,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  const latestRole = context.messages[context.messages.length - 1]?.role;
  const activeTurn = session.currentTurn();
  if (activeTurn && latestRole === "toolResult") {
    activeTurn.attachStreamState(new PiStreamState(model, stream));
    activeTurn.toolBridge.deliverToolResults(extractToolResults(context));
    void finishToolContinuation(session, activeTurn, options?.signal);
    return stream;
  }

  if (activeTurn) {
    session.closeLiveQuery("Turn replaced");
  }

  if (latestRole === "toolResult") {
    const state = new PiStreamState(model, stream);
    state.start();
    queueMicrotask(() => state.finish("stop"));
    return stream;
  }

  void runSessionQuery(session, model, stream, context, options);

  return stream;
}

async function finishToolContinuation(session: ClaudeSession, turn: ClaudeTurn, signal?: AbortSignal) {
  const abortPending = () => {
    session.closeLiveQuery("Operation aborted");
  };
  signal?.addEventListener("abort", abortPending, { once: true });

  try {
    await turn.done();
    if (turn.streamOutputStopReason() !== "toolUse") {
      session.finishActiveTurn(turn);
      if (shouldCloseLiveQueryAfterTurn()) {
        session.closeLiveQuery("Print-mode turn finished");
      }
    }
  } finally {
    signal?.removeEventListener("abort", abortPending);
  }
}

async function runSessionQuery(
  session: ClaudeSession,
  model: Model<Api>,
  stream: AssistantMessageEventStream,
  context: Context,
  options?: SimpleStreamOptions,
) {
  debug("runSessionQuery:start", {
    messageCount: context.messages.length,
    latestRole: context.messages[context.messages.length - 1]?.role,
    hasContinuity: Boolean(session.continuityState().sdkSessionId),
    signalAborted: Boolean(options?.signal?.aborted),
  });

  if (options?.signal?.aborted) {
    debug("runSessionQuery:already-aborted");
    const state = new PiStreamState(model, stream);
    state.start();
    state.fail("Claude Agent SDK request aborted", true);
    return;
  }

  let turn: ClaudeTurn | undefined;
  let closeAfterTurn = false;

  try {
    const handoff = session.prepareForTurn() ?? buildContextMessagesHandoff(context.messages);
    turn = session.beginTurn(new PiStreamState(model, stream));
    const activeTurn = turn;
    const mcpServer = buildPiMcpServer(context.tools, (toolName) => {
      const currentTurn = session.currentTurn();
      if (!currentTurn) {
        const message = `Pi turn ended before Claude Agent SDK tool ${toolName} could be routed.`;
        session.closeLiveQuery(message);
        return Promise.resolve(createMcpTextResult(message, true));
      }
      return currentTurn.toolBridge.handleMcpToolCall(toolName);
    });

    await ensureLiveQuery(session, model, context, options, mcpServer);
    await session.setModel(model.id);
    await session.setMcpServers(
      mcpServer ? { [MCP_SERVER_NAME]: mcpServer } : {},
      fingerprintTools(context.tools),
    );

    const abortPending = () => {
      debug("runSessionQuery:signal-abort");
      session.closeLiveQuery("Operation aborted");
    };
    options?.signal?.addEventListener("abort", abortPending, { once: true });

    let noOutputTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const inputMessages = [toSdkUserMessage(promptForTurn(context, handoff))];
      debug("runSessionQuery:push-input", { count: inputMessages.length, replay: false, handoff: Boolean(handoff) });

      for (const message of inputMessages) {
        if (!session.pushUserMessage(message)) {
          throw new Error("Claude SDK input stream is closed");
        }
      }

      noOutputTimer = setTimeout(() => {
        const state = activeTurn.streamState();
        if (session.currentTurn() !== activeTurn || !state || state.finished || state.output.content.length > 0) return;
        debug("runSessionQuery:no-output-timeout");
        session.resetContinuity("Claude Agent SDK produced no assistant output before timeout");
      }, 90_000);
      noOutputTimer.unref?.();

      await activeTurn.done();
      closeAfterTurn = activeTurn.streamOutputStopReason() !== "toolUse";
    } finally {
      if (noOutputTimer) clearTimeout(noOutputTimer);
      options?.signal?.removeEventListener("abort", abortPending);
    }
  } catch (error) {
    debug("runSessionQuery:error", { message: errorMessage(error), signalAborted: Boolean(options?.signal?.aborted) });
    const currentState = turn?.streamState();
    currentState?.fail(errorMessage(error), Boolean(options?.signal?.aborted));
    if (currentState) {
      turn?.detachStreamState(currentState);
    }
    session.closeLiveQuery(errorMessage(error));
  } finally {
    if (turn && closeAfterTurn) {
      session.finishActiveTurn(turn);
    }
    if (closeAfterTurn && shouldCloseLiveQueryAfterTurn()) {
      session.closeLiveQuery("Print-mode turn finished");
    }
  }
}

function promptForTurn(context: Context, handoff: string | undefined) {
  let prompt = extractLatestUserPrompt(context);
  if (handoff) {
    const prefix = `${handoff}\n\nCurrent user message:\n`;
    prompt = typeof prompt === "string" ? `${prefix}${prompt}` : [{ type: "text" as const, text: prefix }, ...prompt];
  }
  return prompt;
}

function toSdkUserMessage(prompt: ReturnType<typeof extractLatestUserPrompt>): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
    shouldQuery: true,
  };
}

async function ensureLiveQuery(
  session: ClaudeSession,
  model: Model<Api>,
  context: Context,
  options: SimpleStreamOptions | undefined,
  mcpServer: ReturnType<typeof buildPiMcpServer>,
) {
  if (session.liveQuery()) return;

  const abortController = new AbortController();
  const inputQueue = new SdkInputQueue();
  const sdkQuery = query({
    prompt: inputQueue,
    options: {
      ...baseQueryOptions(model, abortController),
      resume: session.continuityState().sdkSessionId ?? undefined,
      allowedTools: [`${MCP_TOOL_PREFIX}*`],
      permissionMode: "bypassPermissions",
      maxTurns: 999,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: context.systemPrompt,
      },
      ...(mcpServer ? { mcpServers: { [MCP_SERVER_NAME]: mcpServer } } : { mcpServers: {} }),
    },
  });

  void consumeLiveQuery(session, sdkQuery);
  session.startLiveQuery(sdkQuery, inputQueue, abortController);
}

async function consumeLiveQuery(session: ClaudeSession, sdkQuery: ReturnType<typeof query>) {
  const firstMessage = time("firstSdkMessage");
  let firstObserved = false;
  try {
    for await (const message of sdkQuery) {
      if (!firstObserved) {
        firstObserved = true;
        firstMessage({ type: message.type });
      }
      const handleStart = performance.now();
      debug("consumeLiveQuery:message", { type: message.type, ...(message.type === "assistant" ? { stopReason: message.message.stop_reason } : {}) });
      const sdkSessionId = extractSessionId(message);
      const modelId = session.currentModelId();
      if (sdkSessionId && modelId) {
        session.captureSdkSessionId(sdkSessionId, modelId);
      }

      const activeTurn = session.currentTurn();
      const currentState = activeTurn?.streamState();
      if (!activeTurn || !currentState) {
        tally("sdkMessageHandling", performance.now() - handleStart);
        continue;
      }

      const update = parseClaudeMessage(message);
      if (update && applyTurnUpdate(update, currentState, activeTurn.toolBridge)) {
        activeTurn.detachStreamState(currentState);
      }
      tally("sdkMessageHandling", performance.now() - handleStart);
    }
  } catch (error) {
    debug("consumeLiveQuery:error", { message: errorMessage(error) });
    if (session.liveQuery() === sdkQuery) {
      session.abortActiveTurn(errorMessage(error));
    }
  } finally {
    const activeTurn = session.currentTurn();
    const currentState = activeTurn?.streamState();
    if (currentState && !currentState.finished) {
      debug("consumeLiveQuery:finishDangling", { hasText: currentState.output.content.some(b => b.type === 'text' && b.text.trim().length > 0), hasToolCall: currentState.hasToolCall() });
      currentState.finish("stop");
      activeTurn?.detachStreamState(currentState);
      if (activeTurn) session.finishActiveTurn(activeTurn);
    }
    flushTally("sdkMessageHandling", { live: session.liveQuery() === sdkQuery });
    debug("consumeLiveQuery:end", { isLive: session.liveQuery() === sdkQuery });
    if (session.liveQuery() === sdkQuery) {
      session.closeLiveQuery("Claude SDK query ended");
    }
  }
}
