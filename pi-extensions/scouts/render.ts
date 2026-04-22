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

function getResultText(result: { content?: Array<{ type?: string; text?: string }> } | undefined): string {
  const text = result?.content?.find((item) => item?.type === "text" && typeof item.text === "string");
  return text?.text ?? "(no output)";
}

function getScoutDetails(result: ScoutToolResult): ScoutDetails | undefined {
  return result.details;
}

function getParallelDetails(result: ParallelScoutsToolResult): ParallelDetails | undefined {
  return result.details;
}

class ScoutToolRow implements Component {
  constructor(
    private readonly item: Extract<DisplayItem, { type: "tool" }>,
    private readonly showResultDetails: boolean,
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

    if (this.showResultDetails && this.item.result) {
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
    private readonly run: ScoutRunDetails,
    private readonly isPartial: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const items = this.run.displayItems;
    const toolCount = items.filter((item) => item.type === "tool").length;
    const totalTurns = this.run.turns;
    const elapsed = formatElapsed(this.run.startedAt, this.run.endedAt, this.isPartial && this.status === "running");

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
    private readonly run: ScoutRunDetails,
    private readonly expanded: boolean,
    private readonly theme: Theme,
  ) { }

  invalidate(): void { }

  render(width: number): string[] {
    const items = this.run.displayItems;
    const c = new Container();

    if (this.status === "running") {
      this.renderRunning(c, items);
    } else if (this.status === "error" && this.run.error) {
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
    const toolItems = items.filter((item): item is Extract<DisplayItem, { type: "tool" }> => item.type === "tool");
    const textItems = items.filter((item): item is Extract<DisplayItem, { type: "text" }> => item.type === "text" && !!item.text.trim());
    const lastTextIndex = textItems.length - 1;

    if (toolItems.length > 0) {
      c.addChild(new Text(this.theme.fg("dim", "Tool calls"), 0, 0));
      for (const item of toolItems) {
        c.addChild(new ScoutToolRow(item, this.expanded, this.theme));
      }
      if (!this.expanded) {
        c.addChild(new Text(this.theme.fg("dim", keyHint("app.tools.expand", "to expand tool details")), 0, 0));
      }
    }

    for (let i = 0; i < textItems.length; i++) {
      c.addChild(new ScoutTextBlock(textItems[i]!, i === lastTextIndex, this.expanded, this.theme));
    }
  }
}

export class ScoutResult implements Component {
  private cachedBodyWidth?: number;
  private cachedBodyLines?: string[];
  private liveInterval?: ReturnType<typeof setInterval>;

  constructor(
    private result: ScoutToolResult,
    private options: ToolRenderResultOptions,
    private theme: Theme,
  ) { }

  update(result: ScoutToolResult, options: ToolRenderResultOptions, theme: Theme, invalidate?: () => void): void {
    this.result = result;
    this.options = options;
    this.theme = theme;
    this.syncLiveTimer(invalidate);
    this.invalidate();
  }

  invalidate(): void {
    this.cachedBodyWidth = undefined;
    this.cachedBodyLines = undefined;
  }

  private syncLiveTimer(invalidate?: () => void): void {
    const details = getScoutDetails(this.result);
    const shouldTick = this.options.isPartial && details?.status === "running";
    if (shouldTick && invalidate && !this.liveInterval) {
      this.liveInterval = setInterval(() => invalidate(), 500);
      return;
    }

    if (!shouldTick && this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = undefined;
    }
  }

  render(width: number): string[] {
    const details = getScoutDetails(this.result);
    const status = details?.status;
    const run = details?.runs?.[0];
    if (!details || !status || !run) {
      return new Text(getResultText(this.result), 0, 0).render(width);
    }
    const headerLines = new ScoutResultHeader(details, status, run, this.options.isPartial, this.theme).render(width);

    if (!this.cachedBodyLines || this.cachedBodyWidth !== width) {
      this.cachedBodyLines = new ScoutResultBody(status, run, this.options.expanded, this.theme).render(width);
      this.cachedBodyWidth = width;
    }

    return [...headerLines, ...this.cachedBodyLines];
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
  private cachedSectionBodies = new Map<number, { width: number; lines: string[] }>();
  private liveInterval?: ReturnType<typeof setInterval>;

  constructor(
    private result: ParallelScoutsToolResult,
    private options: ToolRenderResultOptions,
    private theme: Theme,
  ) { }

  update(result: ParallelScoutsToolResult, options: ToolRenderResultOptions, theme: Theme, invalidate?: () => void): void {
    this.result = result;
    this.options = options;
    this.theme = theme;
    this.syncLiveTimer(invalidate);
    this.invalidate();
  }

  invalidate(): void {
    this.cachedSectionBodies.clear();
  }

  private syncLiveTimer(invalidate?: () => void): void {
    const details = getParallelDetails(this.result);
    const shouldTick = this.options.isPartial && details?.status === "running";
    if (shouldTick && invalidate && !this.liveInterval) {
      this.liveInterval = setInterval(() => invalidate(), 500);
      return;
    }

    if (!shouldTick && this.liveInterval) {
      clearInterval(this.liveInterval);
      this.liveInterval = undefined;
    }
  }

  private renderSectionBody(index: number, result: ParallelDetails["results"][number], width: number): string[] {
    const cached = this.cachedSectionBodies.get(index);
    if (cached && cached.width === width) return cached.lines;

    const details = result.details;
    const run = details?.runs?.[0];
    const status = details?.status;
    const lines = run && status
      ? new ScoutResultBody(status, run, this.options.expanded, this.theme).render(width)
      : new Text(getResultText(result), 0, 0).render(width);
    this.cachedSectionBodies.set(index, { width, lines });
    return lines;
  }

  render(width: number): string[] {
    const details = getParallelDetails(this.result);
    if (!details) {
      return new Text(getResultText(this.result), 0, 0).render(width);
    }

    const parallelResults = details.results;

    let doneCount = 0;
    for (const result of parallelResults) {
      if (result.details?.status === "done") {
        doneCount += 1;
      }
    }

    const lines = new Text(
      `${scoutStatusIcon(this.theme, details.status)} ${this.theme.fg("dim", `${doneCount}/${parallelResults.length} scouts completed`)}`,
      0,
      0,
    ).render(width);

    for (let index = 0; index < parallelResults.length; index++) {
      const result = parallelResults[index]!;
      const status = result.details?.status;
      const run = result.details?.runs?.[0];
      const toolCount = (run?.displayItems ?? []).filter((item) => item.type === "tool").length;
      const duration = run && status
        ? formatElapsed(run.startedAt, run.endedAt, this.options.isPartial && status === "running")
        : "";
      const titleStatus = status ? scoutStatusIcon(this.theme, status) : this.theme.fg("muted", "?");
      const title = `${titleStatus} ${this.theme.fg("toolTitle", this.theme.bold(result.scout))}${run ? this.theme.fg("dim", ` • ${run.turns} turns • ${toolCount} tools • ${duration}`) : ""}`;

      lines.push("");
      lines.push(...new Text(title, 0, 0).render(width));
      lines.push(...this.renderSectionBody(index, result, width));
    }

    return lines;
  }
}

function formatElapsed(startedAt: number, endedAt: number | undefined, isLive: boolean): string {
  if (!isLive && endedAt === undefined) return "";
  return formatDuration((endedAt ?? Date.now()) - startedAt);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
