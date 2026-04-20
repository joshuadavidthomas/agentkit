// Parallel scouts — tool definition and execution engine.
//
// Dispatches finder, librarian, and specialist concurrently via Promise.allSettled.
// Each scout gets its own ScoutDetails tracked independently, with combined
// progress updates for the TUI.

import { Type, type Static } from "@sinclair/typebox";
import type { ToolDefinition, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { executeScout } from "./execute.ts";
import { ParallelScoutsResult, ScoutCall } from "./render.ts";
import type { ParallelDetails, ScoutConfig, ScoutDetails } from "./types.ts";

type ParallelScoutResult = ParallelDetails["results"][number];
type ScoutStatus = ScoutDetails["status"];
import { ModelParam } from "./validate.ts";
import { FINDER_CONFIG } from "./finder/config.ts";
import { LIBRARIAN_CONFIG } from "./librarian/config.ts";
import { buildSpecialistConfig, type SpecialistTool } from "./specialist/config.ts";

function buildParallelSnapshot(results: ParallelScoutResult[]): {
  content: Array<{ type: "text"; text: string }>;
  details: ParallelDetails;
  isError: boolean;
} {
  const content = [{
    type: "text" as const,
    text: results
      .map((result) => `[${result.scout}] ${result.content[0]?.text ?? "(no output)"}`)
      .join("\n\n"),
  }];

  let status: ScoutStatus = "done";
  if (results.some((result) => result.details.status === "running")) {
    status = "running";
  } else if (results.some((result) => result.details.status === "error")) {
    status = "error";
  }

  return {
    content,
    details: {
      mode: "parallel",
      status,
      results,
    },
    isError: results.some((result) => result.isError),
  };
}

const emptyParallelDetails: ParallelDetails = { mode: "parallel", status: "error", results: [] };

function makeParallelError(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: emptyParallelDetails,
    isError: true as const,
  };
}

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

  return buildSpecialistConfig(skillName, cwd, { tools: task.tools as SpecialistTool[] | undefined });
}

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

export const SCOUTS_TOOL: ToolDefinition<typeof ScoutsParams, ParallelDetails> = {
  name: "scouts",
  label: "Scouts",
  description:
    "Run finder, librarian, and specialist scouts in parallel for independent research tasks. Oracle is not available here — call it separately before or after to combine deep analysis with broad reconnaissance. Usually omit per-task `model` overrides unless the user explicitly asked for a specific model/provider.",
  parameters: ScoutsParams,

  async execute(
    _toolCallId: string,
    params: Static<typeof ScoutsParams>,
    signal: AbortSignal | undefined,
    onUpdate: ((update: ReturnType<typeof buildParallelSnapshot>) => void) | undefined,
    ctx: ExtensionContext,
  ) {
    const p = params;

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

    const results: ParallelScoutResult[] = resolvedTasks.map((task) => ({
      scout: task.scout,
      details: { mode: "single", status: "running", runs: [] },
      content: [{ type: "text" as const, text: "(running...)" }],
      isError: false,
    }));

    const publishParallelSnapshot = () => {
      onUpdate?.(buildParallelSnapshot(results));
    };

    publishParallelSnapshot();

    const promises = resolvedTasks.map(async (task, i) => {
      const config = resolvedConfigs.get(task.scout);
      if (!config) {
        results[i] = {
          scout: task.scout,
          details: { mode: "single", status: "error", runs: [] },
          content: [{ type: "text" as const, text: `Unknown scout: ${task.scout}` }],
          isError: true,
        };
        publishParallelSnapshot();
        return;
      }

      const result = await executeScout(
        config,
        task.params,
        signal,
        (update) => {
          results[i] = {
            scout: task.scout,
            details: update.details,
            content: update.content,
            isError: false,
          };
          publishParallelSnapshot();
        },
        ctx,
      );

      results[i] = {
        scout: task.scout,
        details: result.details,
        content: result.content,
        isError: result.isError,
      };
      publishParallelSnapshot();
    });

    await Promise.allSettled(promises);

    return buildParallelSnapshot(results);
  },

  renderCall(args, theme, context) {
    const p = args as { tasks?: Array<{ scout: string; query: string; skill?: string }> };
    const count = Array.isArray(p?.tasks) ? p.tasks.length : 0;
    const scouts = Array.isArray(p?.tasks)
      ? [...new Set(p.tasks.map((t) => t.scout === "specialist" ? `specialist:${t.skill ?? "?"}` : t.scout))].join(", ")
      : "";
    const info = `${count} task${count === 1 ? "" : "s"}${scouts ? ` (${scouts})` : ""}`;
    return new ScoutCall("scouts", args as Record<string, unknown>, theme, info, context);
  },

  renderResult(result, options, theme, context) {
    const component = context.lastComponent instanceof ParallelScoutsResult
      ? context.lastComponent
      : new ParallelScoutsResult(result, options, theme);
    component.update(result, options, theme, context.invalidate);
    return component;
  },
};
