import { createRequire } from "node:module";
import { query } from "@anthropic-ai/claude-agent-sdk";
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
import { ClaudeTurn, ClaudeSession } from "./session.js";
import { buildPiMcpServer } from "./tools/mcp-server.js";
import { MCP_SERVER_NAME, MCP_TOOL_PREFIX } from "./tools/names.js";
import { createMcpTextResult, extractToolResults } from "./tools/results.js";
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
    turn.streamState()?.fail("Claude Agent SDK one-shot request aborted", true);
    turn.close();
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
    turn.beginActiveQuery(sdkQuery);

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
    if (sdkQuery) {
      turn.finishActiveQuery(sdkQuery);
    } else {
      turn.close();
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

  const activeTurn = session.currentTurn();
  if (activeTurn?.hasActiveQuery()) {
    activeTurn.attachStreamState(new PiStreamState(model, stream));
    activeTurn.toolBridge.deliverToolResults(extractToolResults(context));
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

async function runSessionQuery(
  session: ClaudeSession,
  model: Model<Api>,
  stream: AssistantMessageEventStream,
  context: Context,
  options?: SimpleStreamOptions,
) {
  const abortController = createAbortController(options?.signal);
  let sdkQuery: ReturnType<typeof query> | undefined;
  let turn: ClaudeTurn | undefined;

  if (abortController.signal.aborted) {
    const state = new PiStreamState(model, stream);
    state.start();
    state.fail("Claude Agent SDK request aborted", true);
    return;
  }

  try {
    const handoff = session.prepareForTurn() ?? buildContextMessagesHandoff(context.messages);
    turn = session.beginTurn(new PiStreamState(model, stream));
    const activeTurn = turn;
    const mcpServer = buildPiMcpServer(context.tools, (toolName) => activeTurn.toolBridge.handleMcpToolCall(toolName));
    const abortPending = () => {
      activeTurn.toolBridge.resolvePendingToolCalls(createMcpTextResult("Operation aborted", true));
      try {
        sdkQuery?.close();
      } catch {
        // Ignore close failures.
      }
    };
    options?.signal?.addEventListener("abort", abortPending, { once: true });

    try {
      let prompt = extractLatestUserPrompt(context);
      if (handoff) {
        const prefix = `${handoff}\n\nCurrent user message:\n`;
        prompt = typeof prompt === "string" ? `${prefix}${prompt}` : [{ type: "text", text: prefix }, ...prompt];
      }

      sdkQuery = query({
        prompt: toSdkPrompt(prompt),
        options: {
          ...baseQueryOptions(model, abortController, options?.apiKey),
          resume: session.continuityState().sdkSessionId ?? undefined,
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
      activeTurn.beginActiveQuery(sdkQuery);

      for await (const message of sdkQuery) {
        const sdkSessionId = extractSessionId(message);
        if (sdkSessionId) {
          session.captureSdkSessionId(sdkSessionId, model.id);
        }

        const currentState = activeTurn.streamState();
        if (!currentState) continue;

        const update = parseClaudeMessage(message);
        if (update && applyTurnUpdate(update, currentState, activeTurn.toolBridge)) {
          activeTurn.detachStreamState(currentState);
        }
      }

      const currentState = activeTurn.streamState();
      if (currentState && !currentState.finished) {
        currentState.finish("stop");
        activeTurn.detachStreamState(currentState);
      }
    } finally {
      options?.signal?.removeEventListener("abort", abortPending);
    }
  } catch (error) {
    const currentState = turn?.streamState();
    currentState?.fail(errorMessage(error), abortController.signal.aborted || Boolean(options?.signal?.aborted));
    if (currentState) {
      turn?.detachStreamState(currentState);
    }
  } finally {
    if (turn && sdkQuery) {
      session.finishActiveTurn(turn, sdkQuery);
    } else if (turn) {
      session.closeActiveTurn();
    }
  }
}
