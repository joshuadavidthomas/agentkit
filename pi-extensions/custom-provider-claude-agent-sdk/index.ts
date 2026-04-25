import { getModels } from "@mariozechner/pi-ai";
import type { Api, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { HandoffSessionReader } from "./handoff.js";
import { loadSessionEntry } from "./persistence.js";
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

function claimActiveRuntime(runtime: ClaudeAgentSdkRuntime): boolean {
  const state = globalThis as RuntimeGlobal;
  if (state[ACTIVE_RUNTIME_KEY]) return false;

  state[ACTIVE_RUNTIME_KEY] = runtime;
  return true;
}

function releaseActiveRuntime(runtime: ClaudeAgentSdkRuntime) {
  const state = globalThis as RuntimeGlobal;
  if (state[ACTIVE_RUNTIME_KEY] === runtime) {
    delete state[ACTIVE_RUNTIME_KEY];
  }
}

class ClaudeAgentSdkRuntime {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly pi: ExtensionAPI) {}

  install() {
    this.registerSessionLifecycle();
    this.registerProvider();
  }

  private registerSessionLifecycle() {
    this.pi.on("session_start", (event, ctx) => {
      const session = this.hydrateSession(ctx.sessionManager);

      if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
        session.reset(this.pi);
      }
    });

    this.pi.on("session_shutdown", (_event, ctx) => {
      this.closeSession(ctx.sessionManager.getSessionId());
      if (this.sessions.size === 0) {
        releaseActiveRuntime(this);
      }
    });

    this.pi.on("session_compact", (_event, ctx) => {
      if (ctx.model?.provider !== PROVIDER_ID) return;
      this.resetCurrentSession(ctx.sessionManager);
    });

    this.pi.on("session_tree", (_event, ctx) => {
      if (ctx.model?.provider !== PROVIDER_ID) return;
      this.resetCurrentSession(ctx.sessionManager);
    });

    this.pi.on("turn_end", (_event, ctx) => {
      if (ctx.model?.provider !== PROVIDER_ID) return;

      const leafId = ctx.sessionManager.getLeafId();
      if (!leafId) return;

      const session = this.currentSession(ctx.sessionManager);
      session?.setSessionManager(ctx.sessionManager);
      session?.markSyncedThrough(this.pi, leafId);
    });

    this.pi.on("model_select", (event, ctx) => {
      if (event.previousModel?.provider !== PROVIDER_ID || event.model.provider === PROVIDER_ID) return;

      this.currentSession(ctx.sessionManager)?.abortActiveTurn("Claude Agent SDK request cancelled after switching models");
    });
  }

  private registerProvider() {
    this.pi.registerProvider(PROVIDER_ID, {
      baseUrl: "https://api.anthropic.com",
      apiKey: "ANTHROPIC_API_KEY",
      api: API_ID,
      models: PROVIDER_MODELS,
      streamSimple: (model, context, options) => this.streamSimple(model, context, options),
    });
  }

  private streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
    if (!options?.sessionId) {
      return streamClaudeAgentSdkOneShot(model, context, options);
    }

    return streamClaudeAgentSdk(this.pi, this.sessionForTurn(options.sessionId), model, context, options);
  }

  private hydrateSession(sessionManager: RuntimeSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    const session = new ClaudeSession(piSessionId, loadSessionEntry(sessionManager), sessionManager);
    this.sessions.set(piSessionId, session);
    return session;
  }

  private sessionForTurn(piSessionId: string): ClaudeSession {
    let session = this.sessions.get(piSessionId);
    if (!session) {
      session = new ClaudeSession(piSessionId);
      this.sessions.set(piSessionId, session);
    }
    return session;
  }

  private currentSession(sessionManager: { getSessionId(): string }): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  private resetCurrentSession(sessionManager: RuntimeSessionManager) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.reset(this.pi);
  }

  private closeSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
    session?.close();
    this.sessions.delete(piSessionId);
  }
}

export default function claudeAgentSdkProvider(pi: ExtensionAPI) {
  const runtime = new ClaudeAgentSdkRuntime(pi);
  if (!claimActiveRuntime(runtime)) return;

  runtime.install();
}
