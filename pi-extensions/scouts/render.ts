// TUI rendering for scout tool calls and results.
//
// Handles both single-scout and parallel-scout result display,
// including running-state previews, completed summaries, and error states.

import { getMarkdownTheme, keyHint } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import { cleanToolResult, formatToolCallParts, shorten } from "./display.ts";
import type { ScoutDetails } from "./types.ts";

// Render a scout tool call (the "calling..." state)
export function renderScoutCall(
  scoutName: string,
  args: Record<string, unknown> | undefined,
  theme: any,
  extraInfo?: string,
  context?: { expanded?: boolean },
): any {
  const query = typeof args?.query === "string" ? (args.query as string).trim() : "";
  const expanded = context?.expanded ?? false;
  const display = expanded ? query.replace(/\s+/g, " ").trim() : shorten(query.replace(/\s+/g, " ").trim(), 70);

  const title = theme.fg("toolTitle", theme.bold(scoutName));
  const info = extraInfo ? `\n${theme.fg("muted", extraInfo)} · ${theme.fg("muted", display)}` : "";
  const text = title + (display && !extraInfo ? `\n${theme.fg("muted", display)}` : info);
  return new Text(text, 0, 0);
}

// Render a single scout result
export function renderScoutResult(
  _scoutName: string,
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: any,
): any {
  const details = result.details as ScoutDetails | undefined;
  if (!details) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const { expanded, isPartial } = options;
  const status = isPartial ? "running" : details.status;
  const run = details.runs[0];
  const items = run?.displayItems ?? [];
  const toolCount = items.filter((i) => i.type === "tool").length;
  const totalTurns = run?.turns ?? 0;
  const elapsed = run ? formatDuration(Date.now() - run.startedAt) : "";

  const icon =
    status === "done"
      ? theme.fg("success", "✓")
      : status === "error"
        ? theme.fg("error", "✗")
        : status === "aborted"
          ? theme.fg("warning", "◼")
          : "";

  const stats = theme.fg(
    "dim",
    `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${totalTurns} turns • ${toolCount} tool${toolCount === 1 ? "" : "s"} • ${elapsed}`,
  );
  const header = icon ? `${icon} ${stats}` : stats;

  // Running state: compact fixed-height view with recent tool calls
  if (status === "running") {
    const c = new Container();
    c.addChild(new Text(header, 0, 0));

    const MAX_RUNNING_TOOLS = 5;
    const toolItems = items.filter((i): i is typeof items[0] & { type: "tool" } => i.type === "tool");
    const hiddenCount = Math.max(0, toolItems.length - MAX_RUNNING_TOOLS);

    if (hiddenCount > 0) {
      c.addChild(new Text(theme.fg("dim", `... ${hiddenCount} earlier tool call${hiddenCount > 1 ? "s" : ""}`), 0, 0));
    }
    for (const item of toolItems.slice(-MAX_RUNNING_TOOLS)) {
      const { label, summary } = formatToolCallParts(item.name, item.args);
      const itemIcon = item.isError ? theme.fg("error", "✗") : theme.fg("accent", "▸");
      c.addChild(
        new Text(`${itemIcon} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`, 0, 0),
      );
      if (expanded && item.result) {
        const cleaned = cleanToolResult(item.result);
        if (cleaned) {
          c.addChild(new Spacer(1));
          c.addChild(new Text(theme.fg("dim", cleaned), 2, 0));
          c.addChild(new Spacer(1));
        }
      }
    }

    return c;
  }

  // Completed/error/aborted: render items chronologically
  const c = new Container();
  c.addChild(new Text(header, 0, 0));

  if (status === "error" && run?.error) {
    c.addChild(new Spacer(1));
    c.addChild(new Text(theme.fg("error", `Error: ${run.error}`), 0, 0));
    return c;
  }

  // Render interleaved items: tool calls inline, final text as markdown
  let toolHeaderShown = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "tool") {
      if (!toolHeaderShown) {
        c.addChild(new Text(theme.fg("dim", "Tool calls"), 0, 0));
        toolHeaderShown = true;
      }
      const { label, summary } = formatToolCallParts(item.name, item.args);
      const itemIcon = item.isError ? theme.fg("error", "✗") : theme.fg("accent", "▸");
      c.addChild(
        new Text(`${itemIcon} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`, 0, 0),
      );
      if (expanded && item.result) {
        const cleaned = cleanToolResult(item.result);
        if (cleaned) {
          c.addChild(new Spacer(1));
          c.addChild(new Text(theme.fg("dim", cleaned), 2, 0));
          c.addChild(new Spacer(1));
        }
      }
    } else if (item.type === "text" && item.text.trim()) {
      const isLastText = !items.slice(i + 1).some((it) => it.type === "text" && it.text.trim());
      if (isLastText) {
        c.addChild(new Spacer(1));
        const mdTheme = getMarkdownTheme();
        if (expanded) {
          c.addChild(new Markdown(item.text, 0, 0, mdTheme));
        } else {
          const lines = item.text.trim().split("\n");
          const preview = lines.slice(0, 18).join("\n");
          c.addChild(new Markdown(preview, 0, 0, mdTheme));
          if (lines.length > 18) {
            c.addChild(new Text(theme.fg("dim", keyHint("app.tools.expand", "to expand")), 0, 0));
          }
        }
      } else {
        const preview = item.text.trim().split("\n")[0]!.slice(0, 120);
        c.addChild(new Text(theme.fg("dim", `${preview}${item.text.length > 120 ? "..." : ""}`), 0, 0));
      }
    }
  }

  return c;
}

// Render parallel scout results
export function renderParallelResult(
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: any,
): any {
  const details = result.details;
  if (!details || details.mode !== "parallel") {
    const text = result.content?.[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const { expanded, isPartial } = options;
  const parallelResults = details.results as Array<{
    scout: string;
    details: ScoutDetails;
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }>;

  const anyError = parallelResults.some((r) => r.details.status === "error");
  const anyRunning = isPartial || parallelResults.some((r) => r.details.status === "running");

  const statusIcon = anyRunning
    ? theme.fg("warning", "…")
    : anyError
      ? theme.fg("error", "✗")
      : theme.fg("success", "✓");

  const doneCount = parallelResults.filter((r) => r.details.status === "done").length;
  const total = parallelResults.length;

  const c = new Container();
  c.addChild(new Text(
    `${statusIcon} ${theme.fg("dim", `${doneCount}/${total} scouts completed`)}`,
    0, 0,
  ));

  for (const pr of parallelResults) {
    c.addChild(new Spacer(1));

    const scoutDetails = pr.details;
    const run = scoutDetails.runs?.[0];
    const status = pr.details.status;

    const scoutIcon =
      status === "done"
        ? theme.fg("success", "✓")
        : status === "error"
          ? theme.fg("error", "✗")
          : status === "running"
            ? theme.fg("warning", "…")
            : theme.fg("dim", "○");

    const scoutTitle = `${scoutIcon} ${theme.fg("toolTitle", theme.bold(pr.scout))}`;
    const stats = run
      ? theme.fg("dim", ` • ${run.turns} turns • ${run.displayItems.filter((i: any) => i.type === "tool").length} tools • ${formatDuration(Date.now() - run.startedAt)}`)
      : "";

    c.addChild(new Text(scoutTitle + stats, 0, 0));

    const fakeResult = { content: pr.content, details: scoutDetails };
    const scoutWidget = renderScoutResult(pr.scout, fakeResult, options, theme);

    if (scoutWidget instanceof Container) {
      const children = (scoutWidget as any).children;
      if (Array.isArray(children)) {
        // Skip the first child (header) since we rendered our own
        for (let i = 1; i < children.length; i++) {
          c.addChild(children[i]);
        }
      }
    }
  }

  return c;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
