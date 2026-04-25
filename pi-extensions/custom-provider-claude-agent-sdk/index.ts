import { getModels } from "@mariozechner/pi-ai";
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
// active Claude session manager as the owner of this provider registration.
const ACTIVE_CLAUDE_SESSION_MANAGER_KEY = Symbol.for("agentkit.claude-agent-sdk.active-session-manager");

type ClaudeSessionManagerGlobal = typeof globalThis & { [ACTIVE_CLAUDE_SESSION_MANAGER_KEY]?: ClaudeSessionManager };

type PiSessionManager = HandoffSessionReader & {
  getSessionId(): string;
  getLeafId(): string | null | undefined;
};

function claimClaudeSessionManager(pi: ExtensionAPI): ClaudeSessionManager | undefined {
  const state = globalThis as ClaudeSessionManagerGlobal;
  if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY]) return undefined;

  const manager = new ClaudeSessionManager((data) => appendSessionEntry(pi, data));
  state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] = manager;
  return manager;
}

class ClaudeSessionManager {
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(private readonly persistSessionEntry: (data: SessionEntryData) => void) { }

  hydrateSession(sessionManager: PiSessionManager): ClaudeSession {
    const piSessionId = sessionManager.getSessionId();
    this.sessions.get(piSessionId)?.close();

    const session = new ClaudeSession(piSessionId, loadSessionEntry(sessionManager), sessionManager, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  currentSession(sessionManager: PiSessionManager): ClaudeSession | undefined {
    return this.sessions.get(sessionManager.getSessionId());
  }

  createSession(piSessionId: string): ClaudeSession {
    const session = new ClaudeSession(piSessionId, undefined, undefined, this.persistSessionEntry);
    this.sessions.set(piSessionId, session);
    return session;
  }

  getSession(piSessionId: string): ClaudeSession | undefined {
    return this.sessions.get(piSessionId);
  }

  resetSessionForStructuralChange(sessionManager: PiSessionManager) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.reset();
  }

  markSessionSynced(sessionManager: PiSessionManager, leafId: string) {
    const session = this.currentSession(sessionManager);
    session?.setSessionManager(sessionManager);
    session?.markSyncedThrough(leafId);
  }

  shutdownSession(piSessionId: string) {
    const session = this.sessions.get(piSessionId);
    session?.close();
    this.sessions.delete(piSessionId);

    if (this.sessions.size === 0) {
      const state = globalThis as ClaudeSessionManagerGlobal;
      if (state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY] === this) {
        delete state[ACTIVE_CLAUDE_SESSION_MANAGER_KEY];
      }
    }
  }
}

export default function claudeAgentSdkProvider(pi: ExtensionAPI) {
  const claudeSessions = claimClaudeSessionManager(pi);
  if (!claudeSessions) return;

  pi.on("session_start", (event, ctx) => {
    const session = claudeSessions.hydrateSession(ctx.sessionManager);

    if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
      session.reset();
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    claudeSessions.shutdownSession(ctx.sessionManager.getSessionId());
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    claudeSessions.resetSessionForStructuralChange(ctx.sessionManager);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;
    claudeSessions.resetSessionForStructuralChange(ctx.sessionManager);
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;

    claudeSessions.markSessionSynced(ctx.sessionManager, leafId);
  });

  pi.on("model_select", (event, ctx) => {
    if (event.previousModel?.provider !== PROVIDER_ID || event.model.provider === PROVIDER_ID) return;

    claudeSessions.currentSession(ctx.sessionManager)?.abortActiveTurn("Claude Agent SDK request cancelled after switching models");
  });

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: "https://api.anthropic.com",
    apiKey: "ANTHROPIC_API_KEY",
    api: API_ID,
    models: PROVIDER_MODELS,
    streamSimple: (model, context, options) => {
      if (!options?.sessionId) {
        return streamClaudeAgentSdkOneShot(model, context, options);
      }

      let session = claudeSessions.getSession(options.sessionId);
      if (!session) {
        session = claudeSessions.createSession(options.sessionId);
      }

      return streamClaudeAgentSdk(session, model, context, options);
    },
  });
}
