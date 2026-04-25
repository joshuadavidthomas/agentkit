import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export const PROVIDER_ID = "claude-agent-sdk-v2";

export const DEFAULT_PROVIDER_MODELS: ProviderModelConfig[] = [
  {
    id: "claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    contextWindow: 1000000,
    maxTokens: 128000,
  },
];
