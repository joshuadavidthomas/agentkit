/**
 * Ralph Loop Engine
 *
 * Drives the RPC iteration loop in-process. Spawns `pi --mode rpc --no-session`
 * as a child process, manages iterations, tracks telemetry, writes filesystem
 * artifacts (state.json, events.jsonl, iterations/).
 *
 * The extension creates an instance on `/ralph start` and wires up callbacks
 * for TUI rendering. Later, this same engine can be used by a standalone
 * detached loop-runner for attach/detach mode.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
	createWriteStream,
	type WriteStream,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
	CumulativeStats,
	IterationStats,
	LoopConfig,
	LoopState,
	LoopStatus,
} from "./types.ts";

// ── Callbacks ──────────────────────────────────────────────────────

export interface LoopEngineCallbacks {
	/** Raw RPC event forwarded for TUI rendering */
	onEvent: (event: Record<string, unknown>) => void;
	/** Fired before the first prompt of each iteration */
	onIterationStart?: (iteration: number) => void;
	/** Fired after stats are collected for a completed iteration */
	onIterationEnd?: (iteration: number, stats: IterationStats) => void;
	/** Fired when loop status changes (running, stopped, completed, error) */
	onStatusChange?: (status: LoopStatus, error?: string) => void;
}

// ── Engine ─────────────────────────────────────────────────────────

export class LoopEngine {
	private rpc: ChildProcess | null = null;
	private status: LoopStatus = "starting";
	private iteration = 0;
	private startedAt = new Date();
	private error?: string;

	// Cumulative stats across all iterations
	private cumulativeStats: CumulativeStats = {
		iterations: 0,
		durationMs: 0,
		turns: 0,
		tokensIn: 0,
		tokensOut: 0,
		cost: 0,
	};

	// Per-iteration tracking (reset each iteration)
	private iterStartTime = 0;
	private iterTokensIn = 0;
	private iterTokensOut = 0;
	private iterCacheRead = 0;
	private iterCacheWrite = 0;
	private iterCost = 0;
	private iterTurns = 0;

	// Control flow
	private stopRequested = false;
	private pendingFollowup?: string;
	private resolveAgentEnd: (() => void) | null = null;
	private rejectAgentEnd: ((err: Error) => void) | null = null;
	private spawnError?: Error;

	// Filesystem / streams
	private eventsStream: WriteStream | null = null;
	private rl: ReturnType<typeof createInterface> | null = null;

	constructor(
		private ralphDir: string,
		private config: LoopConfig,
		private callbacks: LoopEngineCallbacks,
	) {}

	// ── Public API ──────────────────────────────────────────────────

	get currentStatus(): LoopStatus {
		return this.status;
	}

	get currentIteration(): number {
		return this.iteration;
	}

	getState(): LoopState {
		return {
			status: this.status,
			config: this.config,
			iteration: this.iteration,
			stats: { ...this.cumulativeStats },
			startedAt: this.startedAt.toISOString(),
			updatedAt: new Date().toISOString(),
			error: this.error,
			pid: this.rpc?.pid ?? 0,
		};
	}

	/**
	 * Start the loop. Runs iterations until max is reached, stop is requested,
	 * or an error occurs. Returns when the loop is finished.
	 */
	async start(): Promise<void> {
		// Ensure directories exist
		mkdirSync(join(this.ralphDir, "iterations"), { recursive: true });

		// Clear old artifacts for a fresh start
		this.clearArtifacts();

		// Open events log
		this.eventsStream = createWriteStream(
			join(this.ralphDir, "events.jsonl"),
			{ flags: "a" },
		);

		// Write config
		writeFileSync(
			join(this.ralphDir, "config.json"),
			JSON.stringify(this.config, null, 2) + "\n",
		);

		// Spawn RPC process
		const rpcArgs = ["--mode", "rpc", "--no-session"];
		if (this.config.model) rpcArgs.push("--model", this.config.model);
		if (this.config.provider)
			rpcArgs.push("--provider", this.config.provider);
		if (this.config.thinking)
			rpcArgs.push("--thinking", this.config.thinking);

		this.rpc = spawn("pi", rpcArgs, {
			cwd: this.config.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Drain stderr to prevent process blocking
		this.rpc.stderr?.resume();

		// Handle spawn failures
		this.rpc.on("error", (err) => {
			this.spawnError = err;
			this.error = `Failed to start pi RPC: ${err.message}`;
			this.setStatus("error");
			if (this.rejectAgentEnd) {
				this.rejectAgentEnd(new Error(this.error));
			}
		});

		// Handle unexpected exit mid-iteration
		this.rpc.on("exit", (code, signal) => {
			if (this.rejectAgentEnd) {
				this.rejectAgentEnd(
					new Error(
						`RPC process exited unexpectedly (code=${code}, signal=${signal})`,
					),
				);
			}
		});

		// Parse event stream
		this.rl = createInterface({ input: this.rpc.stdout! });
		this.rl.on("line", (line) => {
			this.eventsStream?.write(line + "\n");
			try {
				const event = JSON.parse(line);
				this.handleEvent(event);
			} catch {
				// ignore parse errors
			}
		});

		// Run the loop
		this.setStatus("running");
		this.writeState();

		try {
			await this.runIterations();
		} finally {
			this.cleanup();
		}
	}

	/** Signal the loop to stop after the current iteration completes. */
	stop(): void {
		this.stopRequested = true;
	}

	/** Force-kill the RPC process immediately. */
	kill(): void {
		this.stopRequested = true;
		if (this.rpc && !this.rpc.killed) {
			this.rpc.kill("SIGTERM");
		}
		this.setStatus("stopped");
		this.writeState();
	}

	/**
	 * Steer the RPC agent mid-iteration with a user message.
	 * Delivered after the current tool finishes. The message is wrapped
	 * with instructions to address the user's input and then continue
	 * with the original task.
	 */
	nudge(message: string): void {
		if (this.status === "running" && this.resolveAgentEnd) {
			const wrapped = [
				"The user has a message for you. Address it briefly, then continue with your original task where you left off.",
				"",
				`User: ${message}`,
			].join("\n");
			this.rpcSend({ type: "steer", message: wrapped });
		}
	}

	/** Queue a message as the next iteration's prompt (instead of task.md). */
	queueForNextIteration(message: string): void {
		this.pendingFollowup = message;
	}

	// ── Iteration Loop ──────────────────────────────────────────────

	private async runIterations(): Promise<void> {
		const taskPath = join(this.ralphDir, this.config.taskFile);

		// Brief yield to let spawn errors propagate before entering the loop
		await new Promise((r) => setTimeout(r, 50));
		if (this.spawnError) {
			return; // status already set to "error" by the error handler
		}

		for (
			this.iteration = 1;
			this.config.maxIterations === 0 ||
			this.iteration <= this.config.maxIterations;
			this.iteration++
		) {
			if (this.stopRequested) break;

			this.resetIterStats();
			this.callbacks.onIterationStart?.(this.iteration);

			// Re-read task each iteration — the agent may have updated it
			const taskContent = readFileSync(taskPath, "utf-8").trim();
			const prompt = this.pendingFollowup ?? taskContent;
			this.pendingFollowup = undefined;

			// Wait for agent to complete this iteration
			const agentEndPromise = new Promise<void>((resolve, reject) => {
				this.resolveAgentEnd = resolve;
				this.rejectAgentEnd = reject;
			});

			this.rpcSend({ type: "prompt", message: prompt });

			try {
				await agentEndPromise;
			} catch (err) {
				// If stop/kill was requested, the RPC exit is intentional
				if (this.stopRequested) break;

				this.error = String(
					err instanceof Error ? err.message : err,
				);
				this.setStatus("error");
				this.writeState();
				return;
			}

			this.resolveAgentEnd = null;
			this.rejectAgentEnd = null;

			// Collect and save stats for this iteration
			const iterStats = this.saveIterationStats();
			this.callbacks.onIterationEnd?.(this.iteration, iterStats);
			this.writeState();

			// Check stop conditions
			if (this.stopRequested) break;
			if (
				this.config.maxIterations > 0 &&
				this.iteration >= this.config.maxIterations
			)
				break;

			// Fresh context for next iteration
			this.rpcSend({ type: "new_session" });
		}

		this.setStatus(this.stopRequested ? "stopped" : "completed");
		this.writeState();
	}

	// ── Event Handling ──────────────────────────────────────────────

	private handleEvent(event: Record<string, unknown>): void {
		const eventType = event.type as string;

		// Forward to extension for rendering
		this.callbacks.onEvent(event);

		// Track telemetry from message_end events
		if (eventType === "message_end") {
			const msg = event.message as
				| Record<string, unknown>
				| undefined;
			if (msg?.role === "assistant") {
				this.iterTurns++;
				const usage = msg.usage as
					| Record<string, unknown>
					| undefined;
				if (usage) {
					this.iterTokensIn +=
						(usage.input as number) ?? 0;
					this.iterTokensOut +=
						(usage.output as number) ?? 0;
					this.iterCacheRead +=
						(usage.cacheRead as number) ?? 0;
					this.iterCacheWrite +=
						(usage.cacheWrite as number) ?? 0;
					const cost = usage.cost as
						| Record<string, unknown>
						| undefined;
					if (cost)
						this.iterCost +=
							(cost.total as number) ?? 0;
				}
			}
		}

		// Resolve iteration promise on agent_end
		if (eventType === "agent_end") {
			if (this.resolveAgentEnd) this.resolveAgentEnd();
		}
	}

	// ── Telemetry ───────────────────────────────────────────────────

	private resetIterStats(): void {
		this.iterStartTime = Date.now();
		this.iterTokensIn = 0;
		this.iterTokensOut = 0;
		this.iterCacheRead = 0;
		this.iterCacheWrite = 0;
		this.iterCost = 0;
		this.iterTurns = 0;
	}

	private saveIterationStats(): IterationStats {
		const now = Date.now();
		const durationMs = now - this.iterStartTime;

		const stats: IterationStats = {
			iteration: this.iteration,
			durationMs,
			turns: this.iterTurns,
			tokensIn: this.iterTokensIn,
			tokensOut: this.iterTokensOut,
			cacheRead: this.iterCacheRead,
			cacheWrite: this.iterCacheWrite,
			cost: this.iterCost,
			startedAt: new Date(this.iterStartTime).toISOString(),
			endedAt: new Date(now).toISOString(),
		};

		// Write per-iteration stats file
		const iterFile = join(
			this.ralphDir,
			"iterations",
			`${String(this.iteration).padStart(3, "0")}.json`,
		);
		writeFileSync(iterFile, JSON.stringify(stats, null, 2) + "\n");

		// Update cumulative stats
		this.cumulativeStats.iterations++;
		this.cumulativeStats.durationMs += durationMs;
		this.cumulativeStats.turns += this.iterTurns;
		this.cumulativeStats.tokensIn += this.iterTokensIn;
		this.cumulativeStats.tokensOut += this.iterTokensOut;
		this.cumulativeStats.cost += this.iterCost;

		return stats;
	}

	// ── Filesystem ──────────────────────────────────────────────────

	/** Atomic write: tmp file + rename to prevent partial reads */
	private writeState(): void {
		const statePath = join(this.ralphDir, "state.json");
		const tmp = statePath + ".tmp";
		writeFileSync(
			tmp,
			JSON.stringify(this.getState(), null, 2) + "\n",
		);
		renameSync(tmp, statePath);
	}

	/** Clear old artifacts for a fresh start */
	private clearArtifacts(): void {
		try {
			writeFileSync(join(this.ralphDir, "events.jsonl"), "");
		} catch {}
		try {
			unlinkSync(join(this.ralphDir, "state.json"));
		} catch {}
		try {
			for (const f of readdirSync(
				join(this.ralphDir, "iterations"),
			)) {
				unlinkSync(join(this.ralphDir, "iterations", f));
			}
		} catch {}
	}

	// ── Internal ────────────────────────────────────────────────────

	private rpcSend(command: Record<string, unknown>): void {
		if (this.rpc?.stdin?.writable) {
			this.rpc.stdin.write(JSON.stringify(command) + "\n");
		}
	}

	private setStatus(status: LoopStatus): void {
		this.status = status;
		this.callbacks.onStatusChange?.(status, this.error);
	}

	private cleanup(): void {
		this.rl?.close();
		this.rl = null;

		this.eventsStream?.end();
		this.eventsStream = null;

		if (this.rpc && !this.rpc.killed) {
			this.rpc.kill("SIGTERM");
		}
		this.rpc = null;
	}
}
