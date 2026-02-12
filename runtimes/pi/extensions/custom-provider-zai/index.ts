/**
 * ZAI Custom Provider Extension
 *
 * Provides access to GLM models through Cerebras and ZAI endpoints.
 *
 * API Keys (in order of precedence):
 *   1. Config file (~/.pi/agent/zai.json):
 *      {
 *        "cerebrasApiKey": "your-cerebras-key",
 *        "zaiApiKey": "your-zai-key"
 *      }
 *   2. Environment variables: CEREBRAS_API_KEY, ZAI_API_KEY
 *
 * Models are only registered when their provider's API key is available.
 *
 * Vendored from vedang/agents with modifications.
 */

import {
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  streamSimpleOpenAICompletions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildZaiProviderConfig, createZaiStreamSimple } from "./config";

type PiStreamSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

function streamSimpleViaOpenAICompletions(
  model: unknown,
  context: unknown,
  options?: Record<string, unknown>,
): unknown {
  return streamSimpleOpenAICompletions(
    model as Model<"openai-completions">,
    context as Context,
    options as SimpleStreamOptions,
  );
}

export default function zaiCustomExtension(pi: ExtensionAPI): void {
  const streamSimple = createZaiStreamSimple(
    streamSimpleViaOpenAICompletions,
  ) as unknown as PiStreamSimple;

  pi.registerProvider("zai-custom", buildZaiProviderConfig({ streamSimple }));
}
