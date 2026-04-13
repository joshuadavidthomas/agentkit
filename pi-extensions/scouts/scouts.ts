// Parallel scouts — tool definition and execution engine.
//
// Dispatches finder, librarian, and specialist concurrently via Promise.allSettled.
// Each scout gets its own ScoutDetails tracked independently, with combined
// progress updates for the TUI.

import { Type } from "@sinclair/typebox";
import type { ToolDefinition, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { executeScout } from "./execute.ts";
import { renderParallelResult, renderScoutCall } from "./render.ts";
import type { ScoutConfig, ScoutDetails, ScoutStatus } from "./types.ts";
import { computeOverallStatus } from "./display.ts";
import { ModelParam } from "./validate.ts";
import { FINDER_CONFIG } from "./finder/config.ts";
import { LIBRARIAN_CONFIG } from "./librarian/config.ts";
import { buildSpecialistConfig } from "./specialist/config.ts";

// Types

export interface ParallelScoutResult {
  scout: string;
  details: ScoutDetails;
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

export interface ParallelDetails {
  mode: "parallel";
  status: ScoutStatus;
  results: ParallelScoutResult[];
}

// Parallel execution engine

interface ParallelTask {
  scout: string;
  params: Record<string, unknown>;
}

async function executeParallelScouts(
  configs: Map<string, ScoutConfig>,
  tasks: ParallelTask[],
  signal: AbortSignal | undefined,
  onUpdate: ((update: any) => void) | undefined,
  ctx: ExtensionContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: ParallelDetails;
  isError: boolean;
}> {
  const results: ParallelScoutResult[] = tasks.map((t) => ({
    scout: t.scout,
    details: { status: "running" as ScoutStatus, runs: [] },
    content: [{ type: "text" as const, text: "(running...)" }],
    isError: false,
  }));

  let lastUpdate = 0;
  const emitCombined = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdate < 150) return;
    lastUpdate = now;

    const statuses = results.map((r) => r.details.status);
    const overallStatus: ScoutStatus = statuses.every((s) => s === "done")
      ? "done"
      : statuses.some((s) => s === "running")
        ? "running"
        : statuses.some((s) => s === "error")
          ? "error"
          : "done";

    const combinedText = results
      .map((r) => `[${r.scout}] ${r.content[0]?.text ?? "(no output)"}`)
      .join("\n\n");

    onUpdate?.({
      content: [{ type: "text", text: combinedText }],
      details: {
        mode: "parallel",
        status: overallStatus,
        results,
      } satisfies ParallelDetails,
    });
  };

  emitCombined(true);

  const promises = tasks.map(async (task, i) => {
    const config = configs.get(task.scout);
    if (!config) {
      results[i] = {
        scout: task.scout,
        details: { status: "error", runs: [] },
        content: [{ type: "text" as const, text: `Unknown scout: ${task.scout}` }],
        isError: true,
      };
      emitCombined(true);
      return;
    }

    const result = await executeScout(
      config,
      task.params,
      signal,
      (update) => {
        results[i] = {
          scout: task.scout,
          details: update.details ?? results[i].details,
          content: update.content ?? results[i].content,
          isError: false,
        };
        emitCombined();
      },
      ctx,
    );

    results[i] = {
      scout: task.scout,
      details: result.details,
      content: result.content,
      isError: result.isError,
    };
    emitCombined(true);
  });

  await Promise.allSettled(promises);

  const overallStatus = results.every((r) => r.details.status === "done")
    ? "done" as ScoutStatus
    : results.some((r) => r.details.status === "error")
      ? "error" as ScoutStatus
      : "done" as ScoutStatus;

  const combinedText = results
    .map((r) => `[${r.scout}] ${r.content[0]?.text ?? "(no output)"}`)
    .join("\n\n");

  return {
    content: [{ type: "text", text: combinedText }],
    details: {
      mode: "parallel",
      status: overallStatus,
      results,
    },
    isError: results.some((r) => r.isError),
  };
}

// Error helper

const emptyParallelDetails: ParallelDetails = { mode: "parallel", status: "error", results: [] };

function makeParallelError(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: emptyParallelDetails,
    isError: true as const,
  };
}

// Config resolution

const VALID_SCOUTS = ["finder", "librarian", "specialist"];

const scoutConfigs = new Map<string, ScoutConfig>([
  ["finder", FINDER_CONFIG],
  ["librarian", LIBRARIAN_CONFIG],
]);

async function resolveParallelConfig(
  task: { scout: string; skill?: string; tools?: string[]; query: string },
  cwd: string,
): Promise<ScoutConfig | { error: string }> {
  if (task.scout !== "specialist") {
    const config = scoutConfigs.get(task.scout);
    if (!config) return { error: `Unknown scout: ${task.scout}` };
    return config;
  }

  const skillName = (task.skill ?? "").trim();
  if (!skillName) return { error: "Specialist task requires a skill name." };

  return buildSpecialistConfig(skillName, cwd, { tools: task.tools as any });
}

// Tool definition

const ScoutsParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
      scout: Type.String({
        description: "Scout name: 'finder', 'librarian', or 'specialist'.",
      }),
      query: Type.String({
        description: "The query/task for this scout.",
      }),
      skill: Type.Optional(
        Type.String({ description: "Skill name (specialist only). The specialist loads this as domain expertise." }),
      ),
      tools: Type.Optional(
        Type.Array(
          Type.String({ enum: ["read", "bash", "write", "edit"] }),
          { description: "Tools for the specialist (specialist only). Defaults to [\"read\", \"bash\"]." },
        ),
      ),
      repos: Type.Optional(
        Type.Array(Type.String(), { description: "Repository hints (librarian only)." }),
      ),
      owners: Type.Optional(
        Type.Array(Type.String(), { description: "Owner hints (librarian only)." }),
      ),
      model: ModelParam,
    }),
    {
      description: "Array of scout tasks to run in parallel.",
      minItems: 1,
    },
  ),
});

export const SCOUTS_TOOL: ToolDefinition<any, ParallelDetails> = {
  name: "scouts",
  label: "Scouts",
  description:
    "Run finder, librarian, and specialist scouts in parallel for independent research tasks. Oracle is not available here — call it separately before or after to combine deep analysis with broad reconnaissance. Usually omit per-task `model` overrides unless the user explicitly asked for a specific model/provider.",
  parameters: ScoutsParams,

  async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
    const p = params as { tasks: Array<{ scout: string; query: string; skill?: string; tools?: string[]; repos?: string[]; owners?: string[]; model?: string }> };

    if (!Array.isArray(p.tasks) || p.tasks.length === 0) {
      return makeParallelError("Invalid parameters: expected non-empty `tasks` array.");
    }

    const invalidScouts = [...new Set(
      p.tasks.map((t) => t.scout).filter((s) => !VALID_SCOUTS.includes(s)),
    )];
    if (invalidScouts.length > 0) {
      const hasOracle = invalidScouts.includes("oracle");
      const others = invalidScouts.filter((s) => s !== "oracle");
      const parts: string[] = [];
      if (hasOracle) {
        parts.push("Oracle is not available in parallel scouts — call it separately.");
      }
      if (others.length > 0) {
        parts.push(`Unknown scout(s): ${others.join(", ")}. Available: ${VALID_SCOUTS.join(", ")}.`);
      }
      return makeParallelError(parts.join(" "));
    }

    const resolvedConfigs = new Map<string, ScoutConfig>();
    const resolvedTasks: Array<{ scout: string; params: Record<string, unknown> }> = [];

    for (const t of p.tasks) {
      const configOrError = await resolveParallelConfig(t, ctx.cwd);
      if ("error" in configOrError) {
        return makeParallelError(configOrError.error);
      }

      const configKey = configOrError.name;
      resolvedConfigs.set(configKey, configOrError);

      const taskParams: Record<string, unknown> = {
        query: t.query,
        model: t.model,
      };

      if (t.scout === "specialist") {
        taskParams.task = t.query;
      } else {
        taskParams.repos = t.repos;
        taskParams.owners = t.owners;
      }

      resolvedTasks.push({ scout: configKey, params: taskParams });
    }

    return executeParallelScouts(resolvedConfigs, resolvedTasks, signal, onUpdate, ctx);
  },

  renderCall(args: any, theme: any, context: any) {
    const p = args as { tasks?: Array<{ scout: string; query: string; skill?: string }> };
    const count = Array.isArray(p?.tasks) ? p.tasks.length : 0;
    const scouts = Array.isArray(p?.tasks)
      ? [...new Set(p.tasks.map((t) => t.scout === "specialist" ? `specialist:${t.skill ?? "?"}` : t.scout))].join(", ")
      : "";
    const info = `${count} task${count === 1 ? "" : "s"}${scouts ? ` (${scouts})` : ""}`;
    return renderScoutCall("scouts", args as Record<string, unknown>, theme, info, context);
  },

  renderResult(result: any, options: any, theme: any) {
    return renderParallelResult(result, options, theme);
  },
};
