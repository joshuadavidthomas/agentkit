/**
 * Cloudflare AI Gateway Provider Extension
 *
 * Provides access to AI models through Cloudflare AI Gateway's OpenAI-compatible endpoint.
 * Supports multiple upstream providers (OpenAI, Anthropic, etc.) through a unified interface.
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
 *   # With the extension
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-cloudflare-ai-gateway
 *
 *   # Select a model
 *   /model cloudflare-ai-gateway/gpt-4o
 *
 *   # Or specify at startup
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-cloudflare-ai-gateway --model cloudflare-ai-gateway/gpt-4o
 *
 * For dynamic routing and fallbacks, configure in Cloudflare AI Gateway dashboard:
 *   https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Configuration
// =============================================================================

interface CloudflareConfig {
	accountId: string;
	gatewayName: string;
}

function getConfigPath(): string {
	// Use PI_AGENT_DIR if set, otherwise default to ~/.pi/agent
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

		// Validate required fields
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

// Load configuration
const config = loadConfig();

// accountId and gatewayName come from config file (preferred) or env vars
const CLOUDFLARE_ACCOUNT_ID = config?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const CLOUDFLARE_AI_GATEWAY_NAME = config?.gatewayName ?? process.env.CLOUDFLARE_AI_GATEWAY_NAME ?? "";

/**
 * Base URL for Cloudflare AI Gateway OpenAI-compatible endpoint
 */
const AI_GATEWAY_BASE_URL =
	CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_AI_GATEWAY_NAME
		? `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_AI_GATEWAY_NAME}`
		: "";

// =============================================================================
// Models
// =============================================================================

/**
 * Define models available through your Cloudflare AI Gateway.
 *
 * The model IDs should match what your gateway is configured to route to.
 * Cloudflare AI Gateway supports multiple upstream providers:
 *   - OpenAI (gpt-4o, gpt-4o-mini, etc.)
 *   - Anthropic (claude-sonnet-4, claude-opus-4, etc.)
 *   - Google AI Studio (gemini models)
 *   - Workers AI (Cloudflare's models)
 *   - And more...
 *
 * Cost is per million tokens. Set to 0 if using Cloudflare's unified billing
 * or if costs are tracked elsewhere.
 */
const MODELS = [
	// OpenAI models (via AI Gateway)
	{
		id: "gpt-4o",
		name: "GPT-4o (via Cloudflare AI Gateway)",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	{
		id: "gpt-4o-mini",
		name: "GPT-4o Mini (via Cloudflare AI Gateway)",
		reasoning: false,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
	},
	// Anthropic models (via AI Gateway)
	{
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4 (via Cloudflare AI Gateway)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 64000,
	},
	{
		id: "claude-opus-4",
		name: "Claude Opus 4 (via Cloudflare AI Gateway)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
		contextWindow: 200000,
		maxTokens: 32000,
	},
	// Workers AI models (Cloudflare's inference platform)
	{
		id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		name: "Llama 3.3 70B (via Workers AI)",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
	{
		id: "@cf/deepseek/deepseek-r1-distill-qwen-32b",
		name: "DeepSeek R1 Distill Qwen 32B (via Workers AI)",
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	},
];

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	// Check if required configuration is set
	if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_GATEWAY_NAME) {
		const configPath = getConfigPath();
		console.warn("[Cloudflare AI Gateway] Configuration not found.");
		console.warn(`[Cloudflare AI Gateway] Create ${configPath} with:`);
		console.warn('  { "accountId": "your-account-id", "gatewayName": "your-gateway-name" }');
		console.warn("[Cloudflare AI Gateway] Or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_NAME environment variables.");
	}

	pi.registerProvider("cloudflare-ai-gateway", {
		// OpenAI-compatible endpoint
		baseUrl: AI_GATEWAY_BASE_URL,

		// API key resolution order (handled by pi's AuthStorage):
		// 1. auth.json cloudflare-ai-gateway entry (type: "api_key")
		// 2. CLOUDFLARE_AI_GATEWAY_TOKEN environment variable
		apiKey: "CLOUDFLARE_AI_GATEWAY_TOKEN",

		// Use OpenAI Completions API - Cloudflare AI Gateway is OpenAI-compatible
		api: "openai-completions",

		// Model definitions
		models: MODELS,

		// Add auth header if using Cloudflare API token
		// If using BYOK (store keys in Cloudflare), upstream auth is handled by gateway
		authHeader: true,

		// Optional: Custom headers for logging/metadata
		headers: {
			// "CF-AI-Gateway-Metadata": JSON.stringify({ user: "pi-coding-agent" }),
		},
	});
}
