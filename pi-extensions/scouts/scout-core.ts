// Shared scaffold for scout subagents (finder, librarian, etc.)
//
// Extracted from the ~90% overlap between pi-finder and pi-librarian.
// Each scout provides its own system/user prompts and tool description,
// then delegates to this module for session lifecycle, abort handling,
// event tracking, turn budget enforcement, and TUI rendering.

import events from "node:events";

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createBashTool,
  createReadTool,
  getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";

import { getSmallModelFromProvider } from "./model-selection.ts";

const MAX_DISPLAY_ITEMS = 120;

const DEFAULT_EVENTTARGET_MAX_LISTENERS = 100;
const EVENTTARGET_MAX_LISTENERS_STATE_KEY = Symbol.for("pi.eventTargetMaxListenersState");

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };

export type ScoutStatus = "running" | "done" | "error" | "aborted";

// Interleaved display items — tool calls and text, in chronological order
export type DisplayItem =
  | { type: "tool"; name: string; args: Record<string, unknown>; isError?: boolean }
  | { type: "text"; text: string };

export interface ScoutRunDetails {
  status: ScoutStatus;
  query: string;
  turns: number;
  displayItems: DisplayItem[];
  summaryText?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface SubagentSelectionInfo {
  authMode: "oauth" | "api-key";
  authSource: string;
  reason: string;
}

export interface ScoutDetails {
  status: ScoutStatus;
  workspace?: string;
  subagentProvider?: string;
  subagentModelId?: string;
  subagentSelection?: SubagentSelectionInfo;
  runs: ScoutRunDetails[];
}

export interface ScoutConfig {
  name: string;
  maxTurns: number;
  getWorkspace?: (ctx: ExtensionContext) => Promise<string>;
  buildSystemPrompt: (maxTurns: number, workspace: string) => string;
  buildUserPrompt: (params: Record<string, unknown>) => string;
  runningMessage?: string;
}

// Turn budget extension — blocks tool use on the final turn
export function createTurnBudgetExtension(maxTurns: number): ExtensionFactory {
  return (pi) => {
    let turnIndex = 0;

    pi.on("turn_start", async (event) => {
      turnIndex = event.turnIndex;
    });

    pi.on("tool_call", async () => {
      if (turnIndex < maxTurns - 1) return undefined;
      const humanTurn = Math.min(turnIndex + 1, maxTurns);
      return {
        block: true,
        reason: `Tool use is disabled on the final turn (turn ${humanTurn}/${maxTurns}). Provide your final answer now without calling tools.`,
      };
    });

    pi.on("tool_result", async (event) => {
      const remainingAfter = Math.max(0, maxTurns - (turnIndex + 1));
      const humanTurn = Math.min(turnIndex + 1, maxTurns);
      const budgetLine = `[turn budget] turn ${humanTurn}/${maxTurns}; remaining after this turn: ${remainingAfter}`;
      return {
        content: [...(event.content ?? []), { type: "text", text: `\n\n${budgetLine}` }],
      };
    });
  };
}

// EventTarget max listeners management for nested sessions
function getEventTargetMaxListenersState(): EventTargetMaxListenersState {
  const g = globalThis as any;
  if (!g[EVENTTARGET_MAX_LISTENERS_STATE_KEY]) {
    g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] = { depth: 0 };
  }
  return g[EVENTTARGET_MAX_LISTENERS_STATE_KEY] as EventTargetMaxListenersState;
}

export function bumpDefaultEventTargetMaxListeners(): () => void {
  const state = getEventTargetMaxListenersState();
  const raw = process.env.PI_EVENTTARGET_MAX_LISTENERS ?? process.env.PI_ABORT_MAX_LISTENERS;
  const desired = raw !== undefined ? Number(raw) : DEFAULT_EVENTTARGET_MAX_LISTENERS;
  if (!Number.isFinite(desired) || desired < 0) return () => {};

  if (state.depth === 0) state.savedDefault = events.defaultMaxListeners;
  state.depth += 1;
  if (events.defaultMaxListeners < desired) events.setMaxListeners(desired);

  return () => {
    state.depth = Math.max(0, state.depth - 1);
    if (state.depth !== 0) return;
    if (state.savedDefault === undefined) return;
    events.setMaxListeners(state.savedDefault);
    state.savedDefault = undefined;
  };
}

// Utility helpers
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

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
function extractDisplayItems(messages: any[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg?.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
        items.push({ type: "text", text: part.text });
      } else if (part?.type === "toolCall" || part?.type === "tool_use") {
        const args = part.arguments ?? part.input ?? {};
        items.push({ type: "tool", name: part.name ?? "unknown", args });
      }
    }
  }
  return items;
}

export function computeOverallStatus(runs: ScoutRunDetails[]): ScoutStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.every((r) => r.status === "aborted")) return "aborted";
  return "done";
}

// Format a tool call for inline display — returns { label, summary }
function formatToolCallParts(name: string, args: Record<string, unknown>): { label: string; summary: string } {
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

// Execute a scout subagent session
export async function executeScout(
  config: ScoutConfig,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: ((update: any) => void) | undefined,
  ctx: ExtensionContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: ScoutDetails;
  isError: boolean;
}> {
  const restoreMaxListeners = bumpDefaultEventTargetMaxListeners();
  let abortListenerAdded = false;
  let onAbort: (() => void) | undefined;

  try {
    const workspace = config.getWorkspace ? await config.getWorkspace(ctx) : ctx.cwd;
    const maxTurns = config.maxTurns;

    const runs: ScoutRunDetails[] = [
      {
        status: "running",
        query: String(params.query ?? ""),
        turns: 0,
        displayItems: [],
        startedAt: Date.now(),
      },
    ];

    const modelRegistry = ctx.modelRegistry;
    const subModelSelection = await getSmallModelFromProvider(modelRegistry, ctx.model);

    if (!subModelSelection) {
      const error = "No models available. Configure credentials (e.g. /login or auth.json) and try again.";
      runs[0].status = "error";
      runs[0].error = error;
      runs[0].summaryText = error;
      runs[0].endedAt = Date.now();
      return {
        content: [{ type: "text", text: error }],
        details: { status: "error", workspace, runs } satisfies ScoutDetails,
        isError: true,
      };
    }

    const subModel = subModelSelection.model;
    const subagentThinkingLevel = subModelSelection.thinkingLevel;
    const subagentSelection: SubagentSelectionInfo = {
      authMode: subModelSelection.authMode,
      authSource: subModelSelection.authSource,
      reason: subModelSelection.reason,
    };

    let lastUpdate = 0;
    const emitAll = (force = false) => {
      const now = Date.now();
      if (!force && now - lastUpdate < 120) return;
      lastUpdate = now;

      const status = computeOverallStatus(runs);
      const text = runs[0].summaryText ?? (status === "running" ? "(searching...)" : "(no output)");

      onUpdate?.({
        content: [{ type: "text", text }],
        details: {
          status,
          workspace,
          subagentProvider: subModel.provider,
          subagentModelId: subModel.id,
          subagentSelection,
          runs,
        } satisfies ScoutDetails,
      });
    };

    emitAll(true);

    const systemPrompt = config.buildSystemPrompt(maxTurns, workspace);

    let toolAborted = false;
    const activeSessions = new Set<{ abort: () => Promise<void> }>();

    const markAllAborted = () => {
      for (const run of runs) {
        if (run.status !== "running") continue;
        run.status = "aborted";
        run.summaryText = run.summaryText ?? "Aborted";
        run.endedAt = Date.now();
      }
    };

    const abortAll = async () => {
      if (toolAborted) return;
      toolAborted = true;
      markAllAborted();
      emitAll(true);
      await Promise.allSettled([...activeSessions].map((s) => s.abort()));
    };

    onAbort = () => void abortAll();

    if (signal?.aborted) {
      await abortAll();
      return buildFinalResult(runs, workspace, subModel, subagentSelection);
    }

    if (signal) {
      signal.addEventListener("abort", onAbort);
      abortListenerAdded = true;
    }

    const wasAborted = () => toolAborted || signal?.aborted;
    const run = runs[0];

    let session: any;
    let unsubscribe: (() => void) | undefined;

    try {
      const resourceLoader = new DefaultResourceLoader({
        noExtensions: true,
        additionalExtensionPaths: [],
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [createTurnBudgetExtension(maxTurns)],
        systemPromptOverride: () => systemPrompt,
        skillsOverride: () => ({ skills: [], diagnostics: [] }),
      });
      await resourceLoader.reload();

      run.status = "running";
      run.turns = 0;
      run.displayItems = [];
      run.startedAt = Date.now();
      run.endedAt = undefined;
      run.error = undefined;
      run.summaryText = undefined;

      const { session: createdSession } = await createAgentSession({
        cwd: workspace,
        modelRegistry,
        resourceLoader,
        sessionManager: SessionManager.inMemory(workspace),
        model: subModel,
        thinkingLevel: subagentThinkingLevel,
        tools: [createReadTool(workspace), createBashTool(workspace)],
      });

      session = createdSession;
      activeSessions.add(session as any);

      unsubscribe = session.subscribe((event: any) => {
        switch (event.type) {
          case "turn_end": {
            run.turns += 1;
            // Rebuild display items from the full message history
            const items = extractDisplayItems(session.state.messages as any[]);
            run.displayItems = items.length > MAX_DISPLAY_ITEMS
              ? items.slice(items.length - MAX_DISPLAY_ITEMS)
              : items;
            emitAll(true);
            break;
          }
          case "tool_execution_start": {
            // Add a live tool item for the running tool
            run.displayItems.push({
              type: "tool",
              name: event.toolName,
              args: event.args ?? {},
            });
            if (run.displayItems.length > MAX_DISPLAY_ITEMS) {
              run.displayItems.splice(0, run.displayItems.length - MAX_DISPLAY_ITEMS);
            }
            emitAll(true);
            break;
          }
          case "tool_execution_end": {
            if (event.isError) {
              // Mark the matching tool item as errored
              for (let i = run.displayItems.length - 1; i >= 0; i--) {
                const item = run.displayItems[i];
                if (item.type === "tool" && item.name === event.toolName) {
                  item.isError = true;
                  break;
                }
              }
            }
            emitAll(true);
            break;
          }
        }
      });

      const userPrompt = config.buildUserPrompt(params);
      await session.prompt(userPrompt, { expandPromptTemplates: false });

      // Final extraction from complete messages
      run.displayItems = extractDisplayItems(session.state.messages as any[]);
      run.summaryText = getLastAssistantText(session.state.messages as any[]).trim();
      if (!run.summaryText) run.summaryText = wasAborted() ? "Aborted" : "(no output)";
      run.status = wasAborted() ? "aborted" : "done";
      run.endedAt = Date.now();
      emitAll(true);
    } catch (error) {
      const message = wasAborted() ? "Aborted" : error instanceof Error ? error.message : String(error);
      run.status = wasAborted() ? "aborted" : "error";
      run.error = wasAborted() ? undefined : message;
      run.summaryText = message;
      run.endedAt = Date.now();
      emitAll(true);
    } finally {
      if (session) activeSessions.delete(session as any);
      unsubscribe?.();
      session?.dispose();
    }

    return buildFinalResult(runs, workspace, subModel, subagentSelection);
  } finally {
    if (signal && abortListenerAdded && onAbort) signal.removeEventListener("abort", onAbort);
    restoreMaxListeners();
  }
}

function buildFinalResult(
  runs: ScoutRunDetails[],
  workspace: string,
  subModel: Model<Api>,
  subagentSelection: SubagentSelectionInfo,
) {
  const status = computeOverallStatus(runs);
  const text = runs[0]?.summaryText ?? "(no output)";
  return {
    content: [{ type: "text" as const, text }],
    details: {
      status,
      workspace,
      runs,
      subagentProvider: subModel.provider,
      subagentModelId: subModel.id,
      subagentSelection,
    } satisfies ScoutDetails,
    isError: status === "error",
  };
}

// Shared TUI rendering
export function renderScoutCall(
  scoutName: string,
  args: Record<string, unknown> | undefined,
  theme: any,
  extraInfo?: string,
): any {
  const query = typeof args?.query === "string" ? (args.query as string).trim() : "";
  const preview = shorten(query.replace(/\s+/g, " ").trim(), 70);

  const title = theme.fg("toolTitle", theme.bold(scoutName));
  const info = extraInfo ? `\n${theme.fg("muted", extraInfo)} · ${theme.fg("muted", preview)}` : "";
  const text = title + (preview && !extraInfo ? `\n${theme.fg("muted", preview)}` : info);
  return new Text(text, 0, 0);
}

export function renderScoutResult(
  scoutName: string,
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: any,
  runningMessage = "Searching…",
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
          : theme.fg("warning", "⏳");

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold(scoutName)) +
    " " +
    theme.fg(
      "dim",
      `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${totalTurns} turns • ${toolCount} tool${toolCount === 1 ? "" : "s"} • ${elapsed}`,
    );

  // Running state: compact fixed-height view with recent tool calls
  if (status === "running") {
    const c = new Container();
    c.addChild(new Text(header, 0, 0));

    const MAX_RUNNING_TOOLS = 5;
    const toolItems = items.filter((i): i is DisplayItem & { type: "tool" } => i.type === "tool");
    const hiddenCount = Math.max(0, toolItems.length - MAX_RUNNING_TOOLS);

    if (hiddenCount > 0) {
      c.addChild(new Text(theme.fg("dim", `  ... ${hiddenCount} earlier tool call${hiddenCount > 1 ? "s" : ""}`), 0, 0));
    }
    for (const item of toolItems.slice(-MAX_RUNNING_TOOLS)) {
      const { label, summary } = formatToolCallParts(item.name, item.args);
      const itemIcon = item.isError ? theme.fg("error", "✗") : theme.fg("accent", "▸");
      c.addChild(
        new Text(`  ${itemIcon} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`, 0, 0),
      );
    }

    c.addChild(new Spacer(1));
    c.addChild(new Text(theme.fg("muted", runningMessage), 0, 0));
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
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === "tool") {
      const { label, summary } = formatToolCallParts(item.name, item.args);
      const itemIcon = item.isError ? theme.fg("error", "✗") : theme.fg("accent", "▸");
      c.addChild(
        new Text(`  ${itemIcon} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`, 0, 0),
      );
    } else if (item.type === "text" && item.text.trim()) {
      // Is this the last text item?
      const isLastText = !items.slice(i + 1).some((it) => it.type === "text" && it.text.trim());
      if (isLastText) {
        c.addChild(new Spacer(1));
        if (expanded) {
          const mdTheme = getMarkdownTheme();
          c.addChild(new Markdown(item.text, 0, 0, mdTheme));
        } else {
          // Collapsed: show first ~18 lines
          const previewLines = item.text.trim().split("\n").slice(0, 18).join("\n");
          c.addChild(new Text(theme.fg("toolOutput", previewLines), 0, 0));
          if (item.text.trim().split("\n").length > 18) {
            c.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 0, 0));
          }
        }
      } else {
        // Intermediate text — show truncated and dim
        const preview = item.text.trim().split("\n")[0]!.slice(0, 120);
        c.addChild(new Text(theme.fg("dim", `  ${preview}${item.text.length > 120 ? "..." : ""}`), 0, 0));
      }
    }
  }

  // Footer with metadata
  c.addChild(new Spacer(1));
  if (details.workspace) {
    c.addChild(new Text(theme.fg("dim", `workspace: ${shortenPath(details.workspace)}`), 0, 0));
  }
  if (expanded && details.subagentSelection) {
    c.addChild(new Text(theme.fg("dim", `selection: ${details.subagentSelection.reason}`), 0, 0));
  }

  return c;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
