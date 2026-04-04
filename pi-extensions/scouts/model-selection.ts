// Model selection for scout subagents.
//
// Each scout specifies a default model by ID. Callers can override per-invocation.
// Resolution is a simple substring match against available (authed) models.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface SelectedModel {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  reason: string;
}

// Resolve a model by ID substring (e.g. "claude-opus-4-6", "haiku-4-5").
// Searches all available (authed) models for a match.
// Returns the preferred match first. When "provider/model" syntax is used,
// the named provider is preferred but other providers with the same model
// are included as fallbacks.
export function resolveModel(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  modelId: string | undefined,
): SelectedModel | null {
  const candidates = resolveModelCandidates(modelRegistry, currentModel, modelId);
  return candidates[0] ?? null;
}

// Resolve all candidate models in priority order: preferred provider first,
// then other providers with the same model as fallbacks.
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
    // "provider/model" — preferred provider first, then fallbacks with same model.
    const providerNeedle = needle.slice(0, slashIdx);
    const modelNeedle = needle.slice(slashIdx + 1);

    const preferred: Model<Api>[] = [];
    const fallbacks: Model<Api>[] = [];

    for (const m of available) {
      if (!m.id.toLowerCase().includes(modelNeedle)) continue;
      if (m.provider.toLowerCase().includes(providerNeedle)) {
        preferred.push(m);
      } else {
        fallbacks.push(m);
      }
    }

    return [...preferred, ...fallbacks].map((m) => ({
      model: m,
      thinkingLevel: "low" as ThinkingLevel,
      reason: `${m.provider}/${m.id}`,
    }));
  }

  // Plain model ID — return all matches.
  return available
    .filter((m) => m.id.toLowerCase().includes(needle))
    .map((m) => ({
      model: m,
      thinkingLevel: "low" as ThinkingLevel,
      reason: `${m.provider}/${m.id}`,
    }));
}
