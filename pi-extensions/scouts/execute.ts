// Scout session lifecycle — execute a scout subagent from config to result.
//
// Handles session creation, model resolution with fallback, abort propagation,
// turn budget enforcement, event tracking, and final result construction.

import events from "node:events";

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createBashTool,
  createReadTool,
} from "@mariozechner/pi-coding-agent";

import { resolveModelFamily, resolvePlannedModelCandidates } from "./models.ts";
import type { ScoutConfig, ScoutDetails, ScoutRunDetails } from "./types.ts";
import { computeOverallStatus, extractDisplayItems, extractToolResultText, getLastAssistantText, MAX_DISPLAY_ITEMS } from "./display.ts";

// Turn budget extension — blocks tool use on the final turn
export function createTurnBudgetExtension(maxTurns: number) {
  return (pi: any) => {
    let turnIndex = 0;

    pi.on("turn_start", async (event: any) => {
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

    pi.on("tool_result", async (event: any) => {
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
const DEFAULT_EVENTTARGET_MAX_LISTENERS = 100;
const EVENTTARGET_MAX_LISTENERS_STATE_KEY = Symbol.for("pi.eventTargetMaxListenersState");

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };

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
    const explicitModelId = typeof params.model === "string" ? params.model.trim() : undefined;
    const currentProvider = ctx.model?.provider?.toLowerCase();
    const currentFamily = resolveModelFamily(ctx.model);
    const providerModelIds = currentProvider ? config.providerModelCandidates?.[currentProvider] : undefined;
    const familyModelIds = currentFamily ? config.familyModelCandidates?.[currentFamily] : undefined;
    const defaultModelIds = config.defaultModelCandidates ?? (config.defaultModel ? [config.defaultModel] : undefined);
    const candidates = resolvePlannedModelCandidates(modelRegistry, ctx.model, {
      explicitModelId,
      providerModelIds,
      familyModelIds,
      defaultModelIds,
    });

    if (candidates.length === 0) {
      const available = modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
      const requested = explicitModelId
        ?? providerModelIds?.join(", ")
        ?? familyModelIds?.join(", ")
        ?? defaultModelIds?.join(", ");
      const error = requested
        ? `Model "${requested}" not found. Available: ${available.length ? available.join(", ") : "none (configure credentials via /login or auth.json)"}`
        : "No model specified and no current model to fall back to.";
      runs[0].status = "error";
      runs[0].error = error;
      runs[0].summaryText = error;
      runs[0].endedAt = Date.now();
      return {
        content: [{ type: "text", text: error }],
        details: { status: "error", runs } satisfies ScoutDetails,
        isError: true,
      };
    }

    let subModel = candidates[0]!.model;
    const subagentThinkingLevel = config.defaultThinkingLevel ?? candidates[0]!.thinkingLevel;

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
          subagentProvider: subModel.provider,
          subagentModelId: subModel.id,
          runs,
        } satisfies ScoutDetails,
      });
    };

    emitAll(true);

    const systemPrompt = config.buildSystemPrompt(maxTurns);

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
      return buildFinalResult(runs, subModel);
    }

    if (signal) {
      signal.addEventListener("abort", onAbort);
      abortListenerAdded = true;
    }

    const wasAborted = () => toolAborted || signal?.aborted;
    const run = runs[0];

    for (let ci = 0; ci < candidates.length; ci++) {
      subModel = candidates[ci]!.model;
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

        const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

        const allTools = config.getTools
          ? config.getTools()
          : [createReadTool(ctx.cwd), createBashTool(ctx.cwd)];

        const builtinTools = allTools.filter((t: any) => BUILTIN_TOOL_NAMES.has(t.name));
        const extraTools = allTools.filter((t: any) => !BUILTIN_TOOL_NAMES.has(t.name));

        const customTools = extraTools.map((t: any) => ({
          name: t.name,
          label: t.label,
          description: t.description,
          parameters: t.parameters,
          execute: (toolCallId: string, params: any, signal: any, onUpdate: any, _ctx: any) =>
            t.execute(toolCallId, params, signal, onUpdate),
        }));

        const { session: createdSession } = await createAgentSession({
          cwd: ctx.cwd,
          modelRegistry,
          resourceLoader,
          sessionManager: SessionManager.inMemory(ctx.cwd),
          model: subModel,
          thinkingLevel: subagentThinkingLevel,
          tools: builtinTools,
          customTools,
        });

        session = createdSession;
        activeSessions.add(session as any);

        unsubscribe = session.subscribe((event: any) => {
          switch (event.type) {
            case "turn_end": {
              run.turns += 1;
              const items = extractDisplayItems(session.state.messages as any[]);
              run.displayItems = items.length > MAX_DISPLAY_ITEMS
                ? items.slice(items.length - MAX_DISPLAY_ITEMS)
                : items;
              emitAll(true);
              break;
            }
            case "tool_execution_start": {
              run.displayItems.push({
                type: "tool",
                name: event.toolName,
                args: event.args ?? {},
                toolCallId: event.toolCallId,
              });
              if (run.displayItems.length > MAX_DISPLAY_ITEMS) {
                run.displayItems.splice(0, run.displayItems.length - MAX_DISPLAY_ITEMS);
              }
              emitAll(true);
              break;
            }
            case "tool_execution_end": {
              for (let i = run.displayItems.length - 1; i >= 0; i--) {
                const item = run.displayItems[i];
                if (item.type === "tool" && item.toolCallId === event.toolCallId) {
                  if (event.isError) item.isError = true;
                  const text = extractToolResultText(event.result);
                  if (text) item.result = text;
                  break;
                }
              }
              emitAll(true);
              break;
            }
          }
        });

        const userPrompt = config.buildUserPrompt(params);
        await session.prompt(userPrompt, { expandPromptTemplates: false });

        run.displayItems = extractDisplayItems(session.state.messages as any[]);
        run.summaryText = getLastAssistantText(session.state.messages as any[]).trim();
        if (!run.summaryText) run.summaryText = wasAborted() ? "Aborted" : "(no output)";
        run.status = wasAborted() ? "aborted" : "done";
        run.endedAt = Date.now();
        emitAll(true);

        break;
      } catch (error) {
        const message = wasAborted() ? "Aborted" : error instanceof Error ? error.message : String(error);

        if (!wasAborted() && ci < candidates.length - 1) {
          continue;
        }

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
    }

    return buildFinalResult(runs, subModel);
  } finally {
    if (signal && abortListenerAdded && onAbort) signal.removeEventListener("abort", onAbort);
    restoreMaxListeners();
  }
}

function buildFinalResult(
  runs: ScoutRunDetails[],
  subModel: Model<Api>,
) {
  const status = computeOverallStatus(runs);
  const text = runs[0]?.summaryText ?? "(no output)";
  return {
    content: [{ type: "text" as const, text }],
    details: {
      status,
      runs,
      subagentProvider: subModel.provider,
      subagentModelId: subModel.id,
    } satisfies ScoutDetails,
    isError: status === "error",
  };
}
