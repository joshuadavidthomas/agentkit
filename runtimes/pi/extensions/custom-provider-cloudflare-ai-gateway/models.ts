/**
 * Dynamic model loading from models.dev
 *
 * Three-layer resolution:
 *   1. Disk cache (~/.cache/pi/cloudflare-ai-gateway-models.json)
 *   2. Embedded snapshot (works offline, first run)
 *   3. Background fetch to refresh cache for next startup
 *
 * Data source: https://models.dev/api.json (same as OpenCode)
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const PROVIDER_KEY = "cloudflare-ai-gateway";

// Refresh cache if older than 1 hour
const CACHE_TTL_MS = 60 * 60 * 1000;

interface ModelsDevModel {
	id: string;
	name: string;
	reasoning: boolean;
	modalities: {
		input: string[];
		output: string[];
	};
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit: {
		context: number;
		output: number;
	};
}

interface ModelsDevProvider {
	id: string;
	models: Record<string, ModelsDevModel>;
}

export interface ModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

function getCachePath(): string {
	return join(homedir(), ".cache", "pi", "cloudflare-ai-gateway-models.json");
}

function transformModel(model: ModelsDevModel): ModelConfig {
	const input = model.modalities.input.filter(
		(m): m is "text" | "image" => m === "text" || m === "image",
	);

	return {
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		input: input.length > 0 ? input : ["text"],
		cost: {
			input: model.cost.input ?? 0,
			output: model.cost.output ?? 0,
			cacheRead: model.cost.cache_read ?? 0,
			cacheWrite: model.cost.cache_write ?? 0,
		},
		contextWindow: model.limit.context,
		maxTokens: model.limit.output,
	};
}

function loadFromCache(): ModelConfig[] | null {
	const cachePath = getCachePath();

	if (!existsSync(cachePath)) {
		return null;
	}

	try {
		const content = readFileSync(cachePath, "utf-8");
		const models = JSON.parse(content) as ModelConfig[];

		if (!Array.isArray(models) || models.length === 0) {
			return null;
		}

		return models;
	} catch {
		return null;
	}
}

function saveToCache(models: ModelConfig[]): void {
	const cachePath = getCachePath();

	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(models, null, 2));
	} catch (error) {
		console.warn(
			`[Cloudflare AI Gateway] Failed to write model cache: ${error instanceof Error ? error.message : error}`,
		);
	}
}

async function fetchModels(): Promise<ModelConfig[] | null> {
	try {
		const response = await fetch(MODELS_DEV_API_URL);

		if (!response.ok) {
			console.warn(
				`[Cloudflare AI Gateway] Failed to fetch models.dev: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const data = (await response.json()) as Record<string, ModelsDevProvider>;
		const provider = data[PROVIDER_KEY];

		if (!provider?.models) {
			console.warn(
				`[Cloudflare AI Gateway] No "${PROVIDER_KEY}" provider found in models.dev data`,
			);
			return null;
		}

		const models = Object.values(provider.models).map(transformModel);
		models.sort((a, b) => a.id.localeCompare(b.id));
		return models;
	} catch (error) {
		console.warn(
			`[Cloudflare AI Gateway] Failed to fetch models.dev: ${error instanceof Error ? error.message : error}`,
		);
		return null;
	}
}

function isCacheStale(): boolean {
	const cachePath = getCachePath();

	if (!existsSync(cachePath)) {
		return true;
	}

	try {
		const mtime = statSync(cachePath).mtimeMs;
		return Date.now() - mtime > CACHE_TTL_MS;
	} catch {
		return true;
	}
}

/**
 * Fetch models from models.dev and update the cache.
 * Non-blocking — errors are logged but don't affect the extension.
 */
export function refreshModelsInBackground(): void {
	if (!isCacheStale()) return;

	fetchModels()
		.then((models) => {
			if (models && models.length > 0) {
				saveToCache(models);
			}
		})
		.catch(() => {
			// Silently ignore — we have cache or snapshot as fallback
		});
}

/**
 * Get model definitions. Resolution order:
 *   1. Disk cache (fast, usually fresh)
 *   2. Embedded snapshot (always available)
 *
 * Always returns models sorted alphabetically by id.
 */
export function getModels(): ModelConfig[] {
	const models = loadFromCache() ?? SNAPSHOT_MODELS;
	models.sort((a, b) => a.id.localeCompare(b.id));
	return models;
}

// Snapshot generated from models.dev on 2026-02-12
// Regenerate: fetch https://models.dev/api.json and extract cloudflare-ai-gateway models
const SNAPSHOT_MODELS: ModelConfig[] = [
	{
		id: "anthropic/claude-3-5-haiku",
		name: "Claude 3.5 Haiku",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "anthropic/claude-3-haiku",
		name: "Claude 3 Haiku",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		id: "anthropic/claude-3-opus",
		name: "Claude 3 Opus",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		id: "anthropic/claude-3-sonnet",
		name: "Claude 3 Sonnet",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 4096,
	},
	{
		id: "anthropic/claude-3.5-haiku",
		name: "Claude 3.5 Haiku",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "anthropic/claude-3.5-sonnet",
		name: "Claude 3.5 Sonnet",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "anthropic/claude-haiku-4-5",
		name: "Claude Haiku 4.5",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "anthropic/claude-opus-4",
		name: "Claude Opus 4",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	{
		id: "anthropic/claude-opus-4-1",
		name: "Claude Opus 4 (January)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	{
		id: "anthropic/claude-opus-4-5",
		name: "Claude Opus 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	{
		id: "anthropic/claude-opus-4-6",
		name: "Claude Opus 4 (June)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	{
		id: "anthropic/claude-sonnet-4",
		name: "Claude Sonnet 4 (latest)",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "anthropic/claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "openai/gpt-3.5-turbo",
		name: "GPT-3.5 Turbo",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16385,
		maxTokens: 4096,
	},
	{
		id: "openai/gpt-4",
		name: "GPT-4",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "openai/gpt-4-turbo",
		name: "GPT-4 Turbo",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
	{
		id: "openai/gpt-4o",
		name: "GPT-4o",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "openai/gpt-4o-mini",
		name: "GPT-4o Mini",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "openai/gpt-5.1",
		name: "GPT-5.1",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 1047576,
		maxTokens: 65536,
	},
	{
		id: "openai/gpt-5.1-codex",
		name: "GPT-5.1 Codex",
		reasoning: true,
		input: ["text"],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 1047576,
		maxTokens: 65536,
	},
	{
		id: "openai/gpt-5.2",
		name: "GPT-5.2",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 1047576,
		maxTokens: 65536,
	},
	{
		id: "openai/o1",
		name: "o1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 100000,
	},
	{
		id: "openai/o3",
		name: "o3",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 100000,
	},
	{
		id: "openai/o3-mini",
		name: "o3 Mini",
		reasoning: true,
		input: ["text"],
		cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 100000,
	},
	{
		id: "openai/o3-pro",
		name: "o3 Pro",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 100000,
	},
	{
		id: "openai/o4-mini",
		name: "o4 Mini",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 100000,
	},
	{
		id: "workers-ai/@cf/ai4bharat/indictrans2-en-indic-1B",
		name: "IndicTrans2 EN-Indic 1B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/aisingapore/gemma-sea-lion-v4-27b-it",
		name: "Gemma SEA-LION v4 27B IT",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/baai/bge-base-en-v1.5",
		name: "BGE Base EN v1.5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/baai/bge-large-en-v1.5",
		name: "BGE Large EN v1.5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/baai/bge-m3",
		name: "BGE M3",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/baai/bge-reranker-base",
		name: "BGE Reranker Base",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/baai/bge-small-en-v1.5",
		name: "BGE Small EN v1.5",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/deepgram/aura-2-en",
		name: "Aura 2 EN",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/deepgram/aura-2-es",
		name: "Aura 2 ES",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/deepgram/nova-3",
		name: "Nova 3",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
		name: "DeepSeek R1 Distill Qwen 32B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/facebook/bart-large-cnn",
		name: "BART Large CNN",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/google/gemma-3-12b-it",
		name: "Gemma 3 12B IT",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.067, output: 0.33, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/huggingface/distilbert-sst-2-int8",
		name: "DistilBERT SST-2 INT8",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.026, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/ibm-granite/granite-4.0-h-micro",
		name: "IBM Granite 4.0 H Micro",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.017, output: 0.11, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-2-7b-chat-fp16",
		name: "Llama 2 7B Chat FP16",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.56, output: 6.72, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3-8b-instruct",
		name: "Llama 3 8B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3-8b-instruct-awq",
		name: "Llama 3 8B Instruct AWQ",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.1-8b-instruct",
		name: "Llama 3.1 8B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.1-8b-instruct-awq",
		name: "Llama 3.1 8B Instruct AWQ",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.1-8b-instruct-fp8",
		name: "Llama 3.1 8B Instruct FP8",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.2-11b-vision-instruct",
		name: "Llama 3.2 11B Vision Instruct",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.042, output: 0.042, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.2-1b-instruct",
		name: "Llama 3.2 1B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.2-3b-instruct",
		name: "Llama 3.2 3B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		name: "Llama 3.3 70B Instruct FP8 Fast",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.29, output: 2.25, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct",
		name: "Llama 4 Scout 17B 16E Instruct",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/llama-guard-3-8b",
		name: "Llama Guard 3 8B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.092, output: 0.092, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/meta/m2m100-1.2b",
		name: "M2M100 1.2B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/mistral/mistral-7b-instruct-v0.1",
		name: "Mistral 7B Instruct v0.1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.11, output: 0.19, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/mistralai/mistral-small-3.1-24b-instruct",
		name: "Mistral Small 3.1 24B Instruct",
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/myshell-ai/melotts",
		name: "MeloTTS",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/openai/gpt-oss-120b",
		name: "GPT OSS 120B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/openai/gpt-oss-20b",
		name: "GPT OSS 20B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.018, output: 0.056, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/pfnet/plamo-embedding-1b",
		name: "PLaMo Embedding 1B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/pipecat-ai/smart-turn-v2",
		name: "Smart Turn v2",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/qwen/qwen2.5-coder-32b-instruct",
		name: "Qwen 2.5 Coder 32B Instruct",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/qwen/qwen3-30b-a3b-fp8",
		name: "Qwen 3 30B A3B FP8",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/qwen/qwen3-embedding-0.6b",
		name: "Qwen 3 Embedding 0.6B",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "workers-ai/@cf/qwen/qwq-32b",
		name: "QwQ 32B",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.18, output: 0.56, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
];
