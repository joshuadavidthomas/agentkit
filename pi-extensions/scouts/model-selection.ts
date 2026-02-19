// Inlined from pi-subagent-model-selection v0.1.4
// https://github.com/default-anton/pi-subagent-model-selection
//
// Deterministic model selection for scout subagents.
// Picks the cheapest/fastest model available based on auth mode.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AuthMode = "oauth" | "api-key";
export type AuthSource = "runtime" | "api_key" | "oauth" | "env" | "fallback" | "none";

export interface SelectedSmallModel {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  authMode: AuthMode;
  authSource: AuthSource;
  reason: string;
}

interface AuthResolution {
  authMode: AuthMode;
  authSource: AuthSource;
  basis: string;
}

const OAUTH_PRIMARY_MODEL = {
  provider: "openai-codex",
  id: "gpt-5.3-codex-spark",
  thinkingLevel: "high" as ThinkingLevel,
};

const ANTIGRAVITY_GEMINI_FLASH = {
  provider: "google-antigravity",
  id: "gemini-3-flash",
  thinkingLevel: "low" as ThinkingLevel,
};

const VERTEX_PROVIDER = "google-vertex";
const GEMINI_PROVIDER = "google";

const GEMINI_3_FLASH_MODEL_IDS = ["gemini-3-flash", "gemini-3-flash-preview"];
const HAIKU_4_5_MODEL_IDS = ["claude-haiku-4-5"];

function exactProviderModel(
  available: Model<Api>[],
  provider: string,
  modelId: string,
): Model<Api> | null {
  return available.find((c) => c.provider === provider && c.id === modelId) ?? null;
}

function findBestGeminiFlash(
  available: Model<Api>[],
  provider?: string,
): Model<Api> | null {
  const candidates = provider ? available.filter((m) => m.provider === provider) : available;

  for (const preferredId of GEMINI_3_FLASH_MODEL_IDS) {
    const exact = candidates.find((c) => c.id === preferredId);
    if (exact) return exact;
  }

  const startsWith = candidates.find((c) => c.id.startsWith("gemini-3-flash"));
  if (startsWith) return startsWith;

  const contains = candidates.find((c) => c.id.includes("gemini-3-flash"));
  return contains ?? null;
}

function findBestHaiku45(
  available: Model<Api>[],
  provider: string,
): Model<Api> | null {
  const candidates = available.filter((m) => m.provider === provider);

  for (const preferredId of HAIKU_4_5_MODEL_IDS) {
    const exact = candidates.find((c) => c.id === preferredId);
    if (exact) return exact;
  }

  const startsWith = candidates.find((c) => c.id.startsWith("claude-haiku-4-5"));
  if (startsWith) return startsWith;

  const contains = candidates.find((c) => c.id.includes("haiku-4-5"));
  return contains ?? null;
}

function detectAuthResolution(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
): AuthResolution {
  if (!currentModel) {
    return {
      authMode: "api-key",
      authSource: "none",
      basis: "no current model; default to api-key policy",
    };
  }

  // ModelRegistry may or may not have getAuthSource depending on pi version.
  const registry = modelRegistry as any;
  if (typeof registry.getAuthSource === "function") {
    const authSource: AuthSource = registry.getAuthSource(currentModel.provider);
    const authMode: AuthMode = authSource === "oauth" ? "oauth" : "api-key";
    return { authMode, authSource, basis: `provider auth source=${authSource}` };
  }

  const usesOAuth = modelRegistry.isUsingOAuth?.(currentModel) ?? false;
  return {
    authMode: usesOAuth ? "oauth" : "api-key",
    authSource: usesOAuth ? "oauth" : "none",
    basis: usesOAuth ? "derived from isUsingOAuth" : "derived from isUsingOAuth=false",
  };
}

function selection(
  model: Model<Api>,
  thinkingLevel: ThinkingLevel,
  authResolution: AuthResolution,
  reason: string,
): SelectedSmallModel {
  return {
    model,
    thinkingLevel,
    authMode: authResolution.authMode,
    authSource: authResolution.authSource,
    reason: `${reason}; ${authResolution.basis}`,
  };
}

function fallbackSelection(
  available: Model<Api>[],
  currentModel: Model<Api> | undefined,
  authResolution: AuthResolution,
): SelectedSmallModel | null {
  const currentProvider = currentModel?.provider;

  if (currentProvider) {
    const geminiFlash = findBestGeminiFlash(available, currentProvider);
    if (geminiFlash) {
      return selection(geminiFlash, "low", authResolution, "fallback: current provider gemini-3-flash");
    }

    const haiku45 = findBestHaiku45(available, currentProvider);
    if (haiku45) {
      return selection(haiku45, "low", authResolution, "fallback: current provider claude-haiku-4-5");
    }
  }

  if (currentModel) {
    const sameModel = exactProviderModel(available, currentModel.provider, currentModel.id);
    if (sameModel) {
      return selection(sameModel, "low", authResolution, "fallback: current model with low thinking");
    }
  }

  return null;
}

export function getSmallModelFromProvider(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
): SelectedSmallModel | null {
  const available = modelRegistry.getAvailable();
  const authResolution = detectAuthResolution(modelRegistry, currentModel);

  if (authResolution.authMode === "oauth") {
    const oauthPrimary = exactProviderModel(available, OAUTH_PRIMARY_MODEL.provider, OAUTH_PRIMARY_MODEL.id);
    if (oauthPrimary) {
      return selection(
        oauthPrimary,
        OAUTH_PRIMARY_MODEL.thinkingLevel,
        authResolution,
        "oauth: prefer openai-codex/gpt-5.3-codex-spark",
      );
    }

    const antigravity = exactProviderModel(
      available,
      ANTIGRAVITY_GEMINI_FLASH.provider,
      ANTIGRAVITY_GEMINI_FLASH.id,
    );
    if (antigravity) {
      return selection(
        antigravity,
        ANTIGRAVITY_GEMINI_FLASH.thinkingLevel,
        authResolution,
        "oauth: fallback to google-antigravity/gemini-3-flash",
      );
    }

    return fallbackSelection(available, currentModel, authResolution);
  }

  const vertexFlash = findBestGeminiFlash(available, VERTEX_PROVIDER);
  if (vertexFlash) {
    return selection(vertexFlash, "low", authResolution, "api-key: prefer google-vertex gemini-3-flash");
  }

  const geminiFlash = findBestGeminiFlash(available, GEMINI_PROVIDER);
  if (geminiFlash) {
    return selection(geminiFlash, "low", authResolution, "api-key: prefer google gemini-3-flash");
  }

  return fallbackSelection(available, currentModel, authResolution);
}
