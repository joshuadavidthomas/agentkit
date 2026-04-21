import type { ModelInfo as SDKModelInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import {
  getModels,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { DEFAULT_PROVIDER_MODELS, PROVIDER_ID } from "./constants.js";
import type { ClaudeQueryHandle } from "./types.js";

type ClaudeStreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

export function getSdkModelId(modelId: string): string {
  return modelId;
}

export function normalizeClaudeModelId(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^(?:global|us|eu)\.anthropic\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-latest$/, "")
    .replace(/-\d{8}(?:-v\d(?::\d+)?)?$/, "")
    .replace(/-v\d(?::\d+)?$/, "");
}

export function getAnthropicModelMetadata(): Model<Api>[] {
  return getModels("anthropic") as Model<Api>[];
}

export function buildClaudeAgentSdkProviderModels(
  supportedModels: SDKModelInfo[],
): ProviderModelConfig[] {
  const anthropicModels = getAnthropicModelMetadata();
  const byExactId = new Map(anthropicModels.map((model) => [model.id, model]));
  const byNormalizedId = new Map<string, Model<Api>>();

  for (const model of anthropicModels) {
    const normalized = normalizeClaudeModelId(model.id);
    if (!byNormalizedId.has(normalized)) {
      byNormalizedId.set(normalized, model);
    }
  }

  const resolved: ProviderModelConfig[] = [];
  const seen = new Set<string>();

  for (const sdkModel of supportedModels) {
    const matched = byExactId.get(sdkModel.value) ?? byNormalizedId.get(normalizeClaudeModelId(sdkModel.value));
    if (!matched || seen.has(sdkModel.value)) continue;

    resolved.push({
      id: sdkModel.value,
      name: sdkModel.displayName || matched.name,
      api: matched.api,
      reasoning: matched.reasoning || Boolean(sdkModel.supportsEffort || sdkModel.supportsAdaptiveThinking),
      input: matched.input,
      cost: matched.cost,
      contextWindow: matched.contextWindow,
      maxTokens: matched.maxTokens,
      headers: matched.headers,
      compat: matched.compat,
    });
    seen.add(sdkModel.value);
  }

  return resolved;
}

export function registerClaudeProvider(
  pi: ExtensionAPI,
  streamSimple: ClaudeStreamSimple,
  models: ProviderModelConfig[] = DEFAULT_PROVIDER_MODELS,
) {
  pi.registerProvider(PROVIDER_ID, {
    apiKey: "ANTHROPIC_API_KEY",
    api: "claude-agent-sdk",
    baseUrl: "https://api.anthropic.com",
    models,
    streamSimple,
  });
}

export async function refreshClaudeProviderModels(
  pi: ExtensionAPI,
  query: ClaudeQueryHandle,
  streamSimple: ClaudeStreamSimple,
  logDebug: (message: string, details?: unknown) => void,
  reason: string,
) {
  if (!query.supportedModels) {
    logDebug("refresh-provider-models-unavailable", { reason });
    return;
  }

  const supportedModels = await query.supportedModels();
  const providerModels = buildClaudeAgentSdkProviderModels(supportedModels);
  if (providerModels.length === 0) {
    logDebug("refresh-provider-models-empty", {
      reason,
      supportedModels: supportedModels.map((model) => model.value),
    });
    return;
  }

  registerClaudeProvider(pi, streamSimple, providerModels);
  logDebug("refresh-provider-models", {
    reason,
    models: providerModels.map((model) => model.id),
  });
}
