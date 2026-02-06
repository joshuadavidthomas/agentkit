/**
 * Ralph Loop Runner — Phase 0 Tracer Bullet
 *
 * Standalone script that:
 * 1. Spawns `pi --mode rpc --no-session` as a child process
 * 2. Sends two prompts with a `new_session` reset between them
 * 3. Writes all RPC events to `.ralph/test/events.jsonl`
 *
 * This proves:
 * - The RPC iteration loop works
 * - `new_session` clears context (iteration 2 must re-read the file)
 * - Events are captured to a file
 *
 * Usage: bun run runtimes/pi/extensions/ralph/loop-runner.ts
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";

const RALPH_DIR = join(process.cwd(), ".ralph", "test");
const EVENTS_FILE = join(RALPH_DIR, "events.jsonl");

// Resolve pi binary — prefer mise shim, fall back to direct path
const PI_BIN =
	process.env.PI_BIN ??
	(() => {
		const home = process.env.HOME ?? "";
		const shim = join(home, ".local/share/mise/shims/pi");
		if (existsSync(shim)) return shim;
		return join(home, ".local/share/mise/installs/npm-mariozechner-pi-coding-agent/0.52.7/bin/pi");
	})();

const PROMPTS = [
	"Create a file called hello.txt in the current directory containing exactly 'hello world'. Use the write tool.",
	"Read the file hello.txt in the current directory and tell me what's in it. Use the read tool.",
];

async function main() {
	// Ensure output directory exists
	mkdirSync(RALPH_DIR, { recursive: true });

	// Clean up any prior events file
	const eventsStream = createWriteStream(EVENTS_FILE, { flags: "w" });

	console.log(`[ralph] Starting pi RPC process: ${PI_BIN}`);
	console.log(`[ralph] Events file: ${EVENTS_FILE}`);

	const rpc = spawn(PI_BIN, ["--mode", "rpc", "--no-session"], {
		stdio: ["pipe", "pipe", "pipe"],
		cwd: process.cwd(),
	});

	// Log stderr for debugging
	const stderrRl = createInterface({ input: rpc.stderr! });
	stderrRl.on("line", (line) => {
		console.error(`[ralph:rpc:stderr] ${line}`);
	});

	const rl = createInterface({ input: rpc.stdout! });

	let currentIteration = 0;
	let agentEndCount = 0;

	function send(command: Record<string, unknown>) {
		const json = JSON.stringify(command);
		console.log(`[ralph] → ${json}`);
		rpc.stdin!.write(json + "\n");
	}

	// Send first prompt
	console.log(`\n[ralph] ════════════════════════════════════════`);
	console.log(`[ralph] Starting iteration ${currentIteration + 1}: "${PROMPTS[currentIteration]}"`);
	console.log(`[ralph] ════════════════════════════════════════\n`);
	send({ type: "prompt", message: PROMPTS[currentIteration] });

	for await (const line of rl) {
		// Write every event to the events file
		eventsStream.write(line + "\n");

		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line);
		} catch {
			console.error(`[ralph] Failed to parse: ${line}`);
			continue;
		}

		const eventType = event.type as string;

		// Log interesting events
		if (eventType === "agent_start") {
			console.log(`[ralph] ▶ agent_start`);
		} else if (eventType === "agent_end") {
			agentEndCount++;
			console.log(`[ralph] ■ agent_end (iteration ${agentEndCount})`);

			if (agentEndCount === 1) {
				// First iteration done — reset context and send second prompt
				console.log(`[ralph] Sending new_session to reset context...`);
				send({ type: "new_session" });

				// Wait a beat for the session reset to complete, then send next prompt
				currentIteration++;
				console.log(`\n[ralph] ════════════════════════════════════════`);
				console.log(
					`[ralph] Starting iteration ${currentIteration + 1}: "${PROMPTS[currentIteration]}"`,
				);
				console.log(`[ralph] ════════════════════════════════════════\n`);
				send({ type: "prompt", message: PROMPTS[currentIteration] });
			} else if (agentEndCount === 2) {
				// Second iteration done — we're done
				console.log(`\n[ralph] ✓ Both iterations complete!`);
				console.log(`[ralph] Events written to: ${EVENTS_FILE}`);
				eventsStream.end();
				rpc.kill("SIGTERM");
				process.exit(0);
			}
		} else if (eventType === "tool_execution_start") {
			console.log(
				`[ralph]   🔧 tool_execution_start: ${event.toolName} ${JSON.stringify(event.args ?? {})}`,
			);
		} else if (eventType === "tool_execution_end") {
			const isError = event.isError as boolean;
			console.log(
				`[ralph]   🔧 tool_execution_end: ${event.toolName} ${isError ? "ERROR" : "OK"}`,
			);
		} else if (eventType === "message_update") {
			const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (ame?.type === "text_delta") {
				process.stdout.write(ame.delta as string);
			}
		} else if (eventType === "message_end") {
			console.log(`\n[ralph] 💬 message_end`);
		} else if (eventType === "response") {
			// Command responses (prompt ack, new_session ack, etc.)
			const cmd = event.command as string;
			const success = event.success as boolean;
			console.log(`[ralph] ← response: ${cmd} success=${success}`);

			if (cmd === "new_session" && success) {
				// new_session acknowledged — the next prompt is already queued
			}
		}
	}

	// If we reach here, the RPC process closed its stdout
	console.log(`[ralph] RPC process closed stdout`);
	eventsStream.end();
	process.exit(1);
}

main().catch((err) => {
	console.error(`[ralph] Fatal error:`, err);
	process.exit(1);
});
