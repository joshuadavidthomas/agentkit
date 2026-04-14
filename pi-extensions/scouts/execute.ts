// Scout session lifecycle — execute a scout subagent from config to result.
//
// Handles session creation, model resolution with fallback, abort propagation,
// turn budget enforcement, event tracking, and final result construction.

import events from "node:events";

import type { Api, Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createBashTool,
  createReadTool,
} from "@mariozechner/pi-coding-agent";

import { extractDisplayItems, extractToolResultText, getLastAssistantText, MAX_DISPLAY_ITEMS } from "./display.ts";
import { resolveWorkloadModel } from "./models.ts";
import type { ScoutConfig, ScoutDetails, ScoutRunDetails } from "./types.ts";

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
const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

type EventTargetMaxListenersState = { depth: number; savedDefault?: number };
type ScoutExecutionResult = {
  content: Array<{ type: "text"; text: string }>;
  details: ScoutDetails;
  isError: boolean;
};
type ScoutWorkflowPhase = "planning" | "running" | "aborting" | "finished";
type ScoutRunPlan = {
  model: Model<Api>;
  thinkingLevel?: ThinkingLevel;
};
type AbortableSession = { abort: () => Promise<void> };

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

function createInitialRun(query: string): ScoutRunDetails {
  return {
    status: "running",
    query,
    turns: 0,
    displayItems: [],
    startedAt: Date.now(),
  };
}

function prepareScoutTools(config: ScoutConfig, cwd: string) {
  const allTools = config.getTools
    ? config.getTools()
    : [createReadTool(cwd), createBashTool(cwd)];

  const builtinTools = allTools.filter((tool: any) => BUILTIN_TOOL_NAMES.has(tool.name));
  const customTools = allTools
    .filter((tool: any) => !BUILTIN_TOOL_NAMES.has(tool.name))
    .map((tool: any) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      execute: (toolCallId: string, params: any, signal: any, onUpdate: any, _ctx: any) =>
        tool.execute(toolCallId, params, signal, onUpdate),
    }));

  return { builtinTools, customTools };
}

class ScoutWorkflow {
  private readonly maxTurns: number;
  private readonly query: string;
  private readonly userPrompt: string;
  private readonly systemPrompt: string;
  private readonly runPlans: ScoutRunPlan[];
  private readonly activeSessions = new Set<AbortableSession>();
  private readonly runs: ScoutRunDetails[] = [];
  private readonly planningError?: string;

  private phase: ScoutWorkflowPhase = "planning";
  private currentModel?: Model<Api>;
  private abortRequested = false;
  private abortSignalListener?: () => void;
  private lastPublishedAt = 0;

  constructor(
    private readonly config: ScoutConfig,
    private readonly params: Record<string, unknown>,
    private readonly signal: AbortSignal | undefined,
    private readonly onUpdate: ((update: any) => void) | undefined,
    private readonly ctx: ExtensionContext,
  ) {
    this.maxTurns = config.maxTurns;
    this.query = String(params.query ?? "");
    this.userPrompt = config.buildUserPrompt(params);
    this.systemPrompt = config.buildSystemPrompt(this.maxTurns);

    const explicitModelId = typeof params.model === "string" ? params.model.trim() : undefined;
    const configuredModel = config.configuredModel?.trim();

    let resolvedRunPlan: ScoutRunPlan | null = null;

    const overrideModelId = explicitModelId || configuredModel;
    if (overrideModelId) {
      const explicitMatch = resolveWorkloadModel(ctx.modelRegistry, ctx.model, {
        explicitModelId: overrideModelId,
        provider: ctx.model?.provider ?? "",
        workload: config.workload ?? "balanced",
      });
      if (explicitMatch) {
        resolvedRunPlan = {
          model: explicitMatch.model,
          thinkingLevel: config.defaultThinkingLevel ?? explicitMatch.thinkingLevel,
        };
      }
    }

    if (!resolvedRunPlan && config.workload && ctx.model?.provider) {
      const workloadMatch = resolveWorkloadModel(ctx.modelRegistry, ctx.model, {
        provider: ctx.model.provider,
        workload: config.workload,
      });
      if (workloadMatch) {
        resolvedRunPlan = {
          model: workloadMatch.model,
          thinkingLevel: config.defaultThinkingLevel ?? workloadMatch.thinkingLevel,
        };
      }
    }

    if (!resolvedRunPlan) {
      const available = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
      const requested = overrideModelId
        ?? (config.workload ? `workload ${config.workload} on provider ${ctx.model?.provider ?? "(none)"}` : undefined)
        ?? "the current scout model selection";
      this.planningError = `No compatible model found for ${requested}. Available: ${available.length ? available.join(", ") : "none (configure credentials via /login or auth.json)"}`;
      this.runPlans = [];
      return;
    }

    this.runPlans = [resolvedRunPlan];
    this.currentModel = resolvedRunPlan.model;
  }

  async run(): Promise<ScoutExecutionResult> {
    if (this.planningError) {
      return this.buildPlanningErrorResult();
    }

    if (this.signal?.aborted) {
      const run = this.startRun(this.runPlans[0]!);
      this.phase = "aborting";
      this.abortRequested = true;
      this.markRunAborted(run);
      this.publishUpdate(true);
      this.phase = "finished";
      return this.buildResult();
    }

    this.phase = "running";
    const detachAbortHandling = this.attachAbortHandling();
    try {
      for (const runPlan of this.runPlans) {
        const shouldContinue = await this.runPlannedRun(runPlan);
        if (!shouldContinue) break;
      }

      this.phase = "finished";
      return this.buildResult();
    } finally {
      detachAbortHandling();
    }
  }

  private buildPlanningErrorResult(): ScoutExecutionResult {
    const run = createInitialRun(this.query);
    run.status = "error";
    run.error = this.planningError;
    run.summaryText = this.planningError;
    run.endedAt = Date.now();

    return {
      content: [{ type: "text", text: this.planningError! }],
      details: { mode: "single", status: "error", runs: [run] } satisfies ScoutDetails,
      isError: true,
    };
  }

  private startRun(runPlan: ScoutRunPlan): ScoutRunDetails {
    const run = createInitialRun(this.query);
    this.currentModel = runPlan.model;
    this.runs.unshift(run);
    this.publishUpdate(true);
    return run;
  }

  private currentRun(): ScoutRunDetails {
    return this.runs[0]!;
  }

  private publishUpdate(force = false): void {
    const run = this.currentRun();
    if (!run || !this.currentModel) return;

    const now = Date.now();
    if (!force && now - this.lastPublishedAt < 120) return;
    this.lastPublishedAt = now;

    const text = run.summaryText ?? (run.status === "running" ? "(searching...)" : "(no output)");
    this.onUpdate?.({
      content: [{ type: "text", text }],
      details: {
        mode: "single",
        status: run.status,
        subagentProvider: this.currentModel.provider,
        subagentModelId: this.currentModel.id,
        runs: this.runs,
      } satisfies ScoutDetails,
    });
  }

  private attachAbortHandling(): () => void {
    if (!this.signal) return () => {};

    this.abortSignalListener = () => {
      void this.abort();
    };
    this.signal.addEventListener("abort", this.abortSignalListener);

    return () => {
      if (!this.signal || !this.abortSignalListener) return;
      this.signal.removeEventListener("abort", this.abortSignalListener);
      this.abortSignalListener = undefined;
    };
  }

  private async abort(): Promise<void> {
    if (this.abortRequested) return;
    this.abortRequested = true;
    this.phase = "aborting";

    const run = this.currentRun();
    if (run) {
      this.markRunAborted(run);
      this.publishUpdate(true);
    }

    await Promise.allSettled([...this.activeSessions].map((session) => session.abort()));
  }

  private wasAborted(): boolean {
    return this.abortRequested || !!this.signal?.aborted;
  }

  private markRunAborted(run: ScoutRunDetails): void {
    if (run.status !== "running") return;
    run.status = "aborted";
    run.summaryText = run.summaryText ?? "Aborted";
    run.endedAt = Date.now();
  }

  private async runPlannedRun(runPlan: ScoutRunPlan): Promise<boolean> {
    const run = this.startRun(runPlan);

    let scoutSession: any;
    let stopObservingSession: (() => void) | undefined;

    try {
      const resourceLoader = await this.createResourceLoader();
      const { session } = await this.createSession(runPlan, resourceLoader);
      scoutSession = session;
      this.activeSessions.add(scoutSession as AbortableSession);
      stopObservingSession = this.observeSession(run, scoutSession);

      await scoutSession.prompt(this.userPrompt, { expandPromptTemplates: false });
      this.completeSuccessfulRun(run, scoutSession);
      return false;
    } catch (error) {
      const message = this.wasAborted() ? "Aborted" : error instanceof Error ? error.message : String(error);
      this.completeFailedRun(run, message);
      return !this.wasAborted() && this.hasAnotherRunAfter(runPlan);
    } finally {
      if (scoutSession) this.activeSessions.delete(scoutSession as AbortableSession);
      stopObservingSession?.();
      scoutSession?.dispose();
    }
  }

  private hasAnotherRunAfter(runPlan: ScoutRunPlan): boolean {
    const index = this.runPlans.indexOf(runPlan);
    return index >= 0 && index < this.runPlans.length - 1;
  }

  private async createResourceLoader(): Promise<DefaultResourceLoader> {
    const resourceLoader = new DefaultResourceLoader({
      noExtensions: true,
      additionalExtensionPaths: [],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [createTurnBudgetExtension(this.maxTurns)],
      systemPromptOverride: () => this.systemPrompt,
      skillsOverride: () => ({ skills: [], diagnostics: [] }),
    });
    await resourceLoader.reload();
    return resourceLoader;
  }

  private async createSession(
    runPlan: ScoutRunPlan,
    resourceLoader: DefaultResourceLoader,
  ): Promise<{ session: any }> {
    const { builtinTools, customTools } = prepareScoutTools(this.config, this.ctx.cwd);
    return createAgentSession({
      cwd: this.ctx.cwd,
      modelRegistry: this.ctx.modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(this.ctx.cwd),
      model: runPlan.model,
      thinkingLevel: runPlan.thinkingLevel,
      tools: builtinTools,
      customTools,
    });
  }

  private observeSession(run: ScoutRunDetails, session: any): () => void {
    return session.subscribe((event: any) => {
      switch (event.type) {
        case "turn_end": {
          run.turns += 1;
          const items = extractDisplayItems(session.state.messages as any[]);
          run.displayItems = items.length > MAX_DISPLAY_ITEMS
            ? items.slice(items.length - MAX_DISPLAY_ITEMS)
            : items;
          this.publishUpdate(true);
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
          this.publishUpdate(true);
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
          this.publishUpdate(true);
          break;
        }
      }
    });
  }

  private completeSuccessfulRun(run: ScoutRunDetails, session: any): void {
    run.displayItems = extractDisplayItems(session.state.messages as any[]);
    run.summaryText = getLastAssistantText(session.state.messages as any[]).trim();
    if (!run.summaryText) {
      run.summaryText = this.wasAborted() ? "Aborted" : "(no output)";
    }
    run.status = this.wasAborted() ? "aborted" : "done";
    run.endedAt = Date.now();
    this.publishUpdate(true);
  }

  private completeFailedRun(run: ScoutRunDetails, message: string): void {
    run.status = this.wasAborted() ? "aborted" : "error";
    run.error = this.wasAborted() ? undefined : message;
    run.summaryText = message;
    run.endedAt = Date.now();
    this.publishUpdate(true);
  }

  private buildResult(): ScoutExecutionResult {
    const run = this.currentRun();
    return {
      content: [{ type: "text", text: run?.summaryText ?? "(no output)" }],
      details: {
        mode: "single",
        status: run?.status ?? "error",
        runs: this.runs,
        subagentProvider: this.currentModel?.provider,
        subagentModelId: this.currentModel?.id,
      } satisfies ScoutDetails,
      isError: run?.status === "error",
    };
  }
}

// Execute a scout subagent session
export async function executeScout(
  config: ScoutConfig,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onUpdate: ((update: any) => void) | undefined,
  ctx: ExtensionContext,
): Promise<ScoutExecutionResult> {
  const restoreMaxListeners = bumpDefaultEventTargetMaxListeners();
  try {
    return await new ScoutWorkflow(config, params, signal, onUpdate, ctx).run();
  } finally {
    restoreMaxListeners();
  }
}
