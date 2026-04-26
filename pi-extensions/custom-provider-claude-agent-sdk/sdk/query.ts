import { createRequire } from "node:module";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { buildContextMessagesHandoff } from "../handoff.js";
import { PiStreamState, applyTurnUpdate } from "../pi-stream.js";
import { ClaudeSession, ClaudeTurn } from "../session.js";
import { buildPiMcpServer } from "../tools/mcp-server.js";
import { MCP_SERVER_NAME, MCP_TOOL_PREFIX } from "../tools/names.js";
import { extractToolResults } from "../tools/results.js";
import { extractSessionId, parseClaudeMessage } from "./events.js";
import { extractLatestUserPrompt, toSdkPrompt } from "./prompt.js";
import { SdkInputQueue } from "./queue.js";

export type SdkQuery = ReturnType<typeof query>;

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

function shouldCloseLiveQueryAfterTurn(): boolean {
  return process.argv.includes("-p") || process.argv.includes("--print");
}

const DISALLOWED_BUILTIN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash",
  "Agent",
  "NotebookEdit",
  "EnterWorktree",
  "ExitWorktree",
  "CronCreate",
  "CronDelete",
  "CronList",
  "TeamCreate",
  "TeamDelete",
  "WebFetch",
  "WebSearch",
  "TodoRead",
  "TodoWrite",
  "EnterPlanMode",
  "ExitPlanMode",
  "RemoteTrigger",
  "SendMessage",
  "Skill",
  "TaskOutput",
  "TaskStop",
  "ToolSearch",
  "AskUserQuestion",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "Lsp",
];

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
        ...baseQueryOptions(model, abortController, options?.apiKey),
        allowedTools: [],
        systemPrompt: context.systemPrompt,
        tools: [],
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

  const activeTurn = session.currentTurn();
  if (activeTurn) {
    activeTurn.attachStreamState(new PiStreamState(model, stream));
    activeTurn.toolBridge.deliverToolResults(extractToolResults(context));
    void finishToolContinuation(session, activeTurn, options?.signal);
    return stream;
  }

  if (context.messages[context.messages.length - 1]?.role === "toolResult") {
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
    turn.abort("Operation aborted");
    void session.liveQuery()?.interrupt().catch(() => session.closeLiveQuery("Operation aborted"));
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
  if (options?.signal?.aborted) {
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
      if (!currentTurn) throw new Error(`No active pi turn for tool ${toolName}`);
      return currentTurn.toolBridge.handleMcpToolCall(toolName);
    });

    await ensureLiveQuery(session, model, context, options, mcpServer);
    await session.setModel(model.id);
    await session.setMcpServers(mcpServer ? { [MCP_SERVER_NAME]: mcpServer } : {});

    const abortPending = () => {
      activeTurn.abort("Operation aborted");
      void session.liveQuery()?.interrupt().catch(() => session.closeLiveQuery("Operation aborted"));
    };
    options?.signal?.addEventListener("abort", abortPending, { once: true });

    try {
      if (!session.pushUserMessage(toSdkUserMessage(promptForTurn(context, handoff)))) {
        throw new Error("Claude SDK input stream is closed");
      }
      await activeTurn.done();
      closeAfterTurn = activeTurn.streamOutputStopReason() !== "toolUse";
    } finally {
      options?.signal?.removeEventListener("abort", abortPending);
    }
  } catch (error) {
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
      ...baseQueryOptions(model, abortController, options?.apiKey),
      resume: session.continuityState().sdkSessionId ?? undefined,
      allowedTools: [`${MCP_TOOL_PREFIX}*`],
      permissionMode: "bypassPermissions",
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
  try {
    for await (const message of sdkQuery) {
      const sdkSessionId = extractSessionId(message);
      const modelId = session.currentModelId();
      if (sdkSessionId && modelId) {
        session.captureSdkSessionId(sdkSessionId, modelId);
      }

      const activeTurn = session.currentTurn();
      const currentState = activeTurn?.streamState();
      if (!activeTurn || !currentState) continue;

      const update = parseClaudeMessage(message);
      if (update && applyTurnUpdate(update, currentState, activeTurn.toolBridge)) {
        activeTurn.detachStreamState(currentState);
      }
    }
  } catch (error) {
    if (session.liveQuery() === sdkQuery) {
      session.abortActiveTurn(errorMessage(error));
    }
  } finally {
    if (session.liveQuery() === sdkQuery) {
      session.closeLiveQuery("Claude SDK query ended");
    }
  }
}
