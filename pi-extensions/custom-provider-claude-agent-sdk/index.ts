import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { API_ID, DEFAULT_PROVIDER_MODELS, PROVIDER_ID } from "./constants.js";
import { loadSessionEntry } from "./persistence.js";
import { ClaudeSession } from "./session.js";
import { streamClaudeAgentSdk, streamClaudeAgentSdkOneShot } from "./stream.js";

const sessions = new Map<string, ClaudeSession>();
const DUPLICATE_LOAD_GUARD = Symbol.for("agentkit.claude-agent-sdk-v3.registration-in-progress");

type DuplicateLoadGlobal = typeof globalThis & { [DUPLICATE_LOAD_GUARD]?: boolean };

function claimProviderRegistration(): boolean {
  const state = globalThis as DuplicateLoadGlobal;
  if (state[DUPLICATE_LOAD_GUARD]) return false;

  state[DUPLICATE_LOAD_GUARD] = true;
  return true;
}

function releaseProviderRegistration() {
  delete (globalThis as DuplicateLoadGlobal)[DUPLICATE_LOAD_GUARD];
}

function getOrCreateSession(piSessionId: string): ClaudeSession {
  let session = sessions.get(piSessionId);
  if (!session) {
    session = new ClaudeSession(piSessionId);
    sessions.set(piSessionId, session);
  }
  return session;
}

function getCurrentSession(ctx: { sessionManager: { getSessionId(): string } }): ClaudeSession | undefined {
  return sessions.get(ctx.sessionManager.getSessionId());
}

export default function claudeAgentSdkV3Provider(pi: ExtensionAPI) {
  if (!claimProviderRegistration()) return;

  pi.on("session_start", (event, ctx) => {
    releaseProviderRegistration();
    const piSessionId = ctx.sessionManager.getSessionId();
    const session = new ClaudeSession(piSessionId, loadSessionEntry(ctx.sessionManager), ctx.sessionManager);
    sessions.set(piSessionId, session);

    if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
      session.reset(pi);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    releaseProviderRegistration();

    const piSessionId = ctx.sessionManager.getSessionId();
    const session = sessions.get(piSessionId);
    session?.close();
    sessions.delete(piSessionId);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const session = getCurrentSession(ctx);
    session?.setSessionManager(ctx.sessionManager);
    session?.reset(pi);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const session = getCurrentSession(ctx);
    session?.setSessionManager(ctx.sessionManager);
    session?.reset(pi);
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    const leafId = ctx.sessionManager.getLeafId();
    if (!leafId) return;

    const session = getCurrentSession(ctx);
    session?.setSessionManager(ctx.sessionManager);
    session?.markSyncedThrough(pi, leafId);
  });

  pi.on("model_select", (event, ctx) => {
    if (event.previousModel?.provider !== PROVIDER_ID || event.model.provider === PROVIDER_ID) return;

    getCurrentSession(ctx)?.abortActiveTurn("Claude Agent SDK v3 request cancelled after switching models");
  });

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: "https://api.anthropic.com",
    apiKey: "ANTHROPIC_API_KEY",
    api: API_ID,
    models: DEFAULT_PROVIDER_MODELS,
    streamSimple: (model, context, options) => {
      if (!options?.sessionId) {
        return streamClaudeAgentSdkOneShot(model, context, options);
      }

      return streamClaudeAgentSdk(pi, getOrCreateSession(options.sessionId), model, context, options);
    },
  });
}
