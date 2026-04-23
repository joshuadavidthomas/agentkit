import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { API_ID, DEFAULT_PROVIDER_MODELS, PROVIDER_ID } from "./constants.js";
import { loadSessionEntry } from "./persistence.js";
import { ClaudeSession } from "./session.js";
import { streamClaudeAgentSdk } from "./stream.js";

const sessions = new Map<string, ClaudeSession>();

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
  pi.on("session_start", (event, ctx) => {
    const piSessionId = ctx.sessionManager.getSessionId();
    const session = new ClaudeSession(piSessionId, loadSessionEntry(ctx.sessionManager), ctx.sessionManager);
    sessions.set(piSessionId, session);

    if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
      session.reset(pi);
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    const piSessionId = ctx.sessionManager.getSessionId();
    const session = sessions.get(piSessionId);
    session?.close();
    sessions.delete(piSessionId);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.model?.provider !== PROVIDER_ID) return;

    getCurrentSession(ctx)?.reset(pi);
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

  pi.registerProvider(PROVIDER_ID, {
    baseUrl: "https://api.anthropic.com",
    apiKey: "ANTHROPIC_API_KEY",
    api: API_ID,
    models: DEFAULT_PROVIDER_MODELS,
    streamSimple: (model, context, options) => {
      const piSessionId = options?.sessionId ?? "ephemeral";
      return streamClaudeAgentSdk(pi, getOrCreateSession(piSessionId), model, context, options);
    },
  });
}
