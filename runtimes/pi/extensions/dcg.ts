/**
 * Bash tool override that runs `dcg` in hook mode before execution.
 */

import { createBashTool, DynamicBorder, keyHint } from "@mariozechner/pi-coding-agent";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import {
  Container,
  type Component,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
} from "@mariozechner/pi-tui";


const escapeForSingleQuotes = (value: string) => value.replace(/'/g, "'\"'\"'");

type HookSpecificOutput = {
  permissionDecision?: string;
  permissionDecisionReason?: string;
  allowOnceCode?: string;
  ruleId?: string;
  severity?: string;
};

type HookOutput = {
  hookSpecificOutput?: HookSpecificOutput;
};

type DcgBlockDetails = {
  dcgBlocked: true;
  command: string;
  summary: string;
  fullReason: string;
};

type DcgDecision =
  | "deny"
  | "allowOnce"
  | "allowAlways"
  | "allowAlwaysProject"
  | "allowAlwaysGlobal";

const getDecisionReason = (reason: string | undefined): string => {
  if (!reason) return "Blocked by dcg";
  const lines = reason.split("\n");
  const reasonLine = lines.find((line) => line.startsWith("Reason:"));
  if (reasonLine) {
    return reasonLine.replace("Reason:", "").trim();
  }
  return lines[0]?.trim() || reason;
};

const severityBadge = (severity: string | undefined, theme: any): string => {
  if (!severity) return "";
  const normalized = severity.toLowerCase();
  const label = `[${severity.toUpperCase()}]`;
  if (normalized === "critical" || normalized === "high") {
    return theme.fg("error", label);
  }
  if (normalized === "medium") {
    return theme.fg("warning", label);
  }
  return theme.fg("muted", label);
};

const extractTextContent = (content: Array<TextContent | ImageContent> | undefined): string =>
  (content ?? [])
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");

class DcgDecisionComponent implements Component {
  private container = new Container();
  private selectList?: SelectList;
  private mode: "decision" | "scope" = "decision";
  private showDetails = false;

  constructor(
    private readonly data: {
      command: string;
      reason: string;
      details: string;
      allowOnceCode?: string;
      ruleId?: string;
      severity?: string;
    },
    private readonly tui: any,
    private readonly theme: any,
    private readonly onDone: (result: DcgDecision | null) => void,
  ) {
    this.rebuild();
  }

  invalidate(): void {
    this.container.invalidate();
    this.rebuild();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.onDone("deny");
      return;
    }

    if (data.toLowerCase() === "e") {
      this.showDetails = !this.showDetails;
      this.rebuild();
      this.tui.requestRender();
      return;
    }

    this.selectList?.handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  private rebuild(): void {
    const previousSelection = this.selectList?.getSelectedItem()?.value;
    this.container.clear();

    this.container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
    const title =
      this.theme.fg("accent", this.theme.bold("Destructive command blocked")) +
      (this.data.severity ? ` ${severityBadge(this.data.severity, this.theme)}` : "");
    this.container.addChild(new Text(title, 1, 0));

    const commandLine =
      this.theme.fg("dim", "Command: ") + this.theme.fg("text", this.data.command);
    this.container.addChild(new Text(commandLine, 1, 0));

    const reasonLine =
      this.theme.fg("dim", "Reason: ") + this.theme.fg("text", this.data.reason);
    this.container.addChild(new Text(reasonLine, 1, 0));

    if (this.showDetails) {
      this.container.addChild(new Text(this.theme.fg("muted", this.data.details), 1, 0));
    }

    const toggleText = this.showDetails
      ? "Press e to hide details"
      : "Press e to show details";
    this.container.addChild(new Text(this.theme.fg("dim", toggleText), 1, 0));

    const items = this.mode === "decision" ? this.getDecisionItems() : this.getScopeItems();
    this.selectList = new SelectList(items, Math.min(items.length, 6), {
      selectedPrefix: (text) => this.theme.fg("accent", text),
      selectedText: (text) => this.theme.fg("accent", text),
      description: (text) => this.theme.fg("muted", text),
      scrollInfo: (text) => this.theme.fg("dim", text),
      noMatch: (text) => this.theme.fg("warning", text),
    });

    this.selectList.onSelect = (item) => {
      if (item.value === "allowAlways") {
        this.mode = "scope";
        this.rebuild();
        this.tui.requestRender();
        return;
      }

      if (item.value === "back") {
        this.mode = "decision";
        this.rebuild();
        this.tui.requestRender();
        return;
      }

      this.onDone(item.value as DcgDecision);
    };
    this.selectList.onCancel = () => this.onDone("deny");

    if (previousSelection) {
      const index = items.findIndex((item) => item.value === previousSelection);
      if (index >= 0) {
        this.selectList.setSelectedIndex(index);
      } else {
        this.selectList.setSelectedIndex(0);
      }
    } else {
      this.selectList.setSelectedIndex(0);
    }

    this.container.addChild(this.selectList);
    this.container.addChild(
      new Text(
        this.theme.fg("dim", "↑↓ navigate • enter confirm • esc deny • e details"),
        1,
        0,
      ),
    );
    this.container.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
  }

  private getDecisionItems(): SelectItem[] {
    const items: SelectItem[] = [{ value: "deny", label: "Deny (default)", description: "" }];

    if (this.data.allowOnceCode) {
      items.push({ value: "allowOnce", label: "Allow once", description: "" });
    }

    if (this.data.ruleId) {
      items.push({
        value: "allowAlways",
        label: "Allow always…",
        description: "Choose project or global scope",
      });
    }

    return items;
  }

  private getScopeItems(): SelectItem[] {
    return [
      { value: "allowAlwaysProject", label: "Allow always (project)", description: "" },
      { value: "allowAlwaysGlobal", label: "Allow always (global)", description: "" },
      { value: "back", label: "Back", description: "" },
    ];
  }
}

export default function (pi: ExtensionAPI) {
  const runDcgHook = async (command: string, cwd: string) => {
    const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
    const escapedPayload = escapeForSingleQuotes(payload);
    const { stdout } = await pi.exec(
      "bash",
      ["-c", `printf '%s' '${escapedPayload}' | dcg`],
      { cwd },
    );

    const output = stdout.trim();
    if (!output) return null;
    return output;
  };

  const parseHookOutput = (output: string): HookOutput | null => {
    try {
      return JSON.parse(output) as HookOutput;
    } catch {
      return null;
    }
  };

  const runBashTool = async (
    toolCallId: string,
    params: { command: string; timeout?: number },
    onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    ctx: { cwd: string },
    signal: AbortSignal | undefined,
  ) => {
    const tool = createBashTool(ctx.cwd);
    return tool.execute(toolCallId, params, signal, onUpdate);
  };

  const baseBash = createBashTool(process.cwd());

  pi.registerTool({
    ...baseBash,
    renderCall(args, theme) {
      const command = args?.command ?? "";
      const text = theme.fg("toolTitle", "$ ") + theme.fg("text", command);
      return new Text(text, 0, 0);
    },
    renderResult(result, options, theme) {
      const details = result.details as DcgBlockDetails | undefined;
      if (!details?.dcgBlocked) {
        return new Text(extractTextContent(result.content), 0, 0);
      }

      const header = theme.fg("accent", theme.bold("\ndcg blocked"));
      const commandLine = `${theme.fg("dim", "Command: ")}${theme.fg("text", details.command)}`;
      if (options.expanded) {
        const full = theme.fg("text", details.fullReason);
        return new Text([header, commandLine, full].join("\n"), 0, 0);
      }

      const summary = theme.fg("text", details.summary);
      const hint = theme.fg("dim", keyHint("expandTools", "to expand"));
      return new Text([header, commandLine, summary, hint].join("\n"), 0, 0);
    },
    async execute(toolCallId, params, onUpdate, ctx, signal) {
      const command = params.command ?? "";
      const buildBlockDetails = (message: string): DcgBlockDetails => ({
        dcgBlocked: true,
        command,
        summary: getDecisionReason(message),
        fullReason: message,
      });

      try {
        const output = await runDcgHook(command, ctx.cwd);
        if (!output) {
          return runBashTool(toolCallId, params, onUpdate, ctx, signal);
        }

        const parsed = parseHookOutput(output);
        if (!parsed) {
          if (ctx.hasUI) {
            ctx.ui.notify("dcg returned non-JSON output; allowing command.", "warning");
          }
          return runBashTool(toolCallId, params, onUpdate, ctx, signal);
        }

        const hookOutput = parsed.hookSpecificOutput;
        if (hookOutput?.permissionDecision !== "deny") {
          return runBashTool(toolCallId, params, onUpdate, ctx, signal);
        }

        const reason = hookOutput.permissionDecisionReason ?? output;
        const blockResult = {
          content: [],
          details: buildBlockDetails(reason),
        };

        if (!ctx.hasUI) {
          return blockResult;
        }

        const result = await ctx.ui.custom<DcgDecision | null>((tui, theme, _kb, done) =>
          new DcgDecisionComponent(
            {
              command,
              reason: getDecisionReason(reason),
              details: reason,
              allowOnceCode: hookOutput.allowOnceCode,
              ruleId: hookOutput.ruleId,
              severity: hookOutput.severity,
            },
            tui,
            theme,
            done,
          ),
        );

        const denyAndBlock = (explicit: boolean) => {
          if (explicit) {
            pi.sendMessage(
              {
                customType: "dcg-user-decision",
                content: "deny",
                display: false,
                details: { command, decision: "deny" },
              },
              { deliverAs: "steer" },
            );
          }
          return blockResult;
        };

        if (!result || result === "deny") {
          return denyAndBlock(result === "deny");
        }

        if (result === "allowOnce") {
          if (!hookOutput.allowOnceCode) {
            return blockResult;
          }

          const allowOnceResult = await pi.exec("dcg", ["allow-once", hookOutput.allowOnceCode], {
            cwd: ctx.cwd,
          });

          if (allowOnceResult.code !== 0) {
            return { content: [], details: buildBlockDetails(allowOnceResult.stderr.trim() || reason) };
          }

          const followUpOutput = await runDcgHook(command, ctx.cwd);
          if (!followUpOutput) {
            return runBashTool(toolCallId, params, onUpdate, ctx, signal);
          }

          const followUpParsed = parseHookOutput(followUpOutput);
          if (followUpParsed?.hookSpecificOutput?.permissionDecision === "deny") {
            const followUpReason =
              followUpParsed.hookSpecificOutput.permissionDecisionReason || followUpOutput;
            return { content: [], details: buildBlockDetails(followUpReason) };
          }

          return runBashTool(toolCallId, params, onUpdate, ctx, signal);
        }

        const ruleId = hookOutput.ruleId;
        if (!ruleId) {
          return blockResult;
        }

        const scopeFlag = result === "allowAlwaysGlobal" ? "--global" : "--project";
        const allowlistResult = await pi.exec(
          "dcg",
          ["allowlist", "add", ruleId, scopeFlag],
          { cwd: ctx.cwd },
        );

        if (allowlistResult.code !== 0) {
          return { content: [], details: buildBlockDetails(allowlistResult.stderr.trim() || reason) };
        }

        const followUpOutput = await runDcgHook(command, ctx.cwd);
        if (!followUpOutput) {
          return runBashTool(toolCallId, params, onUpdate, ctx, signal);
        }

        const followUpParsed = parseHookOutput(followUpOutput);
        if (followUpParsed?.hookSpecificOutput?.permissionDecision === "deny") {
          const followUpReason =
            followUpParsed.hookSpecificOutput.permissionDecisionReason || followUpOutput;
          return { content: [], details: buildBlockDetails(followUpReason) };
        }

        return runBashTool(toolCallId, params, onUpdate, ctx, signal);
      } catch (error) {
        if (ctx.hasUI) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`dcg failed: ${message}`, "warning");
        }
        return { content: [], details: buildBlockDetails("Blocked by dcg") };
      }
    },
  });
}
