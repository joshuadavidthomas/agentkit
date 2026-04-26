import { getModels } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import { claimClaudeSessionManager } from "./session.js";
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

export default function claudeAgentSdkProvider(pi: ExtensionAPI) {
  const claudeSessions = claimClaudeSessionManager(pi);
  if (!claudeSessions) return;

  pi.on("session_start", (event, ctx) => {
    const session = claudeSessions.hydrateSession(ctx.sessionManager);

    if ((event.reason === "new" || event.reason === "fork") && ctx.model?.provider === PROVIDER_ID) {
      session.resetContinuity();
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

    claudeSessions.currentSession(ctx.sessionManager)?.closeLiveQuery("Claude Agent SDK request cancelled after switching models");
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
