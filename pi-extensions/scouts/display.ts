// Display item extraction and formatting helpers.
//
// Shared between execute (which produces display items) and render
// (which consumes them).

import type { DisplayItem, ParallelDetails, ParallelScoutResult, ScoutRunDetails, ScoutStatus } from "./types.ts";

export const MAX_DISPLAY_ITEMS = 120;

// Compute overall status from individual runs
export function computeOverallStatus(runs: ScoutRunDetails[]): ScoutStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.every((r) => r.status === "aborted")) return "aborted";
  return "done";
}

export function buildParallelCombinedText(results: ParallelScoutResult[]): string {
  return results
    .map((r) => `[${r.scout}] ${r.content[0]?.text ?? "(no output)"}`)
    .join("\n\n");
}

export function buildParallelDetails(results: ParallelScoutResult[]): ParallelDetails {
  let status: ScoutStatus = "done";
  if (results.some((r) => r.details.status === "running")) {
    status = "running";
  } else if (results.some((r) => r.details.status === "error")) {
    status = "error";
  }

  return {
    mode: "parallel",
    status,
    results,
  };
}

// Extract the last assistant text block from session messages
export function getLastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;
    const blocks: string[] = [];
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string") blocks.push(part.text);
    }
    if (blocks.length > 0) return blocks.join("");
  }
  return "";
}

// Extract interleaved display items from session messages
export function extractDisplayItems(messages: any[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  const toolItemById = new Map<string, DisplayItem & { type: "tool" }>();

  for (const msg of messages) {
    if (msg?.role === "assistant") {
      const parts = msg.content;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
          items.push({ type: "text", text: part.text });
        } else if (part?.type === "toolCall" || part?.type === "tool_use") {
          const args = part.arguments ?? part.input ?? {};
          const id = part.id ?? part.toolCallId;
          const item: DisplayItem & { type: "tool" } = { type: "tool", name: part.name ?? "unknown", args, toolCallId: id };
          items.push(item);
          if (id) toolItemById.set(id, item);
        }
      }
    } else if (msg?.role === "toolResult" && msg.toolCallId) {
      const toolItem = toolItemById.get(msg.toolCallId);
      if (toolItem) {
        const text = extractToolResultText(msg);
        if (text) toolItem.result = text;
        if (msg.isError) toolItem.isError = true;
      }
    }
  }
  return items;
}

// Format a tool call for inline display
export function formatToolCallParts(name: string, args: Record<string, unknown>): { label: string; summary: string } {
  switch (name) {
    case "bash": {
      const cmd = shortenPaths(((args.command as string) || "").trim());
      const truncated = cmd.length > 100 ? cmd.slice(0, 97) + "..." : cmd;
      return { label: "bash", summary: truncated };
    }
    case "read": {
      const readPath = shortenPath((args.path || "") as string);
      const offset = args.offset ? `:${args.offset}` : "";
      const limit = args.limit ? `-${Number(args.offset ?? 1) + Number(args.limit) - 1}` : "";
      return { label: "read", summary: readPath + offset + limit };
    }
    default: {
      const previewKeys = ["command", "path", "pattern", "query", "url", "task"];
      for (const key of previewKeys) {
        if (args[key] && typeof args[key] === "string") {
          const val = shortenPaths(args[key] as string);
          return { label: name, summary: val.length > 80 ? val.slice(0, 77) + "..." : val };
        }
      }
      const s = JSON.stringify(args);
      return { label: name, summary: s.length > 60 ? s.slice(0, 57) + "..." : s };
    }
  }
}

// Shorten text for display
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// Clean tool result text for display (strip budget lines, truncate)
export function cleanToolResult(raw: string): string {
  const cleaned = raw.replace(/\n*\[turn budget\][^\n]*/g, "").trimEnd();
  const lines = cleaned.split("\n");
  return lines.length > 30 ? lines.slice(0, 30).join("\n") + `\n... (${lines.length - 30} more lines)` : cleaned;
}

// Path shortening utilities
function shortenPath(p: string): string {
  const cwd = process.cwd();
  if (cwd && p.startsWith(cwd + "/")) return "./" + p.slice(cwd.length + 1);
  if (p === cwd) return ".";
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

function shortenPaths(s: string): string {
  const cwd = process.cwd();
  const home = process.env.HOME || "";
  let result = s;
  if (cwd) result = result.replaceAll(cwd, ".");
  if (home) result = result.replaceAll(home, "~");
  return result;
}

// Extract text content from a tool result message
export function extractToolResultText(tr: any): string | undefined {
  if (typeof tr.content === "string") return tr.content;
  if (Array.isArray(tr.content)) {
    const texts = tr.content
      .filter((c: any) => c?.type === "text" && typeof c.text === "string")
      .map((c: any) => c.text);
    return texts.length > 0 ? texts.join("\n") : undefined;
  }
  return undefined;
}
