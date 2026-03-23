/**
 * Ralph Loop — Shared types between loop engine and extension.
 */

export type LoopStatus =
	| "starting"
	| "running"
	| "stopped"
	| "completed"
	| "error";

export interface LoopConfig {
	name: string;
	cwd: string;
	/** Relative to the ralph dir */
	taskFile: string;
	/** 0 = unlimited */
	maxIterations: number;
	model?: string;
	provider?: string;
	thinking?: string;
	/** 0 = disabled */
	reflectEvery: number;
	/** Context between iterations. "fresh" = new session each time, "tree" = navigate back with summary */
	contextMode: "fresh" | "tree";
	/** Exit detection. false = disabled, true = built-in patterns, or custom pattern sets */
	exitDetection: boolean | ExitPatterns;
	/** Stop the loop if cumulative cost exceeds this amount in dollars. 0 = no limit */
	costCeiling: number;
}

export interface ExitPatterns {
	/** Phrases signaling the loop should exit (e.g., "no issues found") */
	exit: string[];
	/** Phrases signaling work was done — prevents premature exit when matched alongside exit phrases */
	continueWorking: string[];
}

export interface IterationStats {
	iteration: number;
	durationMs: number;
	turns: number;
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	startedAt: string;
	endedAt: string;
}

export interface CumulativeStats {
	iterations: number;
	durationMs: number;
	turns: number;
	tokensIn: number;
	tokensOut: number;
	cost: number;
}

export interface LoopState {
	status: LoopStatus;
	config: LoopConfig;
	iteration: number;
	stats: CumulativeStats;
	startedAt: string;
	updatedAt: string;
	error?: string;
	/** True if the loop exited because the agent signaled completion */
	exitDetected?: boolean;
	/** True if the loop stopped because cumulative cost exceeded the ceiling */
	costCeilingHit?: boolean;
}

/** Get the .ralph/<name>/ directory for a named loop in a project */
export function loopDir(cwd: string, name: string): string {
	return `${cwd}/.ralph/${name}`;
}
