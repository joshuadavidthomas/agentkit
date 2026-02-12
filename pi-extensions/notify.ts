/**
 * Desktop Notification Extension
 *
 * Sends a native desktop notification when the agent finishes and is waiting for input.
 * Uses a quick model call to summarize what happened in the last turn.
 *
 * Uses OSC 777 escape sequence - no external dependencies.
 *
 * Supported terminals: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * Not supported: Kitty (uses OSC 99), Terminal.app, Windows Terminal, Alacritty
 */

import { complete, getModel } from "@mariozechner/pi-ai";
import type { TextContent, ToolCall } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

// Cheap models for summarization - try in order (cheapest first)
const SUMMARY_MODELS = [
	{ provider: "google-antigravity", id: "gemini-3-flash" },  // $0.50/$3.00 per M
	{ provider: "anthropic", id: "claude-haiku-4-5" },          // $1.00/$5.00 per M
] as const;

/**
 * Send a desktop notification via OSC 777 escape sequence.
 */
function notify(title: string, body: string): void {
	// OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isTextContent = (value: unknown): value is TextContent =>
	isRecord(value) && value.type === "text" && typeof value.text === "string";

const isToolCall = (value: unknown): value is ToolCall =>
	isRecord(value) && value.type === "toolCall" && typeof value.name === "string";

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
		toolName?: string;
	};
};

/**
 * Extract text parts from message content
 */
function extractTextParts(content: unknown): string[] {
	if (typeof content === "string") {
		return [content];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	const textParts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		if (isTextContent(part)) {
			textParts.push(part.text);
		}
	}

	return textParts;
}

/**
 * Extract tool call info from message content
 */
function extractToolCalls(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return [];
	}

	const toolCalls: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}

		if (isToolCall(part)) {
			toolCalls.push(part.name);
		}
	}

	return toolCalls;
}

/**
 * Get a summary of the last turn's activity
 */
function getLastTurnSummary(entries: SessionEntry[]): string {
	// Find the last user message and subsequent assistant activity
	let lastUserIdx = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "user") {
			lastUserIdx = i;
			break;
		}
	}

	if (lastUserIdx === -1) {
		return "";
	}

	const turnEntries = entries.slice(lastUserIdx);
	const parts: string[] = [];

	// Get user prompt (truncated)
	const userEntry = turnEntries[0];
	if (userEntry?.message?.content) {
		const userText = extractTextParts(userEntry.message.content).join(" ").trim();
		if (userText) {
			parts.push(`User asked: ${userText.slice(0, 200)}${userText.length > 200 ? "..." : ""}`);
		}
	}

	// Gather assistant activity
	const toolsUsed = new Set<string>();
	let assistantText = "";

	for (const entry of turnEntries.slice(1)) {
		if (entry.type !== "message" || !entry.message?.role) continue;

		if (entry.message.role === "assistant") {
			// Get tools called
			const tools = extractToolCalls(entry.message.content);
			tools.forEach((t) => toolsUsed.add(t));

			// Get assistant text (last one wins)
			const text = extractTextParts(entry.message.content).join(" ").trim();
			if (text) {
				assistantText = text;
			}
		}

		if (entry.message.role === "toolResult" && entry.message.toolName) {
			toolsUsed.add(entry.message.toolName);
		}
	}

	if (toolsUsed.size > 0) {
		parts.push(`Tools used: ${Array.from(toolsUsed).join(", ")}`);
	}

	if (assistantText) {
		parts.push(`Response: ${assistantText.slice(0, 300)}${assistantText.length > 300 ? "..." : ""}`);
	}

	return parts.join("\n\n");
}

/**
 * Find the first available model from our preferred list
 */
async function selectSummaryModel(ctx: ExtensionContext) {
	for (const { provider, id } of SUMMARY_MODELS) {
		const model = getModel(provider, id);
		if (!model) continue;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) continue;

		return { model, apiKey };
	}
	return null;
}

/**
 * Generate a short notification summary using a quick model call
 */
async function generateNotificationSummary(turnSummary: string, ctx: ExtensionContext): Promise<string> {
	const selected = await selectSummaryModel(ctx);
	if (!selected) {
		return "Ready for input";
	}

	const { model, apiKey } = selected;

	const prompt = `Generate a desktop notification (max 50 chars). Output ONLY the text, nothing else.

Turn activity:
${turnSummary}

Rules:
- If waiting for user decision, lead with that: "Need: which DB?" or "Decision: API design"
- Otherwise summarize what was done with filenames: "Wrote auth.py, added login"
- Be specific, not generic

NO QUESTIONS. NO EXPLANATIONS. JUST THE NOTIFICATION TEXT.`;

	try {
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey }
		);

		const summary = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();

		// Ensure it's not too long for a notification
		if (summary && summary.length <= 80) {
			return summary;
		} else if (summary) {
			return summary.slice(0, 77) + "...";
		}
	} catch (err) {
		// Log to debug file for troubleshooting
		const fs = await import("node:fs/promises");
		const timestamp = new Date().toISOString();
		const errorMsg = err instanceof Error ? err.message : String(err);
		await fs.appendFile("/tmp/pi-notify-debug.log", `[${timestamp}] Error: ${errorMsg}\n`).catch(() => {});
	}

	return "Ready for input";
}

/**
 * Get a short project name from the cwd
 */
function getProjectName(cwd: string): string {
	// Get the last directory name as the project identifier
	const parts = cwd.split("/").filter(Boolean);
	return parts[parts.length - 1] || "pi";
}

// Delay before showing notification (ms) - skip if new prompt comes in
const NOTIFY_DELAY_MS = 10_000;

export default function (pi: ExtensionAPI) {
	let pendingNotifyTimeout: ReturnType<typeof setTimeout> | null = null;

	// Cancel pending notification when a new prompt starts
	pi.on("agent_start", async () => {
		if (pendingNotifyTimeout) {
			clearTimeout(pendingNotifyTimeout);
			pendingNotifyTimeout = null;
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		// Cancel any existing pending notification
		if (pendingNotifyTimeout) {
			clearTimeout(pendingNotifyTimeout);
		}

		const branch = ctx.sessionManager.getBranch();
		const turnSummary = getLastTurnSummary(branch);
		const projectName = getProjectName(ctx.cwd);

		// Delay the notification - if user sends another prompt, it'll be cancelled
		pendingNotifyTimeout = setTimeout(async () => {
			pendingNotifyTimeout = null;

			let notificationText = "Ready for input";
			if (turnSummary) {
				notificationText = await generateNotificationSummary(turnSummary, ctx);
			}

			notify(`Pi · ${projectName}`, notificationText);
		}, NOTIFY_DELAY_MS);
	});
}
