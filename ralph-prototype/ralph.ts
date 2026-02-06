/**
 * Ralph Loop Extension for pi
 *
 * Prints tool calls, assistant messages, and errors at each turn end.
 * Prints token usage and cost summary when the agent finishes.
 *
 * All output goes to stderr so loop.sh can suppress pi's stdout.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

const CWD = process.cwd();
const HOME = process.env.HOME || "";

function log(s: string): void {
  process.stderr.write(s + "\n");
}

function ts(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function truncate(s: string, max = 120): string {
  const clean = s.replace(/\n/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max) + "…";
}

function shortenPaths(s: string): string {
  return s.replaceAll(CWD, ".").replaceAll(HOME, "~");
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}k`;
  return n.toString();
}

export default function (pi: ExtensionAPI) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;
  let turnCount = 0;
  let startTime = Date.now();
  let lastAssistantText = "";

  pi.on("agent_start", async () => {
    startTime = Date.now();
    log(`\n${CYAN}${BOLD}[ralph ${ts()}]${RESET} ${CYAN}Agent started${RESET}`);
  });

  pi.on("turn_end", async (event) => {
    turnCount = (event.turnIndex ?? turnCount) + 1;

    if (event.message?.role !== "assistant") return;
    const msg = event.message as any;

    // Accumulate token usage
    if (msg.usage) {
      totalInput += msg.usage.input || 0;
      totalOutput += msg.usage.output || 0;
      totalCacheRead += msg.usage.cacheRead || 0;
      totalCacheWrite += msg.usage.cacheWrite || 0;
    }
    if (msg.usage?.cost) {
      totalCost += msg.usage.cost.total || 0;
    }

    // Track final turn text for printing in agent_end
    const isFinalTurn = msg.stopReason === "stop" || msg.stopReason === "length";

    // Walk content blocks in order — text and tool calls interleaved correctly
    for (const block of msg.content || []) {
      if (block.type === "thinking" && block.thinking?.trim()) {
        // Truncate thinking to first few lines to keep output manageable
        const lines = block.thinking.trim().split("\n");
        const preview = lines.slice(0, 5);
        for (const line of preview) {
          log(`${DIM}${ITALIC}${line}${RESET}`);
        }
        if (lines.length > 5) {
          log(`${DIM}${ITALIC}  ...${lines.length - 5} more lines${RESET}`);
        }
      } else if (block.type === "text" && block.text?.trim()) {
        if (isFinalTurn) {
          lastAssistantText = block.text.trim();
        } else {
          for (const line of block.text.trim().split("\n")) {
            log(`${GREEN}${line}${RESET}`);
          }
        }
      } else if (block.type === "toolCall") {
        const name = block.name;
        const args = block.arguments || {};
        let summary = "";

        if (name === "bash") {
          summary = truncate(shortenPaths(args.command || ""));
        } else if (name === "read") {
          const path = shortenPaths(args.path || "").split("/").slice(-2).join("/");
          const range = args.offset ? `:${args.offset}` : "";
          summary = `${path}${range}`;
        } else if (name === "write") {
          const path = shortenPaths(args.path || "").split("/").slice(-2).join("/");
          const lines = args.content?.split("\n").length ?? 0;
          summary = `${path} (${lines} lines)`;
        } else if (name === "edit") {
          const path = shortenPaths(args.path || "").split("/").slice(-2).join("/");
          summary = path;
        } else {
          summary = truncate(JSON.stringify(args));
        }

        log(`${YELLOW}  ▸ ${name}${RESET} ${DIM}${summary}${RESET}`);
      }
    }

    // Print tool errors from results
    const toolResults = (event as any).toolResults || [];
    for (const result of toolResults) {
      if (result.isError) {
        const text = (result.content || [])
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
        log(`${RED}  ✗ ${result.toolName}: ${truncate(shortenPaths(text), 200)}${RESET}`);
      }
    }
  });

  pi.on("agent_end", async () => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const minutes = Math.floor(Number(elapsed) / 60);
    const seconds = Number(elapsed) % 60;
    const duration = minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;

    log(`${CYAN}${BOLD}[ralph ${ts()}]${RESET} ${CYAN}Agent finished${RESET}`);

    // Print the final assistant message
    if (lastAssistantText) {
      log("");
      for (const line of lastAssistantText.split("\n")) {
        log(`${GREEN}${line}${RESET}`);
      }
    }

    // Write stats to file for loop.sh to print after
    const statsLine =
      `${MAGENTA}⏱ ${duration}${RESET}` +
      `  ${DIM}turns=${turnCount}${RESET}` +
      `  ${DIM}↑${fmtTokens(totalInput)} ↓${fmtTokens(totalOutput)}${RESET}` +
      `  ${DIM}cache: r=${fmtTokens(totalCacheRead)} w=${fmtTokens(totalCacheWrite)}${RESET}` +
      `  ${BOLD}$${totalCost.toFixed(3)}${RESET}`;

    const statsFile = `${process.cwd()}/.ralph-stats`;
    await import("fs").then(fs => fs.writeFileSync(statsFile, statsLine + "\n"));
  });
}
