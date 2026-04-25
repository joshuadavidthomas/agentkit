import { getModels } from "@mariozechner/pi-ai";
import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { HandoffSessionReader } from "./handoff.js";
import { appendSessionEntry, loadSessionEntry, type SessionEntryData } from "./persistence.js";
import { ClaudeSession } from "./session.js";
import { streamClaudeAgentSdk, streamClaudeAgentSdkOneShot } from "./stream.js";

export const PROVIDER_ID = "claude-agent-sdk";
export const API_ID = "claude-agent-sdk";

const PROVIDER_MODELS: ProviderModelConfig[] = getModels("anthropic")
  .filter((model) => model.id.startsWith("claude-"))
  .map((model) => ({
    id: model.id,
    name: model.name,
    api: API_ID,
    reasoning: model.reasoning,
    input: [...model.input],
    cost: { ...model.cost },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));

// Pi can evaluate this extension more than once in the same process: explicit
// `-e` plus installed extension, reloads, parent sessions plus scouts/subagents.
// The model registry is shared, so a later instance must not overwrite the
// registered `streamSimple` function for an active parent turn; tool-result
// callbacks would then route to an instance with an empty session map. Keep one
// active runtime as the owner of this provider registration.
const ACTIVE_RUNTIME_KEY = Symbol.for("agentkit.claude-agent-sdk.active-runtime");

type RuntimeGlobal = typeof globalThis & { [ACTIVE_RUNTIME_KEY]?: ClaudeAgentSdkRuntime };

type RuntimeSessionManager = HandoffSessionReader & {
  getSessionId(): string;
  getLeafId(): string | null | undefined;
};

function claimProviderRuntime(): ClaudeAgentSdkRuntime | undefined {
  const state = globalThis as RuntimeGlobal;
  if (state[ACTIVE_RUNTIME_KEY]) return undefined;

  const runtime = new ClaudeAgentSdkRuntime();
  state[ACTIVE_RUNTIME_KEY] = runtime;
  return runtime;
}

class ClaudeAgentSdkRuntime {
  private readonly sessions = new Map<string, ClaudeSession>();

  streamSimple(pi: ExtensionAPI, model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
    if (!options?.sessionId) {
      return streamClaudeAgentSdkOneShot(model, context, options);
    }

    return streamClaudeAgentSdk(this.sessionForTurn(pi, options.sessionId), model, context, options);
  }

  hydrateSession(pi: ExtensionAPI, sessionManager: RuntimeSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    const session = new ClaudeSession(piSessionId, loadSessionEntry(sessionManager), sessionManager, this.persistWith(pi));
    this.sessions.set(piSessionId, session);
    return session;
  }

  private sessionForTurn(pi: ExtensionAPI, piSessionId: string): ClaudeSession {
    let session = this.sessions.get(piSessionId);
    if (!session) {
      session = new ClaudeSession(piSessionId, undefined, undefined, this.persistWith(pi));
      this.sessions.set(piSessionId, session);
    }
    return session;
  }

  currentSession(sessionManager: { getSessionId(): string }): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  resetCurrentSession(sessionManager: RuntimeSessionManager) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.reset();
  }

  private persistWith(pi: ExtensionAPI) {
    return (data: SessionEntryData) => appendSessionEntry(pi, data);
  }

  shutdownSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
    session?.close();
    this.sessions.delete(piSessionId);

    if (this.sessions.size === 0) {
      this.release();
    }
  }

  private release() {
    const state = globalThis as RuntimeGlobal;
    if (state[ACTIVE_RUNTIME_KEY] === this) {
      delete state[ACTIVE_RUNTIME_KEY];
    }
  }
}

export default function claudeAgentSdkProvider(pi: ExtensionAPI) {
  const runtime = claimProviderRuntime();
  if (!runtime) return;

  pi.on("session_start", (event, ctx) => {
    const session = runtime.hydrateSession(pi, ctx.sessionManager);

    if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
      session.reset();
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    runtime.shutdownSession(ctx.sessionManager.getSessionId());
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    runtime.resetCurrentSession(ctx.sessionManager);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    runtime.resetCurrentSession(ctx.sessionManager);
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;

    const session = runtime.currentSession(ctx.sessionManager);
    session?.setSessionManager(ctx.sessionManager);
    session?.markSyncedThrough(leafId);
  });

  pi.on("model_select", (event, ctx) => {
    if (event.previousModel?.provider !== PROVIDER_ID || event.model.provider === PROVIDER_ID) return;

    runtime.currentSession(ctx.sessionManager)?.abortActiveTurn("Claude Agent SDK request cancelled after switching models");
  });

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: "https://api.anthropic.com",
    apiKey: "ANTHROPIC_API_KEY",
    api: API_ID,
    models: PROVIDER_MODELS,
    streamSimple: (model, context, options) => runtime.streamSimple(pi, model, context, options),
  });
}
