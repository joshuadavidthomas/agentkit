// Model selection for scout subagents.
//
// Each scout specifies default model candidates. Callers can override per-invocation.
// Resolution uses substring matching on model IDs, with two extra rules:
// - Bare model IDs prefer the current session provider first.
// - "provider/model" pins the provider exactly.
//
// Family selection is driven by explicit rule tables, not hardcoded branching.

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

export const DEFAULT_MODEL_FAMILY_RULES: ModelFamilyRule[] = [
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

// Resolve a model by ID substring (e.g. "claude-opus-4-6", "haiku-4-5").
// Searches all available (authed) models for a match.
// Returns the preferred match first. Bare model IDs prefer the current
// session provider. "provider/model" syntax pins the provider exactly.
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
  rules: ModelFamilyRule[] = DEFAULT_MODEL_FAMILY_RULES,
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

// Resolve all candidate models in priority order.
// Bare model IDs prefer the current session provider first.
// "provider/model" returns only matches from that exact provider.
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
    // "provider/model" — exact provider pin, substring match on model ID.
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

  // Plain model ID — prefer matches from the current session provider first.
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
