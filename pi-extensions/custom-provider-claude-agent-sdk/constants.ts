import { getModels } from "@mariozechner/pi-ai";
import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export const PROVIDER_ID = "claude-agent-sdk";
export const API_ID = "claude-agent-sdk";

export const DEFAULT_PROVIDER_MODELS: ProviderModelConfig[] = getModels("anthropic")
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

const CLAUDE_CODE_MODEL_ID_BY_PI_MODEL_ID: Partial<Record<string, string>> = {};

export function toClaudeCodeModelId(piModelId: string): string {
  return CLAUDE_CODE_MODEL_ID_BY_PI_MODEL_ID[piModelId] ?? piModelId;
}
