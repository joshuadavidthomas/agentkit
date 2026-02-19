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

export const MAX_TOOL_CALLS_TO_KEEP = 80;

const DEFAULT_EVENTTARGET_MAX_LISTENERS = 100;
const EVENTTARGET_MAX_LISTENERS_STATE_KEY = Symbol.for("pi.eventTargetMaxListenersState");

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };

// Scout run status
export type ScoutStatus = "running" | "done" | "error" | "aborted";

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
}

export interface ScoutRunDetails {
  status: ScoutStatus;
  query: string;
  turns: number;
  toolCalls: ToolCall[];
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

// Configuration for a specific scout tool
export interface ScoutConfig {
  // Name used in logs and rendering
  name: string;
  // Max turns for the subagent session
  maxTurns: number;
  // Working directory for the subagent (defaults to ctx.cwd)
  getWorkspace?: (ctx: ExtensionContext) => Promise<string>;
  // Build the system prompt
  buildSystemPrompt: (maxTurns: number, workspace: string) => string;
  // Build the user prompt from params
  buildUserPrompt: (params: Record<string, unknown>) => string;
  // Status message while running
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

export function computeOverallStatus(runs: ScoutRunDetails[]): ScoutStatus {
  if (runs.some((r) => r.status === "running")) return "running";
  if (runs.some((r) => r.status === "error")) return "error";
  if (runs.every((r) => r.status === "aborted")) return "aborted";
  return "done";
}

export function renderCombinedMarkdown(runs: ScoutRunDetails[]): string {
  const r = runs[0];
  return (r.summaryText ?? (r.status === "running" ? "(searching...)" : "(no output)")).trim();
}

export function formatToolCall(call: ToolCall): string {
  const args = call.args && typeof call.args === "object" ? (call.args as Record<string, any>) : undefined;

  if (call.name === "read") {
    const p = typeof args?.path === "string" ? args.path : "";
    const offset = typeof args?.offset === "number" ? args.offset : undefined;
    const limit = typeof args?.limit === "number" ? args.limit : undefined;
    const range = offset || limit ? `:${offset ?? 1}${limit ? `-${(offset ?? 1) + limit - 1}` : ""}` : "";
    return `read ${p}${range}`;
  }

  if (call.name === "bash") {
    const command = typeof args?.command === "string" ? args.command : "";
    const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
    const normalized = command.replace(/\s+/g, " ").trim();
    const suffix = timeout ? ` (timeout ${timeout}s)` : "";
    return `bash ${shorten(normalized, 120)}${suffix}`.trimEnd();
  }

  return call.name;
}

// Execute a scout subagent session.
// This is the core engine shared by finder, librarian, and any future scouts.
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
        toolCalls: [],
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
      const text = renderCombinedMarkdown(runs);

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
      const status = computeOverallStatus(runs);
      const text = renderCombinedMarkdown(runs);
      return {
        content: [{ type: "text", text }],
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
        additionalExtensionPaths: ["npm:pi-subdir-context"],
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
      run.toolCalls = [];
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
            emitAll();
            break;
          }
          case "tool_execution_start": {
            run.toolCalls.push({
              id: event.toolCallId,
              name: event.toolName,
              args: event.args,
              startedAt: Date.now(),
            });
            if (run.toolCalls.length > MAX_TOOL_CALLS_TO_KEEP) {
              run.toolCalls.splice(0, run.toolCalls.length - MAX_TOOL_CALLS_TO_KEEP);
            }
            emitAll(true);
            break;
          }
          case "tool_execution_end": {
            const call = run.toolCalls.find((c) => c.id === event.toolCallId);
            if (call) {
              call.endedAt = Date.now();
              call.isError = event.isError;
            }
            emitAll(true);
            break;
          }
        }
      });

      const userPrompt = config.buildUserPrompt(params);
      await session.prompt(userPrompt, { expandPromptTemplates: false });

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

    const status = computeOverallStatus(runs);
    const text = renderCombinedMarkdown(runs);

    return {
      content: [{ type: "text", text }],
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
  } finally {
    if (signal && abortListenerAdded && onAbort) signal.removeEventListener("abort", onAbort);
    restoreMaxListeners();
  }
}

// Shared TUI rendering for scout tool results.
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
  const icon =
    status === "done"
      ? theme.fg("success", "✓")
      : status === "error"
        ? theme.fg("error", "✗")
        : status === "aborted"
          ? theme.fg("warning", "◼")
          : theme.fg("warning", "⏳");

  const run = details.runs[0];
  const totalToolCalls = run?.toolCalls.length ?? 0;
  const totalTurns = run?.turns ?? 0;

  const selectionSummary = details.subagentSelection
    ? `${details.subagentSelection.authMode}/${details.subagentSelection.authSource}`
    : "?/?";

  const header =
    icon +
    " " +
    theme.fg("toolTitle", theme.bold(`${scoutName} `)) +
    theme.fg(
      "dim",
      `${details.subagentProvider ?? "?"}/${details.subagentModelId ?? "?"} • ${selectionSummary} • ${totalTurns} turns • ${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}`,
    );

  const workspaceLine = details.workspace
    ? `${theme.fg("muted", "workspace: ")}${theme.fg("toolOutput", details.workspace)}`
    : theme.fg("muted", "workspace: (none)");

  const selectionReasonLine = details.subagentSelection
    ? `${theme.fg("muted", "selection: ")}${theme.fg("toolOutput", details.subagentSelection.reason)}`
    : undefined;

  let toolsText = "";
  if (run && run.toolCalls.length > 0) {
    const calls = expanded ? run.toolCalls : run.toolCalls.slice(-6);
    const lines: string[] = [theme.fg("muted", "Tools:")];
    for (const call of calls) {
      const callIcon = call.isError ? theme.fg("error", "✗") : theme.fg("dim", "→");
      lines.push(`${callIcon} ${theme.fg("toolOutput", formatToolCall(call))}`);
    }
    if (!expanded && run.toolCalls.length > 6) lines.push(theme.fg("muted", "(Ctrl+O to expand)"));
    toolsText = lines.join("\n");
  }

  if (status === "running") {
    let text = `${header}\n${workspaceLine}`;
    if (expanded && selectionReasonLine) text += `\n${selectionReasonLine}`;
    if (toolsText) text += `\n\n${toolsText}`;
    text += `\n\n${theme.fg("muted", runningMessage)}`;
    return new Text(text, 0, 0);
  }

  const mdTheme = getMarkdownTheme();
  const combined =
    (result.content[0]?.type === "text" ? result.content[0].text : renderCombinedMarkdown(details.runs)).trim() ||
    "(no output)";

  if (!expanded) {
    const previewLines = combined.split("\n").slice(0, 18).join("\n");
    let text = `${header}\n${workspaceLine}`;
    text += `\n\n${theme.fg("toolOutput", previewLines)}`;
    if (combined.split("\n").length > 18) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    if (toolsText) text += `\n\n${toolsText}`;
    return new Text(text, 0, 0);
  }

  const container = new Container();
  container.addChild(new Text(header, 0, 0));
  container.addChild(new Text(workspaceLine, 0, 0));
  if (selectionReasonLine) container.addChild(new Text(selectionReasonLine, 0, 0));
  if (toolsText) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(toolsText, 0, 0));
  }
  container.addChild(new Spacer(1));
  container.addChild(new Markdown(combined, 0, 0, mdTheme));
  return container;
}
