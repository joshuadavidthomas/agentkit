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
export function resolveModel(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  modelId: string | undefined,
): SelectedModel | null {
  const available = modelRegistry.getAvailable();
  if (!modelId) {
    // No model specified — shouldn't happen if configs are set up right,
    // but fall back to current model as last resort.
    if (currentModel) {
      return { model: currentModel, thinkingLevel: "low", reason: "no model specified, using current" };
    }
    return null;
  }

  const needle = modelId.toLowerCase();
  const match = available.find((m) => m.id.toLowerCase().includes(needle));
  if (!match) return null;

  return {
    model: match,
    thinkingLevel: "low",
    reason: `${match.provider}/${match.id}`,
  };
}
