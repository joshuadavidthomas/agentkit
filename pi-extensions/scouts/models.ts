// Scout model selection.
//
// This file holds both the low-level model lookup helpers and the scout
// workload mapping that turns provider + workload into one selected model.

import type { Api, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export type ScoutWorkload = "fast" | "balanced" | "deep";
export type ModelProfileId = string;

export interface ModelTarget {
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  provider?: string;
}

export interface WorkloadModelPolicy {
  preferredProfilesByWorkload: Record<ScoutWorkload, ModelProfileId[]>;
  realizationsByProvider: Record<string, Partial<Record<ModelProfileId, ModelTarget>>>;
  fallbackByWorkload: Record<ScoutWorkload, ModelTarget>;
}

export interface ResolveWorkloadModelPlan {
  explicitModelId?: string;
  provider: string;
  workload: ScoutWorkload;
  policy?: WorkloadModelPolicy;
}

export interface ResolvedWorkloadModel {
  model: Model<Api>;
  thinkingLevel?: ThinkingLevel;
}

function findMatchingModels(models: Model<Api>[], needle: string): Model<Api>[] {
  const exactMatches = models.filter((model) => model.id.toLowerCase() === needle);
  if (exactMatches.length > 0) return exactMatches;

  return models.filter((model) => model.id.toLowerCase().includes(needle));
}

function parseModelTarget(modelId: string | undefined): ModelTarget | null {
  const trimmedModelId = modelId?.trim();
  if (!trimmedModelId) return null;

  const needle = trimmedModelId.toLowerCase();
  const slashIdx = needle.indexOf("/");
  if (slashIdx === -1) {
    return { modelId: needle };
  }

  const provider = needle.slice(0, slashIdx).trim();
  const scopedModelId = needle.slice(slashIdx + 1).trim();
  if (!provider || !scopedModelId) return null;

  return {
    provider,
    modelId: scopedModelId,
  };
}

export const DEFAULT_WORKLOAD_MODEL_POLICY: WorkloadModelPolicy = {
  preferredProfilesByWorkload: {
    fast: [
      "claude-haiku-4.5",
      "gpt-5.4-mini",
      "gemini-2.5-flash",
    ],
    balanced: [
      "claude-sonnet-4.6",
      "gpt-5.4-medium",
      "gemini-2.5-pro",
    ],
    deep: [
      "gpt-5.4-xhigh",
      "claude-opus-4.6",
      "gemini-3.1-pro",
    ],
  },
  realizationsByProvider: {
    openai: {
      "gpt-5.4-mini": { modelId: "gpt-5.4-mini", thinkingLevel: "low" },
      "gpt-5.4-medium": { modelId: "gpt-5.4", thinkingLevel: "medium" },
      "gpt-5.4-xhigh": { modelId: "gpt-5.4", thinkingLevel: "xhigh" },
    },
    "openai-codex": {
      "gpt-5.4-mini": { modelId: "gpt-5.4-mini", thinkingLevel: "low" },
      "gpt-5.4-medium": { modelId: "gpt-5.4", thinkingLevel: "medium" },
      "gpt-5.4-xhigh": { modelId: "gpt-5.4", thinkingLevel: "xhigh" },
    },
    anthropic: {
      "claude-haiku-4.5": { modelId: "claude-haiku-4-5", thinkingLevel: "low" },
      "claude-sonnet-4.6": { modelId: "claude-sonnet-4-6", thinkingLevel: "medium" },
      "claude-opus-4.6": { modelId: "claude-opus-4-6", thinkingLevel: "high" },
    },
    google: {
      "gemini-2.5-flash": { modelId: "gemini-2.5-flash", thinkingLevel: "low" },
      "gemini-2.5-pro": { modelId: "gemini-2.5-pro", thinkingLevel: "medium" },
      "gemini-3.1-pro": { modelId: "gemini-3.1-pro-preview", thinkingLevel: "high" },
    },
    "github-copilot": {
      "claude-haiku-4.5": { modelId: "claude-haiku-4.5", thinkingLevel: "low" },
      "claude-sonnet-4.6": { modelId: "claude-sonnet-4.6", thinkingLevel: "medium" },
      "claude-opus-4.6": { modelId: "claude-opus-4.6", thinkingLevel: "high" },
      "gpt-5.4-mini": { modelId: "gpt-5.4-mini", thinkingLevel: "low" },
      "gpt-5.4-medium": { modelId: "gpt-5.4", thinkingLevel: "medium" },
      "gpt-5.4-xhigh": { modelId: "gpt-5.4", thinkingLevel: "xhigh" },
      "gemini-2.5-flash": { modelId: "gemini-3-flash-preview", thinkingLevel: "low" },
      "gemini-2.5-pro": { modelId: "gemini-2.5-pro", thinkingLevel: "medium" },
      "gemini-3.1-pro": { modelId: "gemini-3.1-pro-preview", thinkingLevel: "high" },
    },
  },
  fallbackByWorkload: {
    fast: { provider: "anthropic", modelId: "claude-haiku-4-5", thinkingLevel: "low" },
    balanced: { provider: "anthropic", modelId: "claude-sonnet-4-6", thinkingLevel: "medium" },
    deep: { provider: "anthropic", modelId: "claude-opus-4-6", thinkingLevel: "high" },
  },
};

function resolveTarget(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  target: ModelTarget,
): ResolvedWorkloadModel | null {
  const available = modelRegistry.getAvailable();
  const currentProvider = currentModel?.provider?.toLowerCase();

  // Provider-qualified targets are scoped to that provider exactly.
  const scopedModels = target.provider
    ? available.filter((candidate) => candidate.provider.toLowerCase() === target.provider)
    : available;

  const matches = findMatchingModels(scopedModels, target.modelId);

  // Unqualified targets search globally, then prefer the current provider as a tie-break.
  let orderedMatches = matches;
  if (!target.provider && currentProvider) {
    const preferred: Model<Api>[] = [];
    const others: Model<Api>[] = [];

    for (const candidate of matches) {
      if (candidate.provider.toLowerCase() === currentProvider) {
        preferred.push(candidate);
      } else {
        others.push(candidate);
      }
    }

    orderedMatches = [...preferred, ...others];
  }

  const model = orderedMatches[0];
  if (!model) return null;

  return {
    model,
    thinkingLevel: target.thinkingLevel,
  };
}

export function resolveWorkloadModel(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  plan: ResolveWorkloadModelPlan,
): ResolvedWorkloadModel | null {
  const policy = plan.policy ?? DEFAULT_WORKLOAD_MODEL_POLICY;
  const explicitModelId = plan.explicitModelId?.trim();
  const provider = plan.provider.trim().toLowerCase();

  if (explicitModelId) {
    const explicitTarget = parseModelTarget(explicitModelId);
    if (!explicitTarget) return null;

    return resolveTarget(modelRegistry, currentModel, explicitTarget);
  }

  const profiles = policy.preferredProfilesByWorkload[plan.workload] ?? [];
  for (const profile of profiles) {
    const realization = policy.realizationsByProvider[provider]?.[profile];
    if (!realization) continue;

    const selectedModel = resolveTarget(modelRegistry, currentModel, { ...realization, provider });
    if (!selectedModel) continue;

    return selectedModel;
  }

  const fallback = policy.fallbackByWorkload[plan.workload];
  const fallbackMatch = resolveTarget(modelRegistry, currentModel, fallback);

  if (!fallbackMatch) return null;

  return fallbackMatch;
}
