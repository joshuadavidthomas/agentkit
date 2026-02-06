/**
 * Ralph Loop Extension — Phase 2: Extension Shell
 *
 * Provides commands for loop lifecycle management:
 *   /ralph start, stop, status, list, kill, clean, demo
 *
 * Spawns loop runners as detached processes, communicates via filesystem.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	AssistantMessageComponent,
	getMarkdownTheme,
	ToolExecutionComponent,
} from "@mariozechner/pi-coding-agent";
import { Container, Loader, Spacer, TUI } from "@mariozechner/pi-tui";
import type { Component, Terminal } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { LoopConfig, LoopState, RegistryEntry } from "./types.ts";
import { loopDir, registryDir, registryFilename } from "./types.ts";

// ── Resolve paths ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOOP_RUNNER_PATH = join(__dirname, "loop-runner.ts");

/**
 * Resolve the jiti CLI path for spawning TypeScript subprocesses.
 * Uses the same pattern as pi-subagents: createRequire + jiti-cli.mjs.
 * Tries both `jiti` (upstream) and `@mariozechner/jiti` (pi's fork).
 */
const require = createRequire(import.meta.url);
const jitiCliPath: string | undefined = (() => {
	try {
		return join(dirname(require.resolve("jiti/package.json")), "lib/jiti-cli.mjs");
	} catch {
		try {
			return join(dirname(require.resolve("@mariozechner/jiti/package.json")), "lib/jiti-cli.mjs");
		} catch {
			return undefined;
		}
	}
})();

// ── Stub TUI for ToolExecutionComponent ────────────────────────────

const stubTerminal: Terminal = {
	start() {},
	stop() {},
	write() {},
	get columns() {
		return process.stdout.columns ?? 120;
	},
	get rows() {
		return process.stdout.rows ?? 40;
	},
	get kittyProtocolActive() {
		return false;
	},
	moveBy() {},
	hideCursor() {},
	showCursor() {},
	clearLine() {},
	clearFromCursor() {},
	clearScreen() {},
	setTitle() {},
};
const stubTui = new TUI(stubTerminal);

// ── Helpers ────────────────────────────────────────────────────────

class LabeledBorder implements Component {
	constructor(
		private label: string,
		private color: (s: string) => string,
	) {}
	invalidate() {}
	render(width: number): string[] {
		const padded = ` ${this.label} `;
		const left = 3;
		const right = Math.max(1, width - left - padded.length);
		return [this.color("─".repeat(left) + padded + "─".repeat(right))];
	}
}

function renderAsAssistantMessage(text: string): AssistantMessageComponent {
	return new AssistantMessageComponent(
		{
			role: "assistant",
			content: [{ type: "text", text }],
			api: "messages",
			provider: "anthropic",
			model: "unknown",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		},
		true,
		getMarkdownTheme(),
	);
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function fmtDuration(ms: number): string {
	const secs = Math.round(ms / 1000);
	if (secs < 60) return `${secs}s`;
	const mins = Math.floor(secs / 60);
	const remainSecs = secs % 60;
	if (mins < 60) return `${mins}m${remainSecs}s`;
	const hours = Math.floor(mins / 60);
	const remainMins = mins % 60;
	return `${hours}h${remainMins}m`;
}

function fmtCost(cost: number): string {
	return `$${cost.toFixed(3)}`;
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** Read state.json from a ralph loop directory, or null if missing/invalid */
function readLoopState(dir: string): LoopState | null {
	const statePath = join(dir, "state.json");
	try {
		return JSON.parse(readFileSync(statePath, "utf-8")) as LoopState;
	} catch {
		return null;
	}
}

/** Read a registry entry, or null if missing/invalid */
function readRegistryEntry(path: string): RegistryEntry | null {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as RegistryEntry;
	} catch {
		return null;
	}
}

/** List all local .ralph/<name>/ loop directories in the given project cwd */
function listLocalLoops(cwd: string): Array<{ name: string; dir: string; state: LoopState | null }> {
	const ralphRoot = join(cwd, ".ralph");
	if (!existsSync(ralphRoot)) return [];

	const results: Array<{ name: string; dir: string; state: LoopState | null }> = [];
	try {
		for (const entry of readdirSync(ralphRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(ralphRoot, entry.name);
			// Must have state.json or config.json to be a loop dir
			if (!existsSync(join(dir, "config.json"))) continue;
			results.push({
				name: entry.name,
				dir,
				state: readLoopState(dir),
			});
		}
	} catch {
		// ignore
	}
	return results;
}

/** List all registry entries (global, all projects) */
function listRegistryEntries(): Array<{ file: string; entry: RegistryEntry }> {
	const regDir = registryDir();
	if (!existsSync(regDir)) return [];

	const results: Array<{ file: string; entry: RegistryEntry }> = [];
	try {
		for (const file of readdirSync(regDir)) {
			if (!file.endsWith(".json")) continue;
			const entry = readRegistryEntry(join(regDir, file));
			if (entry) results.push({ file, entry });
		}
	} catch {
		// ignore
	}
	return results;
}

/** Clean stale registry entries (PID dead). Returns count of cleaned entries. */
function pruneStaleRegistryEntries(): number {
	const regDir = registryDir();
	if (!existsSync(regDir)) return 0;

	let pruned = 0;
	try {
		for (const file of readdirSync(regDir)) {
			if (!file.endsWith(".json")) continue;
			const filePath = join(regDir, file);
			const entry = readRegistryEntry(filePath);
			if (!entry) continue;

			if (!isPidAlive(entry.pid)) {
				try {
					unlinkSync(filePath);
					pruned++;
				} catch {
					// ignore
				}
			}
		}
	} catch {
		// ignore
	}
	return pruned;
}

// ── Argument Parsing ───────────────────────────────────────────────

interface ParsedStartArgs {
	name: string;
	maxIterations: number;
	model?: string;
	provider?: string;
	thinking?: string;
	taskFile?: string;
}

function parseStartArgs(argsStr: string): ParsedStartArgs | string {
	const tokens = argsStr.trim().split(/\s+/);
	if (tokens.length === 0 || tokens[0] === "") {
		return "Missing loop name. Usage: /ralph start <name> [options]";
	}

	const result: ParsedStartArgs = {
		name: tokens[0],
		maxIterations: 50,
	};

	// Validate name
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result.name)) {
		return `Invalid loop name "${result.name}". Use alphanumeric characters, dots, hyphens, and underscores.`;
	}

	let i = 1;
	while (i < tokens.length) {
		const token = tokens[i];

		if ((token === "--max-iterations" || token === "-n") && i + 1 < tokens.length) {
			const val = parseInt(tokens[i + 1], 10);
			if (isNaN(val) || val < 0) {
				return `Invalid max-iterations: "${tokens[i + 1]}". Must be a non-negative integer (0 = unlimited).`;
			}
			result.maxIterations = val;
			i += 2;
		} else if ((token === "--model" || token === "-m") && i + 1 < tokens.length) {
			result.model = tokens[i + 1];
			i += 2;
		} else if (token === "--provider" && i + 1 < tokens.length) {
			result.provider = tokens[i + 1];
			i += 2;
		} else if (token === "--thinking" && i + 1 < tokens.length) {
			result.thinking = tokens[i + 1];
			i += 2;
		} else if (token === "--task" && i + 1 < tokens.length) {
			result.taskFile = tokens[i + 1];
			i += 2;
		} else {
			return `Unknown option: "${token}". Options: --max-iterations/-n, --model/-m, --provider, --thinking, --task`;
		}
	}

	return result;
}

// ── Status Line Formatting ─────────────────────────────────────────

function statusEmoji(status: string): string {
	switch (status) {
		case "running":
			return "🔄";
		case "completed":
			return "✅";
		case "stopped":
			return "⏹";
		case "error":
			return "❌";
		case "starting":
			return "⏳";
		default:
			return "❓";
	}
}

// ── Extension Entry Point ──────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Message Renderers (from Phase 0) ────────────────────────────

	pi.registerMessageRenderer("ralph_iteration", (message, _options, theme) => {
		const color = (s: string) => theme.fg("borderMuted", s);
		return new LabeledBorder(String(message.content), color);
	});

	pi.registerMessageRenderer("ralph_tool", (message) => {
		const { toolName, args, result, isError, cwd } = message.details as {
			toolName: string;
			args: Record<string, unknown>;
			result?: { content: Array<{ type: string; text?: string }> };
			isError?: boolean;
			cwd?: string;
		};

		const comp = new ToolExecutionComponent(
			toolName,
			args,
			{ showImages: false },
			undefined,
			stubTui,
			cwd,
		);
		comp.setArgsComplete();

		if (result) {
			comp.updateResult({ ...result, isError: isError ?? false }, false);
		}

		return comp;
	});

	pi.registerMessageRenderer("ralph_assistant", (message) => {
		return renderAsAssistantMessage(String(message.content));
	});

	pi.registerMessageRenderer("ralph_status", (message, _options, theme) => {
		const color = (s: string) => theme.fg("borderMuted", s);
		return new LabeledBorder(String(message.content), color);
	});

	// ── Command Registration ────────────────────────────────────────

	pi.registerCommand("ralph", {
		description:
			"Ralph loop extension. Subcommands: start, stop, status, list, kill, clean, demo",
		getArgumentCompletions: (prefix) => {
			const subcommands = [
				"start",
				"stop",
				"status",
				"list",
				"kill",
				"clean",
				"demo",
			];
			// If prefix has a space, we're past the subcommand
			if (prefix.includes(" ")) return null;
			return subcommands
				.filter((s) => s.startsWith(prefix))
				.map((s) => ({ value: s, label: s }));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const subcommand = parts[0] || "";
			const subArgs = parts.slice(1).join(" ");

			switch (subcommand) {
				case "start":
					return handleStart(pi, ctx, subArgs);
				case "stop":
					return handleStop(pi, ctx, subArgs);
				case "status":
					return handleStatus(pi, ctx, subArgs);
				case "list":
					return handleList(pi, ctx, subArgs);
				case "kill":
					return handleKill(pi, ctx, subArgs);
				case "clean":
					return handleClean(pi, ctx, subArgs);
				case "demo":
					return runDemo(pi, ctx);
				default:
					ctx.ui.notify(
						"Usage: /ralph <start|stop|status|list|kill|clean|demo> [args]",
						"info",
					);
			}
		},
	});

	// ── Health Check on Session Start ───────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Prune dead registry entries
		const pruned = pruneStaleRegistryEntries();

		// Notify about running loops in the current project
		const localLoops = listLocalLoops(ctx.cwd);
		const runningLoops = localLoops.filter((l) => {
			if (!l.state) return false;
			if (l.state.status !== "running" && l.state.status !== "starting") return false;
			return isPidAlive(l.state.pid);
		});

		if (runningLoops.length > 0) {
			const names = runningLoops.map((l) => l.name).join(", ");
			ctx.ui.notify(
				`🔄 Ralph: ${runningLoops.length} loop${runningLoops.length > 1 ? "s" : ""} running: ${names}`,
				"info",
			);
		}

		// Check for orphaned loops (state says running but PID is dead)
		const orphanedLoops = localLoops.filter((l) => {
			if (!l.state) return false;
			if (l.state.status !== "running" && l.state.status !== "starting") return false;
			return !isPidAlive(l.state.pid);
		});

		if (orphanedLoops.length > 0) {
			const names = orphanedLoops.map((l) => l.name).join(", ");
			ctx.ui.notify(
				`⚠️ Ralph: ${orphanedLoops.length} orphaned loop${orphanedLoops.length > 1 ? "s" : ""} (crashed): ${names}`,
				"warning",
			);
		}
	});
}

// ── Command Handlers ───────────────────────────────────────────────

async function handleStart(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	argsStr: string,
) {
	const parsed = parseStartArgs(argsStr);
	if (typeof parsed === "string") {
		ctx.ui.notify(parsed, "error");
		return;
	}

	const cwd = ctx.cwd;
	const dir = loopDir(cwd, parsed.name);

	// Check if loop already exists and is running
	const existingState = readLoopState(dir);
	if (existingState && existingState.status === "running" && isPidAlive(existingState.pid)) {
		ctx.ui.notify(
			`Loop "${parsed.name}" is already running (PID ${existingState.pid}, iteration ${existingState.iteration})`,
			"warning",
		);
		return;
	}

	// Create directory structure
	mkdirSync(join(dir, "inbox"), { recursive: true });
	mkdirSync(join(dir, "iterations"), { recursive: true });

	// Handle task file
	const taskFilePath = join(dir, "task.md");
	if (parsed.taskFile) {
		// Copy from provided path
		const sourcePath = resolve(cwd, parsed.taskFile);
		if (!existsSync(sourcePath)) {
			ctx.ui.notify(`Task file not found: ${sourcePath}`, "error");
			return;
		}
		const content = readFileSync(sourcePath, "utf-8");
		writeFileSync(taskFilePath, content);
	} else if (!existsSync(taskFilePath)) {
		// Open editor for user to write the task
		if (!ctx.hasUI) {
			ctx.ui.notify("No UI available. Use --task to specify a task file.", "error");
			return;
		}

		const template = `# Task: ${parsed.name}

## Goals

Describe what this loop should accomplish.

## Checklist

- [ ] First task
- [ ] Second task

## Notes

Any additional context or constraints.
`;

		const taskContent = await ctx.ui.editor("Write the task for this loop:", template);
		if (!taskContent || !taskContent.trim()) {
			ctx.ui.notify("No task provided. Loop not started.", "warning");
			// Clean up created directories
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
			return;
		}
		writeFileSync(taskFilePath, taskContent);
	}
	// else: task file already exists from a previous run — reuse it

	// Write config.json
	const config: LoopConfig = {
		name: parsed.name,
		cwd,
		taskFile: "task.md",
		maxIterations: parsed.maxIterations,
		model: parsed.model,
		provider: parsed.provider,
		thinking: parsed.thinking,
		reflectEvery: 0,
	};
	writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");

	// Clear old events and state for fresh start
	try {
		writeFileSync(join(dir, "events.jsonl"), "");
	} catch {
		// ignore
	}

	// Resolve jiti for subprocess TypeScript execution
	if (!jitiCliPath) {
		ctx.ui.notify("Cannot find jiti CLI — needed to run TypeScript subprocess", "error");
		return;
	}

	// Spawn loop runner as detached process
	const child = spawn("node", [jitiCliPath, LOOP_RUNNER_PATH, dir], {
		cwd,
		detached: true,
		stdio: "ignore",
	});

	child.unref();

	const pid = child.pid;
	if (!pid) {
		ctx.ui.notify("Failed to spawn loop runner process", "error");
		return;
	}

	// Show confirmation
	const maxStr = parsed.maxIterations === 0 ? "unlimited" : String(parsed.maxIterations);
	const modelStr = parsed.model ? ` (model: ${parsed.model})` : "";

	ctx.ui.notify(
		`🚀 Loop "${parsed.name}" started (PID ${pid}, max: ${maxStr} iterations${modelStr})`,
		"info",
	);

	// Set status bar showing the running loop
	ctx.ui.setStatus(
		"ralph",
		ctx.ui.theme.fg("accent", `🔄 ralph: ${parsed.name}`),
	);
}

async function handleStop(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	argsStr: string,
) {
	const name = argsStr.trim();

	if (!name) {
		ctx.ui.notify(
			"Usage: /ralph stop <name>",
			"error",
		);
		return;
	}

	const dir = loopDir(ctx.cwd, name);
	const state = readLoopState(dir);

	if (!state) {
		ctx.ui.notify(`No loop found: "${name}"`, "error");
		return;
	}

	if (state.status === "stopped" || state.status === "completed") {
		ctx.ui.notify(`Loop "${name}" is already ${state.status}`, "info");
		return;
	}

	if (!isPidAlive(state.pid)) {
		ctx.ui.notify(
			`Loop "${name}" process is not running (PID ${state.pid} is dead). State: ${state.status}`,
			"warning",
		);
		return;
	}

	// Write stop command to inbox
	const inboxDir = join(dir, "inbox");
	mkdirSync(inboxDir, { recursive: true });
	writeFileSync(
		join(inboxDir, "stop.json"),
		JSON.stringify({ type: "stop" }) + "\n",
	);

	ctx.ui.notify(
		`⏹ Stopping loop "${name}" after current iteration completes...`,
		"info",
	);
}

async function handleStatus(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	argsStr: string,
) {
	const name = argsStr.trim();

	if (!name) {
		// Show summary of all local loops
		return handleList(pi, ctx, "");
	}

	const dir = loopDir(ctx.cwd, name);
	const state = readLoopState(dir);

	if (!state) {
		ctx.ui.notify(`No loop found: "${name}"`, "error");
		return;
	}

	const alive = isPidAlive(state.pid);
	const aliveStr = alive ? "alive" : "dead";

	const lines = [
		`**Loop: ${name}**`,
		"",
		`| Field | Value |`,
		`|-------|-------|`,
		`| Status | ${statusEmoji(state.status)} ${state.status} |`,
		`| PID | ${state.pid} (${aliveStr}) |`,
		`| Iteration | ${state.iteration}${state.config.maxIterations > 0 ? ` / ${state.config.maxIterations}` : ""} |`,
		`| Duration | ${fmtDuration(state.stats.durationMs)} |`,
		`| Cost | ${fmtCost(state.stats.cost)} |`,
		`| Tokens In | ${fmtTokens(state.stats.tokensIn)} |`,
		`| Tokens Out | ${fmtTokens(state.stats.tokensOut)} |`,
		`| Turns | ${state.stats.turns} |`,
		`| Started | ${new Date(state.startedAt).toLocaleString()} |`,
		`| Updated | ${new Date(state.updatedAt).toLocaleString()} |`,
	];

	if (state.config.model) {
		lines.push(`| Model | ${state.config.model} |`);
	}
	if (state.config.provider) {
		lines.push(`| Provider | ${state.config.provider} |`);
	}
	if (state.error) {
		lines.push(`| Error | ${state.error} |`);
	}

	pi.sendMessage({
		customType: "ralph_assistant",
		content: lines.join("\n"),
		display: true,
		details: {},
	});
}

async function handleList(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	argsStr: string,
) {
	const showAll = argsStr.trim() === "--all";

	if (showAll) {
		// Show all loops across all projects via registry
		const entries = listRegistryEntries();
		if (entries.length === 0) {
			ctx.ui.notify("No active loops found in registry", "info");
			return;
		}

		const lines = [
			"**All Ralph Loops (Registry)**",
			"",
			"| Name | Project | Status | Iteration | PID |",
			"|------|---------|--------|-----------|-----|",
		];

		for (const { entry } of entries) {
			const alive = isPidAlive(entry.pid);
			const pidStr = alive ? String(entry.pid) : `~~${entry.pid}~~`;
			const maxStr = entry.maxIterations > 0 ? `/${entry.maxIterations}` : "";
			lines.push(
				`| ${entry.name} | ${entry.cwd} | ${statusEmoji(entry.status)} ${entry.status} | ${entry.iteration}${maxStr} | ${pidStr} |`,
			);
		}

		pi.sendMessage({
			customType: "ralph_assistant",
			content: lines.join("\n"),
			display: true,
			details: {},
		});
		return;
	}

	// Local loops only
	const loops = listLocalLoops(ctx.cwd);
	if (loops.length === 0) {
		ctx.ui.notify("No loops found in this project. Use /ralph start <name> to create one.", "info");
		return;
	}

	const lines = [
		"**Ralph Loops**",
		"",
		"| Name | Status | Iteration | Duration | Cost | PID |",
		"|------|--------|-----------|----------|------|-----|",
	];

	for (const loop of loops) {
		if (!loop.state) {
			lines.push(
				`| ${loop.name} | ❓ unknown | - | - | - | - |`,
			);
			continue;
		}

		const s = loop.state;
		const alive = isPidAlive(s.pid);
		const pidStr = alive ? String(s.pid) : `~~${s.pid}~~`;
		const maxStr = s.config.maxIterations > 0 ? `/${s.config.maxIterations}` : "";

		lines.push(
			`| ${loop.name} | ${statusEmoji(s.status)} ${s.status} | ${s.iteration}${maxStr} | ${fmtDuration(s.stats.durationMs)} | ${fmtCost(s.stats.cost)} | ${pidStr} |`,
		);
	}

	pi.sendMessage({
		customType: "ralph_assistant",
		content: lines.join("\n"),
		display: true,
		details: {},
	});
}

async function handleKill(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	argsStr: string,
) {
	const name = argsStr.trim();
	if (!name) {
		ctx.ui.notify("Usage: /ralph kill <name>", "error");
		return;
	}

	const dir = loopDir(ctx.cwd, name);
	const state = readLoopState(dir);

	if (!state) {
		ctx.ui.notify(`No loop found: "${name}"`, "error");
		return;
	}

	if (!isPidAlive(state.pid)) {
		ctx.ui.notify(
			`Loop "${name}" process is already dead (PID ${state.pid}). Status: ${state.status}`,
			"info",
		);
		return;
	}

	// Send SIGTERM
	try {
		process.kill(state.pid, "SIGTERM");
		ctx.ui.notify(
			`☠️ Sent SIGTERM to loop "${name}" (PID ${state.pid}). Waiting for graceful shutdown...`,
			"info",
		);
	} catch (err) {
		ctx.ui.notify(
			`Failed to kill loop "${name}" (PID ${state.pid}): ${err}`,
			"error",
		);
	}
}

async function handleClean(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	_argsStr: string,
) {
	const loops = listLocalLoops(ctx.cwd);
	const cleanable = loops.filter((l) => {
		if (!l.state) return true; // No state = broken, clean it
		return (
			l.state.status === "completed" ||
			l.state.status === "stopped" ||
			(l.state.status === "error" && !isPidAlive(l.state.pid))
		);
	});

	if (cleanable.length === 0) {
		ctx.ui.notify("No loops to clean up", "info");
		return;
	}

	const names = cleanable.map((l) => l.name).join(", ");

	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm(
			"Clean loops?",
			`Remove ${cleanable.length} loop${cleanable.length > 1 ? "s" : ""}: ${names}`,
		);
		if (!ok) return;
	}

	let cleaned = 0;
	for (const loop of cleanable) {
		try {
			rmSync(loop.dir, { recursive: true, force: true });
			cleaned++;
		} catch {
			// ignore individual failures
		}
	}

	// Also prune registry
	pruneStaleRegistryEntries();

	ctx.ui.notify(
		`🧹 Cleaned ${cleaned} loop${cleaned > 1 ? "s" : ""}: ${names}`,
		"info",
	);
}

// ── Phase 0 Demo ───────────────────────────────────────────────────

const DEMO_PROMPTS = [
	"Create a file called hello.txt in the current directory containing exactly 'hello world'. Use the write tool.",
	"Read the file hello.txt in the current directory and tell me what's in it. Use the read tool.",
];

let demoRunning = false;

function runDemo(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
) {
	if (demoRunning) {
		ctx.ui.notify("Demo is already running", "warning");
		return;
	}

	demoRunning = true;

	const cwd = ctx.cwd;
	const ralphDir = join(cwd, ".ralph", "test");
	mkdirSync(ralphDir, { recursive: true });

	ctx.ui.setWidget("ralph", (tui, theme) => {
		const container = new Container();
		container.addChild(
			new Loader(
				tui,
				(s: string) => theme.fg("accent", s),
				(s: string) => theme.fg("muted", s),
				"Starting loop runner...",
			),
		);
		container.addChild(new Spacer(1));
		return container;
	});

	const rpc = spawn("pi", ["--mode", "rpc", "--no-session"], {
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const eventsStream = createWriteStream(join(ralphDir, "events.jsonl"), {
		flags: "w",
	});

	let cleanedUp = false;
	function cleanup() {
		if (cleanedUp) return;
		cleanedUp = true;
		demoRunning = false;
		eventsStream.end();
		ctx.ui.setWidget("ralph", undefined);
		ctx.ui.setStatus("ralph", undefined);
	}

	rpc.stderr!.resume();

	rpc.on("error", (err) => {
		ctx.ui.notify(`Failed to start pi RPC: ${err.message}`, "error");
		cleanup();
	});

	let agentEndCount = 0;
	let currentAssistantText = "";
	let iterationCount = 0;
	const pendingToolArgs = new Map<
		string,
		{ toolName: string; args: Record<string, unknown> }
	>();

	let iterStartTime = 0;
	let iterTokensIn = 0;
	let iterTokensOut = 0;
	let iterCost = 0;
	let iterTurns = 0;

	function resetIterStats() {
		iterStartTime = Date.now();
		iterTokensIn = 0;
		iterTokensOut = 0;
		iterCost = 0;
		iterTurns = 0;
	}

	function formatIterStats(): string {
		const secs = Math.round((Date.now() - iterStartTime) / 1000);
		const duration =
			secs >= 60
				? `${Math.floor(secs / 60)}m${secs % 60}s`
				: `${secs}s`;
		return `${duration} | ${iterTurns} turns | ${fmtTokens(iterTokensIn)} in ${fmtTokens(iterTokensOut)} out | $${iterCost.toFixed(3)}`;
	}

	function send(command: Record<string, unknown>) {
		rpc.stdin!.write(JSON.stringify(command) + "\n");
	}

	function handleEvent(event: Record<string, unknown>) {
		const eventType = event.type as string;

		if (eventType === "agent_start") {
			iterationCount++;
			currentAssistantText = "";
			resetIterStats();

			ctx.ui.setWidget("ralph", undefined);
			ctx.ui.setStatus(
				"ralph",
				ctx.ui.theme.fg(
					"accent",
					`ralph: test (${iterationCount}/2)`,
				),
			);

			pi.sendMessage({
				customType: "ralph_iteration",
				content: `Iteration ${iterationCount}`,
				display: true,
				details: { iteration: iterationCount, status: "start" },
			});
		} else if (eventType === "agent_end") {
			agentEndCount++;

			pi.sendMessage({
				customType: "ralph_iteration",
				content: formatIterStats(),
				display: true,
				details: { iteration: iterationCount, status: "end" },
			});

			if (agentEndCount === 1) {
				send({ type: "new_session" });
				send({ type: "prompt", message: DEMO_PROMPTS[1] });
			} else if (agentEndCount === 2) {
				ctx.ui.setStatus("ralph", undefined);
				rpc.kill("SIGTERM");
			}
		} else if (eventType === "tool_execution_start") {
			const toolCallId = event.toolCallId as string;
			pendingToolArgs.set(toolCallId, {
				toolName: event.toolName as string,
				args: (event.args ?? {}) as Record<string, unknown>,
			});
		} else if (eventType === "tool_execution_end") {
			const toolCallId = event.toolCallId as string;
			const pending = pendingToolArgs.get(toolCallId);
			pendingToolArgs.delete(toolCallId);

			pi.sendMessage({
				customType: "ralph_tool",
				content: event.toolName as string,
				display: true,
				details: {
					toolName: event.toolName as string,
					args: pending?.args ?? {},
					result: event.result,
					isError: event.isError as boolean,
					cwd,
				},
			});
		} else if (eventType === "message_update") {
			const ame = event.assistantMessageEvent as
				| Record<string, unknown>
				| undefined;
			if (ame?.type === "text_delta") {
				currentAssistantText += ame.delta as string;
			}
		} else if (eventType === "message_end") {
			const msg = event.message as
				| Record<string, unknown>
				| undefined;

			if (msg?.role === "assistant") {
				iterTurns++;
				const usage = msg.usage as
					| Record<string, unknown>
					| undefined;
				if (usage) {
					iterTokensIn += ((usage.input as number) ?? 0);
					iterTokensOut += ((usage.output as number) ?? 0);
					const cost = usage.cost as
						| Record<string, unknown>
						| undefined;
					if (cost) iterCost += ((cost.total as number) ?? 0);
				}
			}

			if (currentAssistantText.trim()) {
				pi.sendMessage({
					customType: "ralph_assistant",
					content: currentAssistantText.trim(),
					display: true,
					details: {},
				});
				currentAssistantText = "";
			}
		}
	}

	const rl = createInterface({ input: rpc.stdout! });

	rl.on("line", (line) => {
		if (cleanedUp) return;
		eventsStream.write(line + "\n");
		try {
			handleEvent(JSON.parse(line));
		} catch {
			// ignore parse errors
		}
	});

	rpc.on("exit", (code) => {
		if (agentEndCount < 2) {
			pi.sendMessage({
				customType: "ralph_status",
				content: `RPC process exited unexpectedly (code ${code})`,
				display: true,
				details: {},
			});
		}
		cleanup();
	});

	send({ type: "prompt", message: DEMO_PROMPTS[0] });
}
