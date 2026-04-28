/**
 * Cloudflare AI Gateway Provider Extension
 *
 * Provides access to AI models through Cloudflare AI Gateway's OpenAI-compatible endpoint.
 * Supports multiple upstream providers (OpenAI, Anthropic, Workers AI, etc.) through a unified interface.
 *
 * Model definitions are sourced from models.dev (https://models.dev/api.json), cached locally,
 * and refreshed hourly in the background. An embedded snapshot is used as fallback.
 *
 * Setup:
 *   1. Create a Cloudflare AI Gateway: https://dash.cloudflare.com/ > AI > AI Gateway
 *   2. Get your Cloudflare Account ID from: https://dash.cloudflare.com/ (right sidebar)
 *   3. Create a Cloudflare API Token with "AI Gateway - Read" and "AI Gateway - Edit" permissions
 *
 * Configuration (in ~/.pi/agent/cloudflare-ai-gateway.json):
 *   {
 *     "accountId": "your-account-id",
 *     "gatewayName": "your-gateway-name"
 *   }
 *
 *   - accountId: Your Cloudflare Account ID
 *   - gatewayName: The name of your AI Gateway
 *
 * API Key (for authenticated gateways):
 *   - auth.json: { "cloudflare-ai-gateway": { "type": "api_key", "key": "your-token" } }
 *   - Environment: CLOUDFLARE_AI_GATEWAY_TOKEN=your-token
 *   - Or omit for BYOK (store keys in Cloudflare dashboard)
 *
 * Usage:
 *   /model cloudflare-ai-gateway/openai/gpt-4o
 *   /model cloudflare-ai-gateway/anthropic/claude-sonnet-4
 *   /model cloudflare-ai-gateway/workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast
 *
 * For dynamic routing and fallbacks, configure in Cloudflare AI Gateway dashboard:
 *   https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type ModelConfig, getModels, refreshModels } from "./models.js";

interface CloudflareConfig {
	accountId: string;
	gatewayName: string;
}

function getAgentDir(): string {
	return process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function getConfigPath(): string {
	return join(getAgentDir(), "cloudflare-ai-gateway.json");
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
			console.warn(
				"[Cloudflare AI Gateway] Invalid config: accountId and gatewayName are required in cloudflare-ai-gateway.json",
			);
			return null;
		}

		return config;
	} catch (error) {
		console.warn(
			`[Cloudflare AI Gateway] Failed to load config from ${configPath}: ${error instanceof Error ? error.message : error}`,
		);
		return null;
	}
}

function loadTokenFromAuthJson(): string {
	const authPath = join(getAgentDir(), "auth.json");
	if (!existsSync(authPath)) return "";
	try {
		const auth = JSON.parse(readFileSync(authPath, "utf-8")) as Record<
			string,
			{ type?: string; key?: string }
		>;
		return auth["cloudflare-ai-gateway"]?.key ?? "";
	} catch {
		return "";
	}
}

const config = loadConfig();

const CLOUDFLARE_ACCOUNT_ID = config?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const CLOUDFLARE_AI_GATEWAY_NAME = config?.gatewayName ?? process.env.CLOUDFLARE_AI_GATEWAY_NAME ?? "";
const CLOUDFLARE_AI_GATEWAY_TOKEN =
	loadTokenFromAuthJson() || (process.env.CLOUDFLARE_AI_GATEWAY_TOKEN ?? "");

const AI_GATEWAY_BASE_URL =
	CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_AI_GATEWAY_NAME
		? `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_AI_GATEWAY_NAME}`
		: "";

export default function (pi: ExtensionAPI) {
	if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_GATEWAY_NAME) {
		const configPath = getConfigPath();
		console.warn("[Cloudflare AI Gateway] Configuration not found.");
		console.warn(`[Cloudflare AI Gateway] Create ${configPath} with:`);
		console.warn('  { "accountId": "your-account-id", "gatewayName": "your-gateway-name" }');
		console.warn("[Cloudflare AI Gateway] Or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_NAME environment variables.");
	}

	const ctx = {
		accountId: CLOUDFLARE_ACCOUNT_ID,
		gatewayName: CLOUDFLARE_AI_GATEWAY_NAME,
		token: CLOUDFLARE_AI_GATEWAY_TOKEN,
	};

	const register = (models: ModelConfig[]) => {
		pi.registerProvider("cloudflare-ai-gateway", {
			baseUrl: AI_GATEWAY_BASE_URL,
			apiKey: "CLOUDFLARE_AI_GATEWAY_TOKEN",
			api: "openai-completions",
			models,
			authHeader: true,
			headers: {},
		});
	};

	register(getModels());

	refreshModels(ctx).then((fresh) => {
		if (fresh) register(fresh);
	});
}
