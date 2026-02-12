/**
 * Test script for Cloudflare AI Gateway extension
 * Run: npx tsx test.ts [model-id]
 *
 * Examples:
 *   npx tsx test.ts                              # Test default (openai/gpt-4o)
 *   npx tsx test.ts anthropic/claude-sonnet-4    # Test Claude via gateway
 *   npx tsx test.ts openai/gpt-4o-mini           # Test GPT-4o-mini
 */

import { type Api, type Context, type Model, streamSimple } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { type ModelConfig, getModels } from "./models.js";

interface CloudflareConfig {
	accountId: string;
	gatewayName: string;
}

function getConfigPath(): string {
	const agentDir = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, "cloudflare-ai-gateway.json");
}

function loadConfig(): CloudflareConfig | null {
	const configPath = getConfigPath();

	if (!existsSync(configPath)) {
		return null;
	}

	try {
		const content = readFileSync(configPath, "utf-8");
		const config = JSON.parse(content) as CloudflareConfig;

		if (!config.accountId || !config.gatewayName) {
			console.error("[Cloudflare AI Gateway] Invalid config: accountId and gatewayName are required");
			return null;
		}

		return config;
	} catch (error) {
		console.error(`[Cloudflare AI Gateway] Failed to load config: ${error instanceof Error ? error.message : error}`);
		return null;
	}
}

const config = loadConfig();

const CLOUDFLARE_ACCOUNT_ID = config?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const CLOUDFLARE_AI_GATEWAY_NAME = config?.gatewayName ?? process.env.CLOUDFLARE_AI_GATEWAY_NAME ?? "";
const CLOUDFLARE_AI_GATEWAY_TOKEN = process.env.CLOUDFLARE_AI_GATEWAY_TOKEN ?? "";

const AI_GATEWAY_BASE_URL =
	CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_AI_GATEWAY_NAME
		? `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_AI_GATEWAY_NAME}`
		: "";

async function main() {
	const modelId = process.argv[2] || "openai/gpt-4o";

	if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_GATEWAY_NAME) {
		const configPath = getConfigPath();
		console.error("Error: Cloudflare AI Gateway configuration not found.");
		console.error(`Create ${configPath} with:`);
		console.error('  { "accountId": "your-account-id", "gatewayName": "your-gateway-name" }');
		console.error("Or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_NAME environment variables.");
		process.exit(1);
	}

	if (!CLOUDFLARE_AI_GATEWAY_TOKEN) {
		console.warn("Warning: No API token found. Ensure your gateway allows unauthenticated requests or use BYOK.");
	}

	const models = getModels();
	const MODEL_MAP = new Map<string, ModelConfig>(models.map((m) => [m.id, m]));

	const cfg = MODEL_MAP.get(modelId);
	if (!cfg) {
		console.error(`Unknown model: ${modelId}`);
		console.error("Available:", models.map((m) => m.id).join(", "));
		process.exit(1);
	}

	const model: Model<Api> = {
		id: cfg.id,
		name: cfg.name,
		api: "openai-completions" as Api,
		provider: "cloudflare-ai-gateway",
		baseUrl: AI_GATEWAY_BASE_URL,
		reasoning: cfg.reasoning,
		input: cfg.input,
		cost: cfg.cost,
		contextWindow: cfg.contextWindow,
		maxTokens: cfg.maxTokens,
	};

	const context: Context = {
		messages: [{ role: "user", content: "Say hello in exactly 3 words.", timestamp: Date.now() }],
	};

	console.log(`Model: ${model.id}`);
	console.log(`Gateway: ${AI_GATEWAY_BASE_URL}/compat/chat/completions`);
	console.log("---");

	try {
		const stream = streamSimple(model, context, {
			apiKey: CLOUDFLARE_AI_GATEWAY_TOKEN,
			maxTokens: 100,
		});

		for await (const event of stream) {
			if (event.type === "text_delta") {
				process.stdout.write(event.delta);
			} else if (event.type === "error") {
				console.error("\nError:", event.error.errorMessage);
				process.exit(1);
			} else if (event.type === "done") {
				console.log("\n\nDone!");
				console.log("Stop reason:", event.reason);
				console.log("Usage:", JSON.stringify(event.message.usage, null, 2));
			}
		}
	} catch (error) {
		console.error("\nFatal error:", error);
		process.exit(1);
	}
}

main().catch(console.error);
