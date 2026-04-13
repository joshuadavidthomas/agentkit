// Model configuration for scout subagents.
//
// Two concerns live here:
// 1. Candidate lists (FAST_MODELS, HEAVY_MODELS) — which models each scout tier prefers.
//    Adjust these to change model preferences for all scouts at once.
// 2. Resolution engine — how a model ID string becomes an actual available model,
//    with family detection, provider pinning, and fallback chains.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ModelFamily =
  | "openai"
  | "anthropic"
  | "google"
  | "kimi"
  | "zai"
  | "minimax"
  | "mistral"
  | "xai"
  | "generic";

export interface SelectedModel {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  reason: string;
}

export interface ModelFamilyRule {
  family: ModelFamily;
  providers?: string[];
  modelIdPatterns?: RegExp[];
}

export interface PlannedModelSelection {
  explicitModelId?: string;
  providerModelIds?: string[];
  familyModelIds?: string[];
  defaultModelIds?: string[];
}

export const FAST_MODELS: Partial<Record<ModelFamily, string[]>> = {
  openai: ["gpt-5.4-mini", "gpt-5-mini", "gpt-5.4"],
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6"],
  google: ["gemini-2.5-flash", "gemini-2.5-pro"],
  kimi: ["k2p5", "kimi-k2-thinking"],
  zai: ["glm-5-turbo", "glm-5", "glm-4.7-flash"],
  minimax: ["MiniMax-M2.7-highspeed", "MiniMax-M2.7"],
  mistral: ["devstral-small-2507", "devstral-medium-latest"],
  xai: ["grok-4-fast-non-reasoning", "grok-4-fast"],
};

export const HEAVY_MODELS: Partial<Record<ModelFamily, string[]>> = {
  openai: ["gpt-5.4", "gpt-5.4-pro"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6"],
  google: ["gemini-3.1-pro-preview", "gemini-2.5-pro"],
  kimi: ["kimi-k2-thinking", "k2p5"],
  zai: ["glm-5", "glm-5.1", "glm-4.7"],
  minimax: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
  mistral: ["devstral-medium-latest", "mistral-large-latest"],
  xai: ["grok-4", "grok-4-fast"],
};

const MODEL_FAMILY_RULES: ModelFamilyRule[] = [
  {
    family: "openai",
    providers: ["openai", "openai-codex", "azure-openai-responses"],
    modelIdPatterns: [/(^|\/)gpt-/i, /(^|\/)o[134]/i, /codex/i, /gpt-oss/i],
  },
  {
    family: "anthropic",
    providers: ["anthropic"],
    modelIdPatterns: [/(^|\/)claude/i],
  },
  {
    family: "google",
    providers: ["google", "google-gemini-cli", "google-vertex"],
    modelIdPatterns: [/(^|\/)gemini/i, /(^|\/)gemma/i],
  },
  {
    family: "kimi",
    providers: ["kimi-coding"],
    modelIdPatterns: [/(^|\/)kimi/i, /(^|\/)k2p5$/i, /moonshot/i],
  },
  {
    family: "zai",
    providers: ["zai"],
    modelIdPatterns: [/(^|\/)glm-/i, /(^|\/)zai-glm-/i],
  },
  {
    family: "minimax",
    providers: ["minimax", "minimax-cn"],
    modelIdPatterns: [/(^|\/)minimax/i],
  },
  {
    family: "mistral",
    providers: ["mistral"],
    modelIdPatterns: [/(^|\/)mistral/i, /(^|\/)devstral/i, /(^|\/)codestral/i, /(^|\/)ministral/i, /(^|\/)magistral/i],
  },
  {
    family: "xai",
    providers: ["xai"],
    modelIdPatterns: [/(^|\/)grok/i],
  },
];

export function resolveModel(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  modelId: string | undefined,
): SelectedModel | null {
  const candidates = resolveModelCandidates(modelRegistry, currentModel, modelId);
  return candidates[0] ?? null;
}

export function resolveModelFamily(
  currentModel: Model<Api> | undefined,
  rules: ModelFamilyRule[] = MODEL_FAMILY_RULES,
): ModelFamily | undefined {
  if (!currentModel) return undefined;

  const provider = currentModel.provider.toLowerCase();
  const modelId = currentModel.id.toLowerCase();

  for (const rule of rules) {
    if (rule.modelIdPatterns?.some((pattern) => pattern.test(modelId))) return rule.family;
  }

  for (const rule of rules) {
    if (rule.providers?.some((p) => p.toLowerCase() === provider)) return rule.family;
  }

  return undefined;
}

function dedupeSelectedModels(candidates: SelectedModel[]): SelectedModel[] {
  const seen = new Set<string>();
  const deduped: SelectedModel[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.model.provider}/${candidate.model.id}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

export function resolveModelCandidates(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  modelId: string | undefined,
): SelectedModel[] {
  const available = modelRegistry.getAvailable();
  if (!modelId) {
    if (currentModel) {
      return [{ model: currentModel, thinkingLevel: "low", reason: "no model specified, using current" }];
    }
    return [];
  }

  const needle = modelId.toLowerCase();
  const slashIdx = needle.indexOf("/");

  if (slashIdx !== -1) {
    const providerId = needle.slice(0, slashIdx).trim();
    const modelNeedle = needle.slice(slashIdx + 1).trim();

    return available
      .filter((m) => m.provider.toLowerCase() === providerId && m.id.toLowerCase().includes(modelNeedle))
      .map((m) => ({
        model: m,
        thinkingLevel: "low" as ThinkingLevel,
        reason: `${m.provider}/${m.id}`,
      }));
  }

  const matches = available.filter((m) => m.id.toLowerCase().includes(needle));
  const currentProvider = currentModel?.provider?.toLowerCase();

  if (!currentProvider) {
    return matches.map((m) => ({
      model: m,
      thinkingLevel: "low" as ThinkingLevel,
      reason: `${m.provider}/${m.id}`,
    }));
  }

  const preferred = matches.filter((m) => m.provider.toLowerCase() === currentProvider);
  const others = matches.filter((m) => m.provider.toLowerCase() !== currentProvider);

  return [...preferred, ...others].map((m) => ({
    model: m,
    thinkingLevel: "low" as ThinkingLevel,
    reason: `${m.provider}/${m.id}`,
  }));
}

export function resolvePlannedModelCandidates(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  plan: PlannedModelSelection,
): SelectedModel[] {
  if (plan.explicitModelId) {
    return resolveModelCandidates(modelRegistry, currentModel, plan.explicitModelId);
  }

  const plannedIds = [
    ...(plan.providerModelIds ?? []),
    ...(plan.familyModelIds ?? []),
    ...(plan.defaultModelIds ?? []),
  ].map((id) => id.trim()).filter(Boolean);

  if (plannedIds.length === 0) {
    return resolveModelCandidates(modelRegistry, currentModel, undefined);
  }

  const candidates = plannedIds.flatMap((id) => resolveModelCandidates(modelRegistry, currentModel, id));
  if (candidates.length > 0) return dedupeSelectedModels(candidates);

  return resolveModelCandidates(modelRegistry, currentModel, undefined);
}
