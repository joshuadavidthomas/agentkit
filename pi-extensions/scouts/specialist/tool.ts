import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { executeScout } from "../execute.ts";
import { renderScoutCall, renderScoutResult } from "../render.ts";
import type { ScoutDetails } from "../types.ts";
import { makeErrorResult } from "../validate.ts";
import { buildSpecialistConfig, SpecialistParams } from "./config.ts";

export const SPECIALIST_TOOL: ToolDefinition<any, ScoutDetails> = {
  name: "specialist",
  label: "Specialist",
  description:
    "Skill-powered domain expert. Load any installed skill as domain expertise and dispatch a task. The specialist reads the skill, becomes an expert, and applies that expertise to your task. Defaults to read-only tools (read, bash). Pass tools: [\"read\", \"bash\", \"write\", \"edit\"] for tasks that need to modify files. Use for delegating work that requires specific domain knowledge — code review styles, framework patterns, documentation standards, or any skill in ~/.agents/skills/ or ~/.pi/agent/skills/. Usually omit the optional `model` parameter unless the user explicitly asked for a specific model/provider.",
  parameters: SpecialistParams,

  async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
    const p = params as { skill: string; task: string; tools?: string[]; model?: string };
    const skillName = (p.skill ?? "").trim();
    const task = (p.task ?? "").trim();

    if (!skillName) {
      return makeErrorResult("Missing required parameter: skill");
    }

    if (!task) {
      return makeErrorResult("Missing required parameter: task");
    }

    const configOrError = await buildSpecialistConfig(skillName, ctx.cwd, {
      configName: "specialist",
      tools: p.tools as any,
    });

    if ("error" in configOrError) {
      return makeErrorResult(configOrError.error);
    }

    return executeScout(
      configOrError,
      { ...p, task, query: task },
      signal,
      onUpdate,
      ctx,
    );
  },

  renderCall(args: any, theme: any, context: any) {
    const p = args as { skill?: string; task?: string };
    const skill = p?.skill ?? "unknown";
    const task = (p?.task ?? "").trim();
    const expanded = context?.expanded ?? false;
    const preview = expanded ? task : (task.length > 60 ? task.slice(0, 57) + "..." : task);
    return renderScoutCall("specialist", args as Record<string, unknown>, theme, `skill:${skill} · ${preview}`, context);
  },

  renderResult(result: any, options: any, theme: any) {
    return renderScoutResult("specialist", result, options, theme);
  },
};
