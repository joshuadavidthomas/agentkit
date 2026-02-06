/**
 * Ralph Loop Extension — Phase 0 Tracer Bullet
 *
 * Provides `/ralph demo` command that:
 * 1. Spawns `pi --mode rpc --no-session` directly as a child process
 * 2. Sends two prompts with a `new_session` reset between them
 * 3. Writes all RPC events to `.ralph/test/events.jsonl`
 * 4. Renders RPC events using pi's built-in ToolExecutionComponent
 *    and AssistantMessageComponent for native-identical output
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  AssistantMessageComponent,
  getMarkdownTheme,
  ToolExecutionComponent,
} from "@mariozechner/pi-coding-agent";
import { Container, Loader, Spacer, TUI } from "@mariozechner/pi-tui";
import type { Component, Terminal } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Stub TUI for ToolExecutionComponent — it only calls ui.requestRender()
// for async image conversion, which is a no-op in our static context.
const stubTerminal: Terminal = {
  start() { },
  stop() { },
  write() { },
  get columns() { return process.stdout.columns ?? 120; },
  get rows() { return process.stdout.rows ?? 40; },
  get kittyProtocolActive() { return false; },
  moveBy() { },
  hideCursor() { },
  showCursor() { },
  clearLine() { },
  clearFromCursor() { },
  clearScreen() { },
  setTitle() { },
};
const stubTui = new TUI(stubTerminal);

const PROMPTS = [
  "Create a file called hello.txt in the current directory containing exactly 'hello world'. Use the write tool.",
  "Read the file hello.txt in the current directory and tell me what's in it. Use the read tool.",
];

class LabeledBorder implements Component {
  constructor(
    private label: string,
    private color: (s: string) => string,
  ) { }
  invalidate() { }
  render(width: number): string[] {
    const padded = ` ${this.label} `;
    const left = 3;
    const right = Math.max(1, width - left - padded.length);
    return [
      this.color("─".repeat(left) + padded + "─".repeat(right)),
    ];
  }
}

let demoRunning = false;

function renderAsAssistantMessage(text: string): AssistantMessageComponent {
  return new AssistantMessageComponent(
    {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "messages",
      provider: "anthropic",
      model: "unknown",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    },
    true,
    getMarkdownTheme(),
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("ralph_iteration", (message, _options, theme) => {
    const { status } = message.details as {
      iteration: number;
      status: "start" | "end";
    };
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
      toolName, args, { showImages: false }, undefined, stubTui, cwd,
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

  pi.registerCommand("ralph", {
    description: "Ralph loop extension. Usage: /ralph demo",
    handler: async (args, ctx) => {
      const subcommand = args.trim().split(/\s+/)[0];

      if (subcommand !== "demo") {
        ctx.ui.notify("Usage: /ralph demo", "info");
        return;
      }

      if (demoRunning) {
        ctx.ui.notify("Demo is already running", "warning");
        return;
      }

      runDemo(pi, ctx);
    },
  });
}

function runDemo(
  pi: ExtensionAPI,
  ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext,
) {
  demoRunning = true;

  const cwd = ctx.cwd;
  const ralphDir = join(cwd, ".ralph", "test");
  const eventsFile = join(ralphDir, "events.jsonl");

  mkdirSync(ralphDir, { recursive: true });

  ctx.ui.setWidget("ralph", (tui, theme) => {
    const container = new Container();
    container.addChild(new Loader(
      tui,
      (s: string) => theme.fg("accent", s),
      (s: string) => theme.fg("muted", s),
      "Starting loop runner...",
    ));
    container.addChild(new Spacer(1));
    return container;
  });

  const rpc = spawn("pi", ["--mode", "rpc", "--no-session"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const eventsStream = createWriteStream(eventsFile, { flags: "w" });

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

  // Track tool args from start events, keyed by toolCallId
  const pendingToolArgs = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  // Per-iteration stats
  let iterStartTime = 0;
  let iterTokensIn = 0;
  let iterTokensOut = 0;
  let iterCost = 0;
  let iterTurns = 0;

  // Cumulative stats
  let totalCost = 0;

  function resetIterStats() {
    iterStartTime = Date.now();
    iterTokensIn = 0;
    iterTokensOut = 0;
    iterCost = 0;
    iterTurns = 0;
  }

  function formatIterStats(): string {
    const elapsed = ((Date.now() - iterStartTime) / 1000).toFixed(0);
    const secs = Number(elapsed);
    const duration = secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
    return `${duration} | ${iterTurns} turns | ${fmtTokens(iterTokensIn)} in ${fmtTokens(iterTokensOut)} out | $${iterCost.toFixed(3)}`;
  }

  function fmtTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
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
        ctx.ui.theme.fg("accent", `ralph: test (${iterationCount}/2)`),
      );

      pi.sendMessage({
        customType: "ralph_iteration",
        content: `Iteration ${iterationCount}`,
        display: true,
        details: { iteration: iterationCount, status: "start" },
      });
    } else if (eventType === "agent_end") {
      agentEndCount++;

      totalCost += iterCost;

      pi.sendMessage({
        customType: "ralph_iteration",
        content: formatIterStats(),
        display: true,
        details: { iteration: iterationCount, status: "end" },
      });

      if (agentEndCount === 1) {
        send({ type: "new_session" });
        send({ type: "prompt", message: PROMPTS[1] });
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
      const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
      if (ame?.type === "text_delta") {
        currentAssistantText += ame.delta as string;
      }
    } else if (eventType === "message_end") {
      const msg = event.message as Record<string, unknown> | undefined;

      // Accumulate usage from assistant messages
      if (msg?.role === "assistant") {
        iterTurns++;
        const usage = msg.usage as Record<string, unknown> | undefined;
        if (usage) {
          iterTokensIn += (usage.input as number) ?? 0;
          iterTokensOut += (usage.output as number) ?? 0;
          const cost = usage.cost as Record<string, unknown> | undefined;
          if (cost) {
            iterCost += (cost.total as number) ?? 0;
          }
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
      // Ignore malformed lines
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

  send({ type: "prompt", message: PROMPTS[0] });
}
