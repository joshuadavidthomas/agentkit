/**
 * Ralph Loop Extension — Phase 0 Tracer Bullet
 *
 * Provides `/ralph demo` command that:
 * 1. Spawns loop-runner.ts as a detached process
 * 2. Tails .ralph/test/events.jsonl
 * 3. Renders RPC events in the TUI using pi's native message rendering
 *
 * This proves we can watch a background loop's output from a foreground pi session.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import { watch, existsSync, statSync, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// This file's directory (where loop-runner.ts lives)
// jiti provides __dirname when loading extensions
const RALPH_EXT_DIR = __dirname;

export default function (pi: ExtensionAPI) {
	// ── Message Renderers ────────────────────────────────────────────────

	// Render iteration boundaries
	pi.registerMessageRenderer("ralph-iteration", (message, _options, theme) => {
		const details = message.details as {
			iteration: number;
			status: "start" | "end";
			prompt?: string;
		};
		const { iteration, status, prompt } = details;

		let text: string;
		if (status === "start") {
			text = theme.fg(
				"accent",
				theme.bold(`\n🔄 Ralph — Iteration ${iteration}`),
			);
			if (prompt) {
				text += "\n" + theme.fg("muted", `  Prompt: ${prompt}`);
			}
		} else {
			text = theme.fg("success", `✓ Iteration ${iteration} complete`);
		}

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(text!, 0, 0));
		return box;
	});

	// Render tool executions from the loop
	pi.registerMessageRenderer("ralph-tool", (message, { expanded }, theme) => {
		const details = message.details as {
			toolName: string;
			args: Record<string, unknown>;
			result?: { content?: Array<{ type: string; text?: string }>; details?: unknown };
			isError?: boolean;
		};

		const { toolName, args, result, isError } = details;

		// Tool call header
		let text = theme.fg("toolTitle", theme.bold(`  ${toolName} `));

		// Show args summary
		if (toolName === "bash" && args.command) {
			text += theme.fg("muted", String(args.command));
		} else if ((toolName === "read" || toolName === "write") && args.path) {
			text += theme.fg("muted", String(args.path));
		} else if (toolName === "edit" && args.path) {
			text += theme.fg("muted", String(args.path));
		} else {
			const argStr = Object.entries(args)
				.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
				.join(" ");
			if (argStr) text += theme.fg("dim", argStr);
		}

		// Result
		if (result) {
			const resultText = result.content
				?.filter((c) => c.type === "text" && c.text)
				.map((c) => c.text)
				.join("\n");

			if (resultText) {
				const statusIcon = isError
					? theme.fg("error", "✗")
					: theme.fg("success", "✓");
				text += `\n  ${statusIcon} `;

				if (expanded) {
					text += theme.fg("dim", resultText);
				} else {
					// Show first line, truncated
					const firstLine = resultText.split("\n")[0];
					const truncated =
						firstLine.length > 120
							? firstLine.slice(0, 120) + "…"
							: firstLine;
					text += theme.fg("dim", truncated);
					if (resultText.includes("\n")) {
						const lineCount = resultText.split("\n").length;
						text += theme.fg("dim", ` (+${lineCount - 1} more lines)`);
					}
				}
			}
		}

		const box = new Box(1, 0, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	// Render assistant text from the loop
	pi.registerMessageRenderer("ralph-assistant", (message, _options, theme) => {
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(String(message.content), 0, 0));
		return box;
	});

	// Render loop status messages
	pi.registerMessageRenderer("ralph-status", (message, _options, theme) => {
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		const text = theme.fg("accent", `🔄 ${message.content}`);
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	// ── /ralph demo Command ──────────────────────────────────────────────

	pi.registerCommand("ralph", {
		description: "Ralph loop extension. Usage: /ralph demo",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0];

			if (subcommand !== "demo") {
				ctx.ui.notify(
					"Usage: /ralph demo — Run the Phase 0 tracer bullet",
					"info",
				);
				return;
			}

			await runDemo(pi, ctx);
		},
	});
}

async function runDemo(
	pi: ExtensionAPI,
	ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext,
) {
	const cwd = ctx.cwd;
	const ralphDir = join(cwd, ".ralph", "test");
	const eventsFile = join(ralphDir, "events.jsonl");
	const loopRunnerScript = join(RALPH_EXT_DIR, "loop-runner.ts");

	// Ensure directory exists
	mkdirSync(ralphDir, { recursive: true });

	// Find bun binary — prefer mise shim
	const bunBin = (() => {
		const home = process.env.HOME ?? "";
		if (process.env.BUN_INSTALL) return join(process.env.BUN_INSTALL, "bin", "bun");
		const shim = join(home, ".local/share/mise/shims/bun");
		if (existsSync(shim)) return shim;
		return join(home, ".local/share/mise/installs/bun/1.3.6/bin/bun");
	})();

	ctx.ui.notify("Starting ralph loop runner...", "info");

	pi.sendMessage({
		customType: "ralph-status",
		content: "Starting loop runner (2 iterations)...",
		display: true,
		details: {},
	});

	// Spawn loop runner as a detached process
	console.log(`[ralph] Spawning loop runner: ${bunBin} run ${loopRunnerScript}`);

	const loopProcess = spawn(bunBin, ["run", loopRunnerScript], {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
		env: {
			...process.env,
			PI_BIN:
				process.env.PI_BIN ??
				join(
					process.env.HOME ?? "",
					".local/share/mise/shims/pi",
				),
		},
	});

	// Note: not calling loopProcess.unref() for Phase 0 demo — we want to
	// keep watching stdout/stderr. In later phases, detached loops will be
	// fully unref'd so the foreground pi can exit while the loop runs.

	// Log loop runner stderr
	if (loopProcess.stderr) {
		const stderrRl = createInterface({ input: loopProcess.stderr });
		stderrRl.on("line", (line) => {
			console.log(`[ralph:runner:stderr] ${line}`);
		});
	}

	// Log loop runner stdout (its own debug logging)
	if (loopProcess.stdout) {
		const stdoutRl = createInterface({ input: loopProcess.stdout });
		stdoutRl.on("line", (line) => {
			console.log(`[ralph:runner] ${line}`);
		});
	}

	loopProcess.on("error", (err) => {
		console.error(`[ralph] Loop runner failed to start:`, err);
		ctx.ui.notify(`Loop runner error: ${err.message}`, "error");
	});

	loopProcess.on("exit", (code) => {
		console.log(`[ralph] Loop runner exited with code ${code}`);
		if (code === 0) {
			pi.sendMessage({
				customType: "ralph-status",
				content: "Loop runner finished successfully! Both iterations complete.",
				display: true,
				details: {},
			});
		} else {
			pi.sendMessage({
				customType: "ralph-status",
				content: `Loop runner exited with code ${code}`,
				display: true,
				details: {},
			});
		}
		cleanup();
	});

	// Set up widget
	ctx.ui.setWidget("ralph", ["🔄 ralph: test │ waiting for events..."]);

	// ── Tail events.jsonl ──────────────────────────────────────────────

	let fileOffset = 0;
	let iterationCount = 0;
	let currentAssistantText = "";
	let watcher: ReturnType<typeof watch> | null = null;
	let pollInterval: ReturnType<typeof setInterval> | null = null;

	function cleanup() {
		if (watcher) {
			watcher.close();
			watcher = null;
		}
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
		ctx.ui.setWidget("ralph", undefined);
		ctx.ui.setStatus("ralph", undefined);
	}

	function processNewEvents() {
		if (!existsSync(eventsFile)) return;

		const stat = statSync(eventsFile);
		if (stat.size <= fileOffset) return;

		// Read new data from the offset
		const fd = openSync(eventsFile, "r");
		const buf = Buffer.alloc(stat.size - fileOffset);
		readSync(fd, buf, 0, buf.length, fileOffset);
		closeSync(fd);
		fileOffset = stat.size;

		const newData = buf.toString("utf-8");
		const lines = newData.split("\n").filter((l) => l.trim());

		for (const line of lines) {
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}
			handleEvent(event);
		}
	}

	function handleEvent(event: Record<string, unknown>) {
		const eventType = event.type as string;

		if (eventType === "agent_start") {
			iterationCount++;
			currentAssistantText = "";

			ctx.ui.setWidget("ralph", [
				`🔄 ralph: test │ iteration ${iterationCount}/2 │ running`,
			]);

			pi.sendMessage({
				customType: "ralph-iteration",
				content: `Iteration ${iterationCount}`,
				display: true,
				details: {
					iteration: iterationCount,
					status: "start",
				},
			});
		} else if (eventType === "agent_end") {
			ctx.ui.setWidget("ralph", [
				`🔄 ralph: test │ iteration ${iterationCount}/2 │ complete`,
			]);
		} else if (eventType === "tool_execution_end") {
			const toolName = event.toolName as string;
			const args = (event.args ?? {}) as Record<string, unknown>;
			const result = event.result as {
				content?: Array<{ type: string; text?: string }>;
				details?: unknown;
			} | undefined;
			const isError = event.isError as boolean;

			pi.sendMessage({
				customType: "ralph-tool",
				content: `${toolName}`,
				display: true,
				details: { toolName, args, result, isError },
			});
		} else if (eventType === "message_update") {
			const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (ame?.type === "text_delta") {
				currentAssistantText += ame.delta as string;
			}
		} else if (eventType === "message_end") {
			if (currentAssistantText.trim()) {
				pi.sendMessage({
					customType: "ralph-assistant",
					content: currentAssistantText.trim(),
					display: true,
					details: {},
				});
				currentAssistantText = "";
			}
		} else if (eventType === "response") {
			const cmd = event.command as string;
			if (cmd === "new_session") {
				pi.sendMessage({
					customType: "ralph-status",
					content: "Context reset — starting fresh iteration",
					display: true,
					details: {},
				});
			}
		}
	}

	// Poll for new events (more reliable than fs.watch for append-only files)
	pollInterval = setInterval(processNewEvents, 200);

	// Also use fs.watch as a fast-path trigger
	try {
		// Watch the directory since the file might not exist yet
		watcher = watch(ralphDir, (eventType, filename) => {
			if (filename === "events.jsonl") {
				processNewEvents();
			}
		});
	} catch {
		// fs.watch may not work on all platforms; polling is the fallback
	}
}
