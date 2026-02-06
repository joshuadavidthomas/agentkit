/**
 * Ralph Loop — Shared types between loop runner and extension.
 */

export type LoopStatus =
	| "starting"
	| "running"
	| "stopping"
	| "stopped"
	| "completed"
	| "error";

export interface LoopConfig {
	name: string;
	cwd: string;
	taskFile: string;
	/** 0 = unlimited */
	maxIterations: number;
	model?: string;
	provider?: string;
	thinking?: string;
	/** 0 = disabled */
	reflectEvery: number;
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
	pid: number;
}

export interface RegistryEntry {
	pid: number;
	cwd: string;
	ralphDir: string;
	name: string;
	startedAt: string;
	lastSeen: string;
	status: LoopStatus;
	iteration: number;
	maxIterations: number;
	model?: string;
	provider?: string;
}

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

export function loopDir(cwd: string, name: string): string {
	return `${cwd}/.ralph/${name}`;
}

export function registryDir(): string {
	const home = process.env.HOME ?? "";
	return `${home}/.ralph/registry`;
}

/** Mirrors pi's session directory naming: slashes become dashes */
export function slugifyPath(p: string): string {
	return p.replace(/\//g, "-").replace(/^-/, "");
}

export function registryFilename(cwd: string, name: string): string {
	return `--${slugifyPath(cwd)}--${name}.json`;
}
