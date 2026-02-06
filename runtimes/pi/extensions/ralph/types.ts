/**
 * Ralph Loop — Shared Types
 *
 * Types shared between the loop runner (standalone process) and the
 * pi extension (foreground TUI).
 */

// ── Loop State ─────────────────────────────────────────────────────

export type LoopStatus =
	| "starting"
	| "running"
	| "stopping"
	| "stopped"
	| "completed"
	| "error";

export interface LoopConfig {
	/** Loop name */
	name: string;
	/** Working directory for the RPC process */
	cwd: string;
	/** Path to the task file */
	taskFile: string;
	/** Maximum iterations (0 = unlimited) */
	maxIterations: number;
	/** Model to use */
	model?: string;
	/** Provider to use */
	provider?: string;
	/** Thinking level */
	thinking?: string;
	/** Reflect every N iterations (0 = disabled) */
	reflectEvery: number;
}

export interface IterationStats {
	/** Iteration number (1-indexed) */
	iteration: number;
	/** Duration in milliseconds */
	durationMs: number;
	/** Number of assistant turns */
	turns: number;
	/** Input tokens */
	tokensIn: number;
	/** Output tokens */
	tokensOut: number;
	/** Cache read tokens */
	cacheRead: number;
	/** Cache write tokens */
	cacheWrite: number;
	/** Total cost in dollars */
	cost: number;
	/** ISO timestamp when iteration started */
	startedAt: string;
	/** ISO timestamp when iteration ended */
	endedAt: string;
}

export interface CumulativeStats {
	/** Total iterations completed */
	iterations: number;
	/** Total duration in milliseconds */
	durationMs: number;
	/** Total turns across all iterations */
	turns: number;
	/** Total input tokens */
	tokensIn: number;
	/** Total output tokens */
	tokensOut: number;
	/** Total cost in dollars */
	cost: number;
}

export interface LoopState {
	/** Loop status */
	status: LoopStatus;
	/** Loop configuration */
	config: LoopConfig;
	/** Current iteration (0 if not started) */
	iteration: number;
	/** Cumulative stats */
	stats: CumulativeStats;
	/** ISO timestamp when loop started */
	startedAt: string;
	/** ISO timestamp of last state update */
	updatedAt: string;
	/** Error message if status is "error" */
	error?: string;
	/** PID of the loop runner process */
	pid: number;
}

// ── Registry ───────────────────────────────────────────────────────

export interface RegistryEntry {
	/** PID of the loop runner process */
	pid: number;
	/** Working directory */
	cwd: string;
	/** Path to the .ralph/<name>/ directory */
	ralphDir: string;
	/** Loop name */
	name: string;
	/** ISO timestamp when loop started */
	startedAt: string;
	/** ISO timestamp of last heartbeat */
	lastSeen: string;
	/** Current status */
	status: LoopStatus;
	/** Current iteration */
	iteration: number;
	/** Max iterations configured */
	maxIterations: number;
	/** Model in use */
	model?: string;
	/** Provider in use */
	provider?: string;
}

// ── Inbox Commands ─────────────────────────────────────────────────

export interface SteerCommand {
	type: "steer";
	message: string;
}

export interface FollowupCommand {
	type: "followup";
	message: string;
}

export interface StopCommand {
	type: "stop";
}

export type InboxCommand = SteerCommand | FollowupCommand | StopCommand;

// ── Directory Layout Helpers ────────────────────────────────────────
//
// Pure functions, no side effects. Used by both the extension (loaded
// by pi's jiti) and the loop runner (needs its own runtime).

/** Get the ralph directory for a named loop */
export function loopDir(cwd: string, name: string): string {
	return `${cwd}/.ralph/${name}`;
}

/** Get the global registry directory */
export function registryDir(): string {
	const home = process.env.HOME ?? "";
	return `${home}/.ralph/registry`;
}

/** Slugify a path for registry filenames (mirrors pi's convention) */
export function slugifyPath(p: string): string {
	return p.replace(/\//g, "-").replace(/^-/, "");
}

/** Registry filename for a loop */
export function registryFilename(cwd: string, name: string): string {
	return `--${slugifyPath(cwd)}--${name}.json`;
}
