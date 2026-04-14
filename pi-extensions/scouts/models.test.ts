import { describe, expect, it } from "bun:test";

import type { Api, Model } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { resolveWorkloadModel, type ScoutWorkload } from "./models.ts";

const authStorage = AuthStorage.inMemory({
  openai: { type: "api_key", key: "test-openai" },
  "openai-codex": { type: "api_key", key: "test-openai-codex" },
  anthropic: { type: "api_key", key: "test-anthropic" },
  google: { type: "api_key", key: "test-google" },
  "github-copilot": { type: "api_key", key: "test-github-copilot" },
});

const registry = ModelRegistry.inMemory(authStorage);

function getCurrentModel(provider: string, modelId: string): Model<Api> {
  const model = registry.find(provider, modelId);
  expect(model).toBeDefined();
  return model!;
}

function resolveForMainSession(currentModel: Model<Api>, workload: ScoutWorkload) {
  return resolveWorkloadModel(registry, currentModel, {
    provider: currentModel.provider,
    workload,
  });
}

describe("scout model selection from a main session", () => {
  it("github-copilot main session resolves a single route-local model for each scout workload", () => {
    const currentModel = getCurrentModel("github-copilot", "claude-sonnet-4.6");

    const fast = resolveForMainSession(currentModel, "fast");
    const balanced = resolveForMainSession(currentModel, "balanced");
    const deep = resolveForMainSession(currentModel, "deep");

    expect(fast).not.toBeNull();
    expect(fast?.model.provider).toBe("github-copilot");
    expect(fast?.model.id).toBe("claude-haiku-4.5");

    expect(balanced).not.toBeNull();
    expect(balanced?.model.provider).toBe("github-copilot");
    expect(balanced?.model.id).toBe("claude-sonnet-4.6");

    expect(deep).not.toBeNull();
    expect(deep?.model.provider).toBe("github-copilot");
    expect(deep?.model.id).toBe("gpt-5.4");
    expect(deep?.thinkingLevel).toBe("xhigh");
  });

  it("anthropic main session stays on anthropic and resolves the provider's fast/balanced/deep choices", () => {
    const currentModel = getCurrentModel("anthropic", "claude-sonnet-4-6");

    const fast = resolveForMainSession(currentModel, "fast");
    const balanced = resolveForMainSession(currentModel, "balanced");
    const deep = resolveForMainSession(currentModel, "deep");

    expect(fast?.model.provider).toBe("anthropic");
    expect(fast?.model.id).toBe("claude-haiku-4-5");

    expect(balanced?.model.provider).toBe("anthropic");
    expect(balanced?.model.id).toBe("claude-sonnet-4-6");

    expect(deep?.model.provider).toBe("anthropic");
    expect(deep?.model.id).toBe("claude-opus-4-6");
  });

  it("openai-codex main session uses codex-local realizations instead of jumping providers", () => {
    const currentModel = getCurrentModel("openai-codex", "gpt-5.4");

    const fast = resolveForMainSession(currentModel, "fast");
    const balanced = resolveForMainSession(currentModel, "balanced");
    const deep = resolveForMainSession(currentModel, "deep");

    expect(fast?.model.provider).toBe("openai-codex");
    expect(fast?.model.id).toBe("gpt-5.4-mini");

    expect(balanced?.model.provider).toBe("openai-codex");
    expect(balanced?.model.id).toBe("gpt-5.4");
    expect(balanced?.thinkingLevel).toBe("medium");

    expect(deep?.model.provider).toBe("openai-codex");
    expect(deep?.model.id).toBe("gpt-5.4");
    expect(deep?.thinkingLevel).toBe("xhigh");
  });

  it("google main session resolves the first profile its own route can actually satisfy", () => {
    const currentModel = getCurrentModel("google", "gemini-2.5-pro");

    const fast = resolveForMainSession(currentModel, "fast");
    const balanced = resolveForMainSession(currentModel, "balanced");
    const deep = resolveForMainSession(currentModel, "deep");

    expect(fast?.model.provider).toBe("google");
    expect(fast?.model.id).toBe("gemini-2.5-flash");

    expect(balanced?.model.provider).toBe("google");
    expect(balanced?.model.id).toBe("gemini-2.5-pro");

    expect(deep?.model.provider).toBe("google");
    expect(deep?.model.id).toBe("gemini-3.1-pro-preview");
  });

  it("uses the single workload fallback when the chosen provider has no configured mapping", () => {
    const currentModel = getCurrentModel("mistral", "devstral-medium-latest");

    const fast = resolveForMainSession(currentModel, "fast");
    const balanced = resolveForMainSession(currentModel, "balanced");
    const deep = resolveForMainSession(currentModel, "deep");

    expect(fast?.model.provider).toBe("anthropic");
    expect(fast?.model.id).toBe("claude-haiku-4-5");

    expect(balanced?.model.provider).toBe("anthropic");
    expect(balanced?.model.id).toBe("claude-sonnet-4-6");

    expect(deep?.model.provider).toBe("anthropic");
    expect(deep?.model.id).toBe("claude-opus-4-6");
  });

  it("lets an explicit override bypass the main-session provider choice", () => {
    const currentModel = getCurrentModel("anthropic", "claude-sonnet-4-6");

    const result = resolveWorkloadModel(registry, currentModel, {
      provider: currentModel.provider,
      workload: "deep",
      explicitModelId: "openai-codex/gpt-5.2-codex",
    });

    expect(result).not.toBeNull();
    expect(result?.model.provider).toBe("openai-codex");
    expect(result?.model.id).toBe("gpt-5.2-codex");
    expect(result?.thinkingLevel).toBeUndefined();
  });
});
