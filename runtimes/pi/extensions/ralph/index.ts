/**
 * Ralph Loop Extension
 *
 * Drives iterative agent loops with fresh context per iteration.
 * Uses pi's native rendering — sendUserMessage + newSession + waitForIdle.
 * No RPC process, no custom event rendering. Just iteration borders + telemetry.
 *
 * Commands: /ralph start, stop, status, list, kill, clean
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
	CumulativeStats,
	IterationStats,
	LoopConfig,
	LoopState,
} from "./types.ts";
import { loopDir } from "./types.ts";

// ── TUI Components ─────────────────────────────────────────────────

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

// ── Formatting ─────────────────────────────────────────────────────

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

function fmtIterStats(stats: IterationStats): string {
	return `${fmtDuration(stats.durationMs)} │ ${stats.turns} turns │ ${fmtTokens(stats.tokensIn)} in ${fmtTokens(stats.tokensOut)} out │ ${fmtCost(stats.cost)}`;
}

// ── State Helpers ──────────────────────────────────────────────────

function readLoopState(dir: string): LoopState | null {
	try {
		return JSON.parse(
			readFileSync(join(dir, "state.json"), "utf-8"),
		) as LoopState;
	} catch {
		return null;
	}
}

function listLocalLoops(
	cwd: string,
): Array<{ name: string; dir: string; state: LoopState | null }> {
	const ralphRoot = join(cwd, ".ralph");
	if (!existsSync(ralphRoot)) return [];

	const results: Array<{
		name: string;
		dir: string;
		state: LoopState | null;
	}> = [];
	try {
		for (const entry of readdirSync(ralphRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = join(ralphRoot, entry.name);
			if (!existsSync(join(dir, "config.json"))) continue;
			results.push({ name: entry.name, dir, state: readLoopState(dir) });
		}
	} catch {}
	return results;
}

function writeState(dir: string, state: LoopState): void {
	const tmp = join(dir, "state.json.tmp");
	writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
	renameSync(tmp, join(dir, "state.json"));
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

	const result: ParsedStartArgs = { name: tokens[0], maxIterations: 50 };

	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(result.name)) {
		return `Invalid loop name "${result.name}". Use alphanumeric, dots, hyphens, underscores.`;
	}

	let i = 1;
	while (i < tokens.length) {
		const t = tokens[i];
		if ((t === "--max-iterations" || t === "-n") && i + 1 < tokens.length) {
			const val = parseInt(tokens[i + 1], 10);
			if (isNaN(val) || val < 0)
				return `Invalid max-iterations: "${tokens[i + 1]}"`;
			result.maxIterations = val;
			i += 2;
		} else if ((t === "--model" || t === "-m") && i + 1 < tokens.length) {
			result.model = tokens[i + 1];
			i += 2;
		} else if (t === "--provider" && i + 1 < tokens.length) {
			result.provider = tokens[i + 1];
			i += 2;
		} else if (t === "--thinking" && i + 1 < tokens.length) {
			result.thinking = tokens[i + 1];
			i += 2;
		} else if (t === "--task" && i + 1 < tokens.length) {
			result.taskFile = tokens[i + 1];
			i += 2;
		} else {
			return `Unknown option: "${t}"`;
		}
	}
	return result;
}

// ── Active Loop State ──────────────────────────────────────────────

let loopActive = false;
let stopRequested = false;
let currentIteration = 0;
let loopName = "";
let loopDirPath = "";

// Per-iteration telemetry (accumulated via event listeners)
let iterStartTime = 0;
let iterTokensIn = 0;
let iterTokensOut = 0;
let iterCacheRead = 0;
let iterCacheWrite = 0;
let iterCost = 0;
let iterTurns = 0;

// Cumulative stats
const cumulativeStats: CumulativeStats = {
	iterations: 0,
	durationMs: 0,
	turns: 0,
	tokensIn: 0,
	tokensOut: 0,
	cost: 0,
};

function resetIterStats(): void {
	iterStartTime = Date.now();
	iterTokensIn = 0;
	iterTokensOut = 0;
	iterCacheRead = 0;
	iterCacheWrite = 0;
	iterCost = 0;
	iterTurns = 0;
}

function resetCumulativeStats(): void {
	cumulativeStats.iterations = 0;
	cumulativeStats.durationMs = 0;
	cumulativeStats.turns = 0;
	cumulativeStats.tokensIn = 0;
	cumulativeStats.tokensOut = 0;
	cumulativeStats.cost = 0;
}

function collectIterationStats(): IterationStats {
	const durationMs = Date.now() - iterStartTime;
	const stats: IterationStats = {
		iteration: currentIteration,
		durationMs,
		turns: iterTurns,
		tokensIn: iterTokensIn,
		tokensOut: iterTokensOut,
		cacheRead: iterCacheRead,
		cacheWrite: iterCacheWrite,
		cost: iterCost,
		startedAt: new Date(iterStartTime).toISOString(),
		endedAt: new Date().toISOString(),
	};

	// Update cumulative
	cumulativeStats.iterations++;
	cumulativeStats.durationMs += durationMs;
	cumulativeStats.turns += iterTurns;
	cumulativeStats.tokensIn += iterTokensIn;
	cumulativeStats.tokensOut += iterTokensOut;
	cumulativeStats.cost += iterCost;

	return stats;
}

// ── Extension Entry Point ──────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Iteration Border Renderer ───────────────────────────────────

	pi.registerMessageRenderer(
		"ralph_iteration",
		(message, _options, theme) => {
			const color = (s: string) => theme.fg("borderMuted", s);
			return new LabeledBorder(String(message.content), color);
		},
	);

	// ── Telemetry via Events ────────────────────────────────────────

	pi.on("turn_end", async (event) => {
		if (!loopActive) return;
		iterTurns++;
		const msg = event.message as unknown as Record<string, unknown>;
		const usage = msg?.usage as Record<string, unknown> | undefined;
		if (usage) {
			iterTokensIn += (usage.input as number) ?? 0;
			iterTokensOut += (usage.output as number) ?? 0;
			iterCacheRead += (usage.cacheRead as number) ?? 0;
			iterCacheWrite += (usage.cacheWrite as number) ?? 0;
			const cost = usage.cost as Record<string, unknown> | undefined;
			if (cost) iterCost += (cost.total as number) ?? 0;
		}
	});

	// ── Widget ──────────────────────────────────────────────────────

	function updateWidget(ctx: ExtensionCommandContext, config: LoopConfig): void {
		const maxStr =
			config.maxIterations > 0
				? `/${config.maxIterations}`
				: "";
		const cost =
			cumulativeStats.cost > 0
				? ` │ ${fmtCost(cumulativeStats.cost)}`
				: "";
		const duration =
			cumulativeStats.durationMs > 0
				? ` │ ${fmtDuration(cumulativeStats.durationMs)}`
				: "";
		const line = `ralph: ${config.name} │ iter ${currentIteration}${maxStr}${duration}${cost}`;

		ctx.ui.setWidget("ralph", (_tui, theme) => ({
			render(width: number): string[] {
				return [theme.fg("accent", line)];
			},
			invalidate() {},
		}));
		ctx.ui.setStatus(
			"ralph",
			ctx.ui.theme.fg("accent", `ralph: ${config.name} (${currentIteration}${maxStr})`),
		);
	}

	function clearWidget(ctx: ExtensionCommandContext): void {
		ctx.ui.setWidget("ralph", undefined);
		ctx.ui.setStatus("ralph", undefined);
	}

	// ── Command Registration ────────────────────────────────────────

	pi.registerCommand("ralph", {
		description:
			"Ralph loop extension. Subcommands: start, stop, status, list, kill, clean",
		getArgumentCompletions: (prefix) => {
			const parts = prefix.split(/\s+/);
			if (parts.length <= 1) {
				const subs = ["start", "stop", "status", "list", "kill", "clean"];
				return subs
					.filter((s) => s.startsWith(parts[0] || ""))
					.map((s) => ({ value: s, label: s }));
			}
			if (["stop", "status", "kill"].includes(parts[0])) {
				const namePrefix = parts[1] || "";
				const loops = listLocalLoops(process.cwd());
				const names = loops
					.map((l) => l.name)
					.filter((n) => n.startsWith(namePrefix));
				if (loopActive && loopName.startsWith(namePrefix)) {
					if (!names.includes(loopName)) names.unshift(loopName);
				}
				return names.map((n) => ({
					value: `${parts[0]} ${n}`,
					label: n,
				}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const sub = parts[0] || "";
			const subArgs = parts.slice(1).join(" ");

			switch (sub) {
				case "start":
					return handleStart(pi, ctx, subArgs);
				case "stop":
					return handleStop(ctx, subArgs);
				case "status":
					return handleStatus(pi, ctx, subArgs);
				case "list":
					return handleList(pi, ctx);
				case "kill":
					return handleKill(ctx, subArgs);
				case "clean":
					return handleClean(ctx);
				default:
					ctx.ui.notify(
						"Usage: /ralph <start|stop|status|list|kill|clean> [args]",
						"info",
					);
			}
		},
	});

	// ── Loop ────────────────────────────────────────────────────────

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

		if (loopActive) {
			ctx.ui.notify(
				`Loop "${loopName}" is already running. /ralph stop first.`,
				"warning",
			);
			return;
		}

		const cwd = ctx.cwd;
		const dir = loopDir(cwd, parsed.name);

		// Create directory structure
		mkdirSync(join(dir, "iterations"), { recursive: true });

		// Handle task file
		const taskFilePath = join(dir, "task.md");
		if (parsed.taskFile) {
			const sourcePath = resolve(cwd, parsed.taskFile);
			if (!existsSync(sourcePath)) {
				ctx.ui.notify(`Task file not found: ${sourcePath}`, "error");
				return;
			}
			writeFileSync(taskFilePath, readFileSync(sourcePath, "utf-8"));
		} else if (!existsSync(taskFilePath)) {
			if (!ctx.hasUI) {
				ctx.ui.notify("No UI. Use --task to specify a task file.", "error");
				return;
			}
			const taskContent = await ctx.ui.editor(
				"Write the task for this loop:",
				"",
			);
			if (!taskContent?.trim()) {
				ctx.ui.notify("No task provided.", "warning");
				return;
			}
			writeFileSync(taskFilePath, taskContent);
		}

		// Build config
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
		writeFileSync(
			join(dir, "config.json"),
			JSON.stringify(config, null, 2) + "\n",
		);

		// Clear old iteration artifacts
		try {
			for (const f of readdirSync(join(dir, "iterations"))) {
				rmSync(join(dir, "iterations", f));
			}
		} catch {}

		// Initialize loop state
		loopActive = true;
		stopRequested = false;
		loopName = parsed.name;
		loopDirPath = dir;
		resetCumulativeStats();

		const startedAt = new Date();
		const maxStr =
			parsed.maxIterations === 0
				? "unlimited"
				: String(parsed.maxIterations);
		ctx.ui.notify(
			`Loop "${parsed.name}" started (max: ${maxStr} iterations)`,
			"info",
		);

		// ── Iteration Loop ──────────────────────────────────────────

		try {
			for (
				currentIteration = 1;
				config.maxIterations === 0 ||
				currentIteration <= config.maxIterations;
				currentIteration++
			) {
				if (stopRequested) break;

				resetIterStats();
				updateWidget(ctx, config);

				// Re-read task each iteration (agent may have updated it)
				const taskContent = readFileSync(taskFilePath, "utf-8").trim();

				// Fresh session for this iteration
				const { cancelled } = await ctx.newSession();

				if (cancelled || stopRequested) break;

				// Iteration header (in the new session, before agent starts)
				pi.sendMessage({
					customType: "ralph_iteration",
					content: `Iteration ${currentIteration}${config.maxIterations > 0 ? `/${config.maxIterations}` : ""}`,
					display: true,
					details: {},
				});

				// Trigger the agent — this sends the task as a user
				// message AND starts the agent loop (native rendering)
				pi.sendUserMessage(taskContent);

				// Wait for agent to finish (tool calls, text, everything)
				await ctx.waitForIdle();

				if (stopRequested) break;

				// Collect stats for this iteration
				const iterStats = collectIterationStats();

				// Write per-iteration stats
				writeFileSync(
					join(
						dir,
						"iterations",
						`${String(currentIteration).padStart(3, "0")}.json`,
					),
					JSON.stringify(iterStats, null, 2) + "\n",
				);

				// Iteration footer with stats
				pi.sendMessage({
					customType: "ralph_iteration",
					content: fmtIterStats(iterStats),
					display: true,
					details: {},
				});

				// Write loop state
				writeState(dir, {
					status: "running",
					config,
					iteration: currentIteration,
					stats: { ...cumulativeStats },
					startedAt: startedAt.toISOString(),
					updatedAt: new Date().toISOString(),
					pid: process.pid,
				});

				updateWidget(ctx, config);

				// Check stop conditions
				if (stopRequested) break;
				if (
					config.maxIterations > 0 &&
					currentIteration >= config.maxIterations
				)
					break;
			}

			// Final state
			const finalStatus = stopRequested ? "stopped" : "completed";
			writeState(dir, {
				status: finalStatus,
				config,
				iteration: currentIteration,
				stats: { ...cumulativeStats },
				startedAt: startedAt.toISOString(),
				updatedAt: new Date().toISOString(),
				pid: process.pid,
			});

			// Summary
			pi.sendMessage({
				customType: "ralph_iteration",
				content: `${finalStatus === "completed" ? "Completed" : "Stopped"} after ${cumulativeStats.iterations} iterations │ ${fmtDuration(cumulativeStats.durationMs)} │ ${fmtCost(cumulativeStats.cost)}`,
				display: true,
				details: {},
			});

			ctx.ui.notify(
				`Loop "${parsed.name}" ${finalStatus} (${cumulativeStats.iterations} iterations, ${fmtCost(cumulativeStats.cost)})`,
				"info",
			);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			writeState(dir, {
				status: "error",
				config,
				iteration: currentIteration,
				stats: { ...cumulativeStats },
				startedAt: startedAt.toISOString(),
				updatedAt: new Date().toISOString(),
				error: errorMsg,
				pid: process.pid,
			});
			ctx.ui.notify(`Loop "${parsed.name}" error: ${errorMsg}`, "error");
		} finally {
			loopActive = false;
			setTimeout(() => clearWidget(ctx), 3000);
		}
	}

	// ── Other Commands ──────────────────────────────────────────────

	function handleStop(ctx: ExtensionCommandContext, argsStr: string) {
		const name = argsStr.trim() || (loopActive ? loopName : "");
		if (!name) {
			ctx.ui.notify("No active loop. Usage: /ralph stop <name>", "error");
			return;
		}
		if (!loopActive || loopName !== name) {
			ctx.ui.notify(`No active loop named "${name}"`, "error");
			return;
		}
		stopRequested = true;
		ctx.ui.notify(
			`Stopping "${name}" after current iteration...`,
			"info",
		);
	}

	function handleKill(ctx: ExtensionCommandContext, argsStr: string) {
		const name = argsStr.trim() || (loopActive ? loopName : "");
		if (!name) {
			ctx.ui.notify("No active loop. Usage: /ralph kill <name>", "error");
			return;
		}
		if (!loopActive || loopName !== name) {
			ctx.ui.notify(`No active loop named "${name}"`, "error");
			return;
		}
		stopRequested = true;
		ctx.abort();
		ctx.ui.notify(`Killed "${name}"`, "info");
	}

	function handleStatus(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		argsStr: string,
	) {
		const name = argsStr.trim();
		if (!name) return handleList(pi, ctx);

		let state: LoopState | null = null;
		if (loopActive && loopName === name) {
			// Build live state
			state = {
				status: "running",
				config: JSON.parse(
					readFileSync(join(loopDirPath, "config.json"), "utf-8"),
				),
				iteration: currentIteration,
				stats: { ...cumulativeStats },
				startedAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				pid: process.pid,
			};
		} else {
			state = readLoopState(loopDir(ctx.cwd, name));
		}

		if (!state) {
			ctx.ui.notify(`No loop found: "${name}"`, "error");
			return;
		}

		const lines = [
			`**Loop: ${name}**`,
			"",
			"| Field | Value |",
			"|-------|-------|",
			`| Status | ${state.status} |`,
			`| Iteration | ${state.iteration}${state.config.maxIterations > 0 ? ` / ${state.config.maxIterations}` : ""} |`,
			`| Duration | ${fmtDuration(state.stats.durationMs)} |`,
			`| Cost | ${fmtCost(state.stats.cost)} |`,
			`| Tokens In | ${fmtTokens(state.stats.tokensIn)} |`,
			`| Tokens Out | ${fmtTokens(state.stats.tokensOut)} |`,
			`| Turns | ${state.stats.turns} |`,
		];
		if (state.error) lines.push(`| Error | ${state.error} |`);

		ctx.ui.notify(lines.join("\n"), "info");
	}

	function handleList(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
		const diskLoops = listLocalLoops(ctx.cwd);
		const entries: Array<{
			name: string;
			state: LoopState;
			active: boolean;
		}> = [];

		if (loopActive) {
			entries.push({
				name: loopName,
				state: {
					status: "running",
					config: JSON.parse(
						readFileSync(
							join(loopDirPath, "config.json"),
							"utf-8",
						),
					),
					iteration: currentIteration,
					stats: { ...cumulativeStats },
					startedAt: "",
					updatedAt: "",
					pid: process.pid,
				},
				active: true,
			});
		}

		for (const dl of diskLoops) {
			if (loopActive && dl.name === loopName) continue;
			if (!dl.state) continue;
			entries.push({ name: dl.name, state: dl.state, active: false });
		}

		if (entries.length === 0) {
			ctx.ui.notify(
				"No loops found. Use /ralph start <name> to create one.",
				"info",
			);
			return;
		}

		const lines = [
			"| Name | Status | Iteration | Duration | Cost |",
			"|------|--------|-----------|----------|------|",
		];

		for (const e of entries) {
			const s = e.state;
			const maxStr =
				s.config.maxIterations > 0
					? `/${s.config.maxIterations}`
					: "";
			const marker = e.active ? " ●" : "";
			lines.push(
				`| ${e.name}${marker} | ${s.status} | ${s.iteration}${maxStr} | ${fmtDuration(s.stats.durationMs)} | ${fmtCost(s.stats.cost)} |`,
			);
		}

		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function handleClean(ctx: ExtensionCommandContext) {
		const loops = listLocalLoops(ctx.cwd);
		const cleanable = loops.filter((l) => {
			if (loopActive && l.name === loopName) return false;
			if (!l.state) return true;
			return ["completed", "stopped", "error"].includes(l.state.status);
		});

		if (cleanable.length === 0) {
			ctx.ui.notify("No loops to clean up", "info");
			return;
		}

		const names = cleanable.map((l) => l.name).join(", ");
		if (ctx.hasUI) {
			const ok = await ctx.ui.confirm(
				"Clean loops?",
				`Remove: ${names}`,
			);
			if (!ok) return;
		}

		let cleaned = 0;
		for (const loop of cleanable) {
			try {
				rmSync(loop.dir, { recursive: true, force: true });
				cleaned++;
			} catch {}
		}
		ctx.ui.notify(`Cleaned ${cleaned} loop(s): ${names}`, "info");
	}
}
