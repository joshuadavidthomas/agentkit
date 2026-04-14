import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type OpenAICompletionsStreamSimple = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

let openAICompletionsStreamSimplePromise: Promise<OpenAICompletionsStreamSimple> | null = null;

async function loadOpenAICompletionsStreamSimple(): Promise<OpenAICompletionsStreamSimple> {
	if (!openAICompletionsStreamSimplePromise) {
		openAICompletionsStreamSimplePromise = (async () => {
			const dist = dirname(fileURLToPath(import.meta.resolve("@mariozechner/pi-ai")));
			const mod = await import(join(dist, "providers", "openai-completions.js"));
			return mod.streamSimpleOpenAICompletions as OpenAICompletionsStreamSimple;
		})();
	}
	return openAICompletionsStreamSimplePromise;
}

export function streamCloudflareAIGateway(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	void (async () => {
		try {
			const streamSimpleOpenAICompletions = await loadOpenAICompletionsStreamSimple();
			const sessionId = options?.sessionId?.trim();
			const sessionAffinity = sessionId ? `${sessionId}:${model.id}` : undefined;
			const headers = sessionAffinity || options?.headers
				? {
						...(sessionAffinity ? { "x-session-affinity": sessionAffinity } : {}),
						...options?.headers,
					}
				: undefined;

			const innerStream = streamSimpleOpenAICompletions(model as Model<"openai-completions">, context, {
				...options,
				headers,
			});

			for await (const event of innerStream) {
				stream.push(event);
			}
			stream.end();
		} catch (error) {
			stream.push({
				type: "error",
				reason: "error",
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();

	return stream;
}
