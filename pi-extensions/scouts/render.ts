// TUI rendering for scout tool calls and results.
//
// Uses persistent component trees so scout rows behave more like Pi's built-in
// tool renderers: stable header lines, localized body updates, and reusable
// child components instead of rebuilding cached string arrays on each update.

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getMarkdownTheme, keyHint, type Theme, type ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import { cleanToolResult, formatToolCallParts, shorten } from "./display.ts";
import type { DisplayItem, ScoutDetails } from "./types.ts";

type ScoutStatus = ScoutDetails["status"];
type ScoutRunDetails = ScoutDetails["runs"][number];
type ScoutToolResult = AgentToolResult<ScoutDetails>;

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

const RUNNING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const RUNNING_SPINNER_INTERVAL_MS = 80;

function getRunningSpinner(theme: Theme, frameIndex = 0): string {
  const frame = RUNNING_SPINNER_FRAMES[frameIndex % RUNNING_SPINNER_FRAMES.length] ?? RUNNING_SPINNER_FRAMES[0]!;
  return theme.fg("warning", frame);
}

function getRunningStatusLabel(run: ScoutRunDetails, hasToolCalls: boolean): string {
  if (run.activityPhase === "writing_summary") {
    return "writing summary";
  }

  if (run.activityPhase === "calling_tools" || hasToolCalls) {
    return "calling tools";
  }

  return "thinking";
}

class RunningStatusText extends Text {
  private frameIndex = 0;
  private timer?: ReturnType<typeof setInterval>;
  private theme?: Theme;
  private run?: ScoutRunDetails;
  private hasToolCalls = false;
  private requestRender?: () => void;

  constructor() {
    super("", 0, 0);
  }

  update(run: ScoutRunDetails, hasToolCalls: boolean, theme: Theme, requestRender?: () => void): void {
    this.run = run;
    this.hasToolCalls = hasToolCalls;
    this.theme = theme;
    this.requestRender = requestRender;
    this.updateDisplay();
    this.syncTimer();
  }

  override invalidate(): void {
    super.invalidate();
    this.updateDisplay();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private syncTimer(): void {
    if (!this.requestRender) {
      this.stop();
      return;
    }

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % RUNNING_SPINNER_FRAMES.length;
        this.updateDisplay();
        this.requestRender?.();
      }, RUNNING_SPINNER_INTERVAL_MS);
    }
  }

  private updateDisplay(): void {
    if (!this.run || !this.theme) return;
    this.setText(`${getRunningSpinner(this.theme, this.frameIndex)} ${this.theme.fg("dim", getRunningStatusLabel(this.run, this.hasToolCalls))}`);
  }
}

class ScoutToolRowComponent extends Container {
  private titleText = new Text("", 0, 0);
  private topSpacer = new Spacer(1);
  private detailText = new Text("", 2, 0);
  private bottomSpacer = new Spacer(1);
  private showingDetails = false;

  constructor() {
    super();
    this.addChild(this.titleText);
  }

  update(item: Extract<DisplayItem, { type: "tool" }>, showResultDetails: boolean, theme: Theme): void {
    const { label, summary } = formatToolCallParts(item.name, item.args);

    let itemStatus: ScoutStatus = "running";
    if (item.isError) {
      itemStatus = "error";
    } else if (item.result) {
      itemStatus = "done";
    }

    const itemIcon = scoutStatusIcon(theme, itemStatus);
    this.titleText.setText(`${itemIcon} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`);

    const cleaned = showResultDetails && item.result
      ? cleanToolResult(item.result)
      : "";

    if (cleaned) {
      this.detailText.setText(theme.fg("dim", cleaned));
      if (!this.showingDetails) {
        this.addChild(this.topSpacer);
        this.addChild(this.detailText);
        this.addChild(this.bottomSpacer);
        this.showingDetails = true;
      }
      return;
    }

    if (this.showingDetails) {
      this.removeChild(this.topSpacer);
      this.removeChild(this.detailText);
      this.removeChild(this.bottomSpacer);
      this.showingDetails = false;
    }
  }
}

class ScoutToolListComponent extends Container {
  private rows = new Map<string, ScoutToolRowComponent>();

  update(items: Array<Extract<DisplayItem, { type: "tool" }>>, expanded: boolean, theme: Theme): void {
    const nextKeys: string[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const key = item.toolCallId ?? `${index}:${item.name}:${JSON.stringify(item.args)}`;
      let row = this.rows.get(key);
      if (!row) {
        row = new ScoutToolRowComponent();
        this.rows.set(key, row);
      }
      row.update(item, expanded, theme);
      nextKeys.push(key);
    }

    for (const key of [...this.rows.keys()]) {
      if (!nextKeys.includes(key)) {
        this.rows.delete(key);
      }
    }

    this.clear();
    for (const key of nextKeys) {
      const row = this.rows.get(key);
      if (row) this.addChild(row);
    }
  }
}

class ScoutTextBlockComponent extends Container {
  update(
    item: Extract<DisplayItem, { type: "text" }>,
    isFinalText: boolean,
    expanded: boolean,
    theme: Theme,
  ): void {
    this.clear();

    const text = item.text.trim();
    if (!text) return;

    if (!isFinalText) {
      const firstLine = text.split("\n")[0]!;
      this.addChild(new Text(theme.fg("dim", shorten(firstLine, 120)), 0, 0));
      return;
    }

    this.addChild(new Spacer(1));

    const mdTheme = getMarkdownTheme();
    if (expanded) {
      this.addChild(new Markdown(item.text, 0, 0, mdTheme));
      return;
    }

    const lines = text.split("\n");
    const preview = lines.slice(0, 18).join("\n");
    this.addChild(new Markdown(preview, 0, 0, mdTheme));
    if (lines.length > 18) {
      this.addChild(new Text(theme.fg("dim", keyHint("app.tools.expand", "to expand full response")), 0, 0));
    }
  }
}

class ScoutTextListComponent extends Container {
  private blocks: ScoutTextBlockComponent[] = [];

  update(items: Array<Extract<DisplayItem, { type: "text" }>>, expanded: boolean, theme: Theme): void {
    while (this.blocks.length < items.length) {
      this.blocks.push(new ScoutTextBlockComponent());
    }
    if (this.blocks.length > items.length) {
      this.blocks.length = items.length;
    }

    this.clear();
    const lastIndex = items.length - 1;
    for (let index = 0; index < items.length; index++) {
      const block = this.blocks[index]!;
      block.update(items[index]!, index === lastIndex, expanded, theme);
      this.addChild(block);
    }
  }
}

class ScoutResultHeaderComponent extends Text {
  constructor() {
    super("", 0, 0);
  }

  update(details: ScoutDetails, status: ScoutStatus, run: ScoutRunDetails, theme: Theme): void {
    const items = run.displayItems;
    const toolCount = items.filter((item) => item.type === "tool").length;
    const totalTurns = run.turns;
    const elapsed = formatElapsed(run.startedAt, run.endedAt, status === "running");
    const icon = status === "running" ? "" : scoutStatusIcon(theme, status);
    const stats = theme.fg(
      "dim",
      `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${totalTurns} turns • ${toolCount} tool${toolCount === 1 ? "" : "s"} • ${elapsed}`,
    );

    this.setText(icon ? `${icon} ${stats}` : stats);
  }
}

class ScoutResultBodyComponent extends Container {
  private runningStatusText = new RunningStatusText();
  private hiddenCountText = new Text("", 0, 0);
  private sectionLabelText = new Text("", 0, 0);
  private expandHintText = new Text("", 0, 0);
  private errorSpacer = new Spacer(1);
  private errorText = new Text("", 0, 0);
  private toolList = new ScoutToolListComponent();
  private textList = new ScoutTextListComponent();

  stop(): void {
    this.runningStatusText.stop();
  }

  update(status: ScoutStatus, run: ScoutRunDetails, expanded: boolean, theme: Theme, requestRender?: () => void): void {
    this.clear();

    const toolItems = run.displayItems.filter((item): item is Extract<DisplayItem, { type: "tool" }> => item.type === "tool");
    const textItems = run.displayItems.filter((item): item is Extract<DisplayItem, { type: "text" }> => item.type === "text" && !!item.text.trim());

    if (status === "running") {
      this.runningStatusText.update(run, toolItems.length > 0, theme, requestRender);
      this.addChild(this.runningStatusText);

      if (toolItems.length > 0) {
        const maxRunningTools = 5;
        const hiddenCount = Math.max(0, toolItems.length - maxRunningTools);
        if (hiddenCount > 0) {
          this.hiddenCountText.setText(theme.fg("dim", `... ${hiddenCount} earlier tool call${hiddenCount > 1 ? "s" : ""}`));
          this.addChild(this.hiddenCountText);
        }
        this.toolList.update(toolItems.slice(-maxRunningTools), expanded, theme);
        this.addChild(this.toolList);
        if (!expanded) {
          this.expandHintText.setText(theme.fg("dim", keyHint("app.tools.expand", "to expand tool details")));
          this.addChild(this.expandHintText);
        }
      }
      return;
    }

    this.runningStatusText.stop();

    if (status === "error" && run.error) {
      this.errorText.setText(theme.fg("error", `Error: ${run.error}`));
      this.addChild(this.errorSpacer);
      this.addChild(this.errorText);
      return;
    }

    if (toolItems.length > 0) {
      this.sectionLabelText.setText(theme.fg("dim", "Tool calls"));
      this.addChild(this.sectionLabelText);
      this.toolList.update(toolItems, expanded, theme);
      this.addChild(this.toolList);
      if (!expanded) {
        this.expandHintText.setText(theme.fg("dim", keyHint("app.tools.expand", "to expand tool details")));
        this.addChild(this.expandHintText);
      }
    }

    this.textList.update(textItems, expanded, theme);
    this.addChild(this.textList);
  }
}

class ScoutDetailsComponent extends Container {
  private header = new ScoutResultHeaderComponent();
  private body = new ScoutResultBodyComponent();

  constructor() {
    super();
    this.addChild(this.header);
    this.addChild(this.body);
  }

  stop(): void {
    this.body.stop();
  }

  update(
    details: ScoutDetails,
    status: ScoutStatus,
    run: ScoutRunDetails,
    options: ToolRenderResultOptions,
    theme: Theme,
    requestRender?: () => void,
  ): void {
    this.header.update(details, status, run, theme);
    this.body.update(status, run, options.expanded, theme, requestRender);
  }
}

export class ScoutResult extends Container {
  private fallback = new Text("", 0, 0);
  private detailsComponent = new ScoutDetailsComponent();
  private showingFallback = false;

  constructor(
    private result: ScoutToolResult,
    private options: ToolRenderResultOptions,
    private theme: Theme,
  ) {
    super();
    this.addChild(this.detailsComponent);
    this.update(result, options, theme);
  }

  update(result: ScoutToolResult, options: ToolRenderResultOptions, theme: Theme, invalidate?: () => void): void {
    this.result = result;
    this.options = options;
    this.theme = theme;

    const details = getScoutDetails(this.result);
    const status = details?.status;
    const run = details?.runs?.[0];

    if (!details || !status || !run) {
      this.detailsComponent.stop();
      this.fallback.setText(getResultText(this.result));
      if (!this.showingFallback) {
        this.clear();
        this.addChild(this.fallback);
        this.showingFallback = true;
      }
      return;
    }

    this.detailsComponent.update(details, status, run, this.options, this.theme, invalidate);
    if (this.showingFallback) {
      this.clear();
      this.addChild(this.detailsComponent);
      this.showingFallback = false;
    }
  }

  override invalidate(): void {
    super.invalidate();
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

function formatElapsed(startedAt: number, endedAt: number | undefined, isLive: boolean): string {
  if (!isLive && endedAt === undefined) return "";
  return formatDuration((endedAt ?? Date.now()) - startedAt);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
