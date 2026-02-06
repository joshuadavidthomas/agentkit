#!/usr/bin/env node
/**
 * Ralph Loop Runner — Standalone Process
 *
 * Manages the RPC iteration loop. Spawned detached by the extension,
 * survives the foreground pi session. Communicates via filesystem:
 * - events.jsonl (append-only event log)
 * - state.json (current loop state)
 * - inbox/ (command files from the extension)
 * - iterations/ (per-iteration stats)
 * - ~/.ralph/registry/ (global process registry)
 *
 * Usage: node loop-runner.js <ralph-dir>
 *   where <ralph-dir> is .ralph/<name>/ containing task.md and config
 */

import { spawn } from "node:child_process";
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type {
	CumulativeStats,
	InboxCommand,
	IterationStats,
	LoopConfig,
	LoopState,
	LoopStatus,
	RegistryEntry,
} from "./types.js";
import { registryDir, registryFilename } from "./types.js";

// ── Parse Args ─────────────────────────────────────────────────────

const ralphDir = process.argv[2];
if (!ralphDir) {
	process.stderr.write("Usage: loop-runner <ralph-dir>\n");
	process.exit(1);
}

const configPath = join(ralphDir, "config.json");
if (!existsSync(configPath)) {
	process.stderr.write(`Missing config: ${configPath}\n`);
	process.exit(1);
}

const config: LoopConfig = JSON.parse(readFileSync(configPath, "utf-8"));
const taskPath = join(ralphDir, config.taskFile);
if (!existsSync(taskPath)) {
	process.stderr.write(`Missing task file: ${taskPath}\n`);
	process.exit(1);
}

// ── Directories ────────────────────────────────────────────────────

const inboxDir = join(ralphDir, "inbox");
const iterationsDir = join(ralphDir, "iterations");
mkdirSync(inboxDir, { recursive: true });
mkdirSync(iterationsDir, { recursive: true });

// ── State Management ───────────────────────────────────────────────

const cumulativeStats: CumulativeStats = {
	iterations: 0,
	durationMs: 0,
	turns: 0,
	tokensIn: 0,
	tokensOut: 0,
	cost: 0,
};

let currentStatus: LoopStatus = "starting";
let currentIteration = 0;
let loopError: string | undefined;

function buildState(): LoopState {
	return {
		status: currentStatus,
		config,
		iteration: currentIteration,
		stats: { ...cumulativeStats },
		startedAt: startedAt.toISOString(),
		updatedAt: new Date().toISOString(),
		error: loopError,
		pid: process.pid,
	};
}

function writeState() {
	const statePath = join(ralphDir, "state.json");
	const tmp = statePath + ".tmp";
	writeFileSync(tmp, JSON.stringify(buildState(), null, 2) + "\n");
	renameSync(tmp, statePath);
}

// ── PID File ───────────────────────────────────────────────────────

const pidPath = join(ralphDir, "pid");
writeFileSync(pidPath, String(process.pid));

// ── Registry ───────────────────────────────────────────────────────

const regDir = registryDir();
mkdirSync(regDir, { recursive: true });
const regFile = join(regDir, registryFilename(config.cwd, config.name));

function writeRegistry() {
	const entry: RegistryEntry = {
		pid: process.pid,
		cwd: config.cwd,
		ralphDir,
		name: config.name,
		startedAt: startedAt.toISOString(),
		lastSeen: new Date().toISOString(),
		status: currentStatus,
		iteration: currentIteration,
		maxIterations: config.maxIterations,
		model: config.model,
		provider: config.provider,
	};
	const tmp = regFile + ".tmp";
	writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
	renameSync(tmp, regFile);
}

function removeRegistry() {
	try {
		unlinkSync(regFile);
	} catch {
		// Already gone
	}
}

// Heartbeat: update registry every 30s
const heartbeatInterval = setInterval(() => {
	writeRegistry();
}, 30_000);
heartbeatInterval.unref();

// ── Events Log ─────────────────────────────────────────────────────

const eventsPath = join(ralphDir, "events.jsonl");
const eventsStream = createWriteStream(eventsPath, { flags: "a" });

// ── Per-Iteration Tracking ─────────────────────────────────────────

let iterStartTime = 0;
let iterTokensIn = 0;
let iterTokensOut = 0;
let iterCacheRead = 0;
let iterCacheWrite = 0;
let iterCost = 0;
let iterTurns = 0;

function resetIterStats() {
	iterStartTime = Date.now();
	iterTokensIn = 0;
	iterTokensOut = 0;
	iterCacheRead = 0;
	iterCacheWrite = 0;
	iterCost = 0;
	iterTurns = 0;
}

function saveIterationStats() {
	const now = Date.now();
	const durationMs = now - iterStartTime;

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
		endedAt: new Date(now).toISOString(),
	};

	// Write per-iteration file
	const iterFile = join(
		iterationsDir,
		`${String(currentIteration).padStart(3, "0")}.json`,
	);
	writeFileSync(iterFile, JSON.stringify(stats, null, 2) + "\n");

	// Update cumulative
	cumulativeStats.iterations++;
	cumulativeStats.durationMs += durationMs;
	cumulativeStats.turns += iterTurns;
	cumulativeStats.tokensIn += iterTokensIn;
	cumulativeStats.tokensOut += iterTokensOut;
	cumulativeStats.cost += iterCost;
}

// ── Inbox Polling ──────────────────────────────────────────────────

let stopRequested = false;
let pendingFollowup: string | undefined;

function pollInbox(): InboxCommand | undefined {
	let files: string[];
	try {
		files = readdirSync(inboxDir).filter((f) => f.endsWith(".json"));
	} catch {
		return undefined;
	}

	// Process in priority order: stop > steer > followup
	const priority = ["stop.json", "steer.json", "followup.json"];
	files.sort(
		(a, b) =>
			(priority.indexOf(a) === -1 ? 99 : priority.indexOf(a)) -
			(priority.indexOf(b) === -1 ? 99 : priority.indexOf(b)),
	);

	for (const file of files) {
		const filePath = join(inboxDir, file);
		try {
			const content = readFileSync(filePath, "utf-8");
			unlinkSync(filePath);
			const parsed = JSON.parse(content);
			return parsed as InboxCommand;
		} catch {
			// Malformed or race condition, skip
			try {
				unlinkSync(filePath);
			} catch {
				// ignore
			}
		}
	}
	return undefined;
}

const inboxPollInterval = setInterval(() => {
	const cmd = pollInbox();
	if (!cmd) return;

	if (cmd.type === "stop") {
		stopRequested = true;
		// If we're between iterations, the loop will pick this up.
		// If mid-iteration, we'll stop after the current one finishes.
	} else if (cmd.type === "followup") {
		pendingFollowup = cmd.message;
	} else if (cmd.type === "steer") {
		// Forward steer to the RPC process
		if (rpcProcess?.stdin?.writable) {
			rpcSend({ type: "steer", message: cmd.message });
		}
	}
}, 500);
inboxPollInterval.unref();

// ── RPC Process ────────────────────────────────────────────────────

let rpcProcess: ReturnType<typeof spawn> | null = null;
const startedAt = new Date();

function rpcSend(command: Record<string, unknown>) {
	if (rpcProcess?.stdin?.writable) {
		rpcProcess.stdin.write(JSON.stringify(command) + "\n");
	}
}

function readTaskFile(): string {
	return readFileSync(taskPath, "utf-8").trim();
}

async function runLoop() {
	currentStatus = "running";
	writeState();
	writeRegistry();

	// Build RPC args
	const rpcArgs = ["--mode", "rpc", "--no-session"];
	if (config.model) {
		rpcArgs.push("--model", config.model);
	}
	if (config.provider) {
		rpcArgs.push("--provider", config.provider);
	}
	if (config.thinking) {
		rpcArgs.push("--thinking", config.thinking);
	}

	rpcProcess = spawn("pi", rpcArgs, {
		cwd: config.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});

	// Suppress stderr
	rpcProcess.stderr?.resume();

	rpcProcess.on("error", (err) => {
		loopError = `Failed to start pi RPC: ${err.message}`;
		currentStatus = "error";
		writeState();
		writeRegistry();
		shutdown(1);
	});

	// Read events from stdout
	const rl = createInterface({ input: rpcProcess.stdout! });

	let resolveAgentEnd: (() => void) | null = null;
	let rejectAgentEnd: ((err: Error) => void) | null = null;

	rpcProcess.on("exit", (code, signal) => {
		if (rejectAgentEnd) {
			rejectAgentEnd(
				new Error(`RPC process exited unexpectedly (code=${code}, signal=${signal})`),
			);
		}
	});

	rl.on("line", (line) => {
		// Write to event log
		eventsStream.write(line + "\n");

		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		const eventType = event.type as string;

		if (eventType === "message_end") {
			const msg = event.message as Record<string, unknown> | undefined;
			if (msg?.role === "assistant") {
				iterTurns++;
				const usage = msg.usage as Record<string, unknown> | undefined;
				if (usage) {
					iterTokensIn += ((usage.input as number) ?? 0);
					iterTokensOut += ((usage.output as number) ?? 0);
					iterCacheRead += ((usage.cacheRead as number) ?? 0);
					iterCacheWrite += ((usage.cacheWrite as number) ?? 0);
					const cost = usage.cost as Record<string, unknown> | undefined;
					if (cost) {
						iterCost += ((cost.total as number) ?? 0);
					}
				}
			}
		} else if (eventType === "agent_end") {
			if (resolveAgentEnd) resolveAgentEnd();
		}
	});

	// Wait for the RPC process to be ready, then iterate
	// The RPC process is ready when we can send prompts.
	// There's no explicit "ready" event, so we just start sending.

	for (
		currentIteration = 1;
		config.maxIterations === 0 || currentIteration <= config.maxIterations;
		currentIteration++
	) {
		if (stopRequested) break;

		resetIterStats();

		// Read task file fresh each iteration (agent may have updated it)
		const taskContent = readTaskFile();

		// Build the prompt
		let prompt: string;
		if (pendingFollowup) {
			prompt = pendingFollowup;
			pendingFollowup = undefined;
		} else {
			prompt = taskContent;
		}

		// Send prompt and wait for agent_end (or RPC crash)
		const agentEndPromise = new Promise<void>((resolve, reject) => {
			resolveAgentEnd = resolve;
			rejectAgentEnd = reject;
		});

		rpcSend({ type: "prompt", message: prompt });

		try {
			await agentEndPromise;
		} catch (err) {
			loopError = String(err instanceof Error ? err.message : err);
			currentStatus = "error";
			writeState();
			writeRegistry();
			shutdown(1);
			return;
		}
		resolveAgentEnd = null;
		rejectAgentEnd = null;

		// Save iteration stats
		saveIterationStats();
		writeState();
		writeRegistry();

		// Check for stop after iteration
		const cmd = pollInbox();
		if (cmd?.type === "stop") stopRequested = true;
		if (stopRequested) break;

		// Check max iterations
		if (
			config.maxIterations > 0 &&
			currentIteration >= config.maxIterations
		) {
			break;
		}

		// Reset session for next iteration
		rpcSend({ type: "new_session" });
	}

	// Done
	if (stopRequested) {
		currentStatus = "stopped";
	} else {
		currentStatus = "completed";
	}

	writeState();
	writeRegistry();

	// Kill RPC process
	if (rpcProcess && !rpcProcess.killed) {
		rpcProcess.kill("SIGTERM");
	}

	shutdown(0);
}

// ── Cleanup ────────────────────────────────────────────────────────

let shuttingDown = false;

function shutdown(code: number) {
	if (shuttingDown) return;
	shuttingDown = true;

	clearInterval(heartbeatInterval);
	clearInterval(inboxPollInterval);
	eventsStream.end();

	if (currentStatus === "running" || currentStatus === "starting") {
		currentStatus = "error";
		loopError = "Unexpected shutdown";
		writeState();
	}

	// Clean up PID file
	try {
		unlinkSync(pidPath);
	} catch {
		// ignore
	}

	// Remove registry on clean exit (stopped/completed)
	// Keep it on error so the extension can detect and report
	if (currentStatus === "stopped" || currentStatus === "completed") {
		removeRegistry();
	}

	if (rpcProcess && !rpcProcess.killed) {
		rpcProcess.kill("SIGTERM");
	}

	process.exit(code);
}

// ── Signal Handling ────────────────────────────────────────────────

process.on("SIGTERM", () => {
	stopRequested = true;
	// If we're mid-iteration, we'll finish it and then stop.
	// If we're between iterations, the loop check will catch it.
	// Give it a grace period, then force exit.
	setTimeout(() => shutdown(0), 10_000);
});

process.on("SIGINT", () => {
	stopRequested = true;
	setTimeout(() => shutdown(0), 10_000);
});

// ── Start ──────────────────────────────────────────────────────────

runLoop().catch((err) => {
	loopError = String(err);
	currentStatus = "error";
	writeState();
	shutdown(1);
});
