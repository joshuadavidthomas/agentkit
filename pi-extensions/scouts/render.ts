// TUI rendering for scout tool calls and results.
//
// Handles both single-scout and parallel-scout result display,
// including running-state previews, completed summaries, and error states.

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getMarkdownTheme, keyHint, type Theme, type ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import { cleanToolResult, formatToolCallParts, shorten } from "./display.ts";
import type { DisplayItem, ParallelDetails, ScoutDetails } from "./types.ts";

type ScoutStatus = ScoutDetails["status"];
type ScoutRunDetails = ScoutDetails["runs"][number];
type ScoutToolResult = AgentToolResult<ScoutDetails>;
type ParallelScoutsToolResult = AgentToolResult<ParallelDetails>;

const SCOUT_STATUS_ICONS = {
  done: { color: "success", symbol: "✓" },
  error: { color: "error", symbol: "✗" },
  aborted: { color: "warning", symbol: "◼" },
  running: { color: "warning", symbol: "…" },
} as const satisfies Record<ScoutStatus, { color: string; symbol: string }>;

function scoutStatusIcon(theme: Theme, status: ScoutStatus): string {
  const icon = SCOUT_STATUS_ICONS[status];
  return theme.fg(icon.color, icon.symbol);
}

class ScoutToolRow implements Component {
  constructor(
    private readonly item: Extract<DisplayItem, { type: "tool" }>,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const c = new Container();
    const { label, summary } = formatToolCallParts(this.item.name, this.item.args);

    let itemStatus: ScoutStatus = "running";
    if (this.item.isError) {
      itemStatus = "error";
    } else if (this.item.result) {
      itemStatus = "done";
    }
    const itemIcon = scoutStatusIcon(this.theme, itemStatus);

    c.addChild(new Text(`${itemIcon} ${this.theme.fg("toolTitle", label)} ${this.theme.fg("dim", summary)}`, 0, 0));

    if (this.expanded && this.item.result) {
      const cleaned = cleanToolResult(this.item.result);
      if (cleaned) {
        c.addChild(new Spacer(1));
        c.addChild(new Text(this.theme.fg("dim", cleaned), 2, 0));
        c.addChild(new Spacer(1));
      }
    }

    return c.render(width);
  }
}

class ScoutTextBlock implements Component {
  constructor(
    private readonly item: Extract<DisplayItem, { type: "text" }>,
    private readonly isFinalText: boolean,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const text = this.item.text.trim();
    if (!text) return [];

    if (!this.isFinalText) {
      const firstLine = text.split("\n")[0]!;
      return new Text(this.theme.fg("dim", shorten(firstLine, 120)), 0, 0).render(width);
    }

    const c = new Container();
    c.addChild(new Spacer(1));

    const mdTheme = getMarkdownTheme();
    if (this.expanded) {
      c.addChild(new Markdown(this.item.text, 0, 0, mdTheme));
      return c.render(width);
    }

    const lines = text.split("\n");
    const preview = lines.slice(0, 18).join("\n");
    c.addChild(new Markdown(preview, 0, 0, mdTheme));
    if (lines.length > 18) {
      c.addChild(new Text(this.theme.fg("dim", keyHint("app.tools.expand", "to expand full response")), 0, 0));
    }

    return c.render(width);
  }
}

class ScoutResultHeader implements Component {
  constructor(
    private readonly details: ScoutDetails,
    private readonly status: ScoutStatus,
    private readonly run: ScoutRunDetails | undefined,
    private readonly isPartial: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const items = this.run?.displayItems ?? [];
    const toolCount = items.filter((item) => item.type === "tool").length;
    const totalTurns = this.run?.turns ?? 0;
    const elapsed = this.run
      ? formatElapsed(this.run.startedAt, this.run.endedAt, this.isPartial && this.status === "running")
      : "";

    const icon = this.status === "running" ? "" : scoutStatusIcon(this.theme, this.status);

    const stats = this.theme.fg(
      "dim",
      `${this.details.subagentProvider ?? "?"}/${this.details.subagentModelId ?? "?"} • ${totalTurns} turns • ${toolCount} tool${toolCount === 1 ? "" : "s"} • ${elapsed}`,
    );
    const text = icon ? `${icon} ${stats}` : stats;

    return new Text(text, 0, 0).render(width);
  }
}

class ScoutResultBody implements Component {
  constructor(
    private readonly status: ScoutStatus,
    private readonly run: ScoutRunDetails | undefined,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const items = this.run?.displayItems ?? [];
    const c = new Container();

    if (this.status === "running") {
      this.renderRunning(c, items);
    } else if (this.status === "error" && this.run?.error) {
      this.renderError(c);
    } else {
      this.renderCompleted(c, items);
    }

    return c.render(width);
  }

  private renderRunning(c: Container, items: DisplayItem[]): void {
    const MAX_RUNNING_TOOLS = 5;
    const toolItems: Array<Extract<DisplayItem, { type: "tool" }>> = [];
    for (const item of items) {
      if (item.type === "tool") toolItems.push(item);
    }
    const hiddenCount = Math.max(0, toolItems.length - MAX_RUNNING_TOOLS);

    if (hiddenCount > 0) {
      c.addChild(new Text(this.theme.fg("dim", `... ${hiddenCount} earlier tool call${hiddenCount > 1 ? "s" : ""}`), 0, 0));
    }

    for (const item of toolItems.slice(-MAX_RUNNING_TOOLS)) {
      c.addChild(new ScoutToolRow(item, this.expanded, this.theme));
    }

    if (!this.expanded && toolItems.length > 0) {
      c.addChild(new Text(this.theme.fg("dim", keyHint("app.tools.expand", "to expand tool details")), 0, 0));
    }
  }

  private renderError(c: Container): void {
    c.addChild(new Spacer(1));
    c.addChild(new Text(this.theme.fg("error", `Error: ${this.run!.error}`), 0, 0));
  }

  private renderCompleted(c: Container, items: DisplayItem[]): void {
    let toolHeaderShown = false;
    let toolCount = 0;
    let lastTextIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === "text" && item.text.trim()) {
        lastTextIndex = i;
        break;
      }
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === "tool") {
        if (!toolHeaderShown) {
          c.addChild(new Text(this.theme.fg("dim", "Tool calls"), 0, 0));
          toolHeaderShown = true;
        }
        toolCount += 1;
        c.addChild(new ScoutToolRow(item, this.expanded, this.theme));
        continue;
      }

      if (item.type === "text" && item.text.trim()) {
        c.addChild(new ScoutTextBlock(item, i === lastTextIndex, this.expanded, this.theme));
      }
    }

    if (!this.expanded && toolCount > 0) {
      c.addChild(new Text(this.theme.fg("dim", keyHint("app.tools.expand", "to expand tool details")), 0, 0));
    }
  }
}

export class ScoutResult implements Component {
  constructor(
    private readonly result: ScoutToolResult,
    private readonly options: ToolRenderResultOptions,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const details = this.result.details;
    const status = details.status;
    const run = details.runs[0];
    const c = new Container();

    c.addChild(new ScoutResultHeader(details, status, run, this.options.isPartial, this.theme));
    c.addChild(new ScoutResultBody(status, run, this.options.expanded, this.theme));

    return c.render(width);
  }
}

class ParallelScoutSection implements Component {
  constructor(
    private readonly result: ParallelDetails["results"][number],
    private readonly options: ToolRenderResultOptions,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const status = this.result.details.status;

    const icon = scoutStatusIcon(this.theme, status);
    let title = `${icon} ${this.theme.fg("toolTitle", this.theme.bold(this.result.scout))}`;

    const run = this.result.details.runs?.[0];
    if (run) {
      const toolCount = (run.displayItems ?? []).filter((item) => item.type === "tool").length;
      const duration = formatElapsed(
        run.startedAt,
        run.endedAt,
        this.options.isPartial && status === "running",
      );
      title += this.theme.fg("dim", ` • ${run.turns} turns • ${toolCount} tools • ${duration}`);
    }

    const c = new Container();
    c.addChild(new Text(title, 0, 0));
    c.addChild(new ScoutResultBody(status, run, this.options.expanded, this.theme));
    return c.render(width);
  }
}

export class ScoutCall implements Component {
  constructor(
    private readonly scoutName: string,
    private readonly args: Record<string, unknown> | undefined,
    private readonly theme: Theme,
    private readonly extraInfo?: string,
    private readonly context?: { expanded?: boolean },
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const query = typeof this.args?.query === "string" ? this.args.query.trim() : "";
    const normalizedQuery = query.replace(/\s+/g, " ").trim();
    const display = this.context?.expanded ? normalizedQuery : shorten(normalizedQuery, 70);

    const lines = [this.theme.fg("toolTitle", this.theme.bold(this.scoutName))];
    const detailParts: string[] = [];
    if (this.extraInfo) detailParts.push(this.theme.fg("muted", this.extraInfo));
    if (display) detailParts.push(this.theme.fg("muted", display));

    if (detailParts.length > 0) {
      lines.push(detailParts.join(" · "));
    }

    return new Text(lines.join("\n"), 0, 0).render(width);
  }
}

export class ParallelScoutsResult implements Component {
  constructor(
    private readonly result: ParallelScoutsToolResult,
    private readonly options: ToolRenderResultOptions,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const details = this.result.details;
    const parallelResults = details.results;

    let doneCount = 0;
    for (const result of parallelResults) {
      if (result.details.status === "done") {
        doneCount += 1;
      }
    }

    const icon = scoutStatusIcon(this.theme, details.status);

    const c = new Container();
    c.addChild(new Text(
      `${icon} ${this.theme.fg("dim", `${doneCount}/${parallelResults.length} scouts completed`)}`,
      0, 0,
    ));

    for (const pr of parallelResults) {
      c.addChild(new Spacer(1));
      c.addChild(new ParallelScoutSection(pr, this.options, this.theme));
    }

    return c.render(width);
  }
}

function formatElapsed(startedAt: number, endedAt: number | undefined, isLive: boolean): string {
  if (!isLive && endedAt === undefined) return "";
  return formatDuration((endedAt ?? Date.now()) - startedAt);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
