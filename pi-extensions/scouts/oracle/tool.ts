import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { executeScout } from "../execute.ts";
import { ScoutCall, ScoutResult } from "../render.ts";
import type { ScoutDetails } from "../types.ts";
import { validateQuery } from "../validate.ts";
import { buildOracleConfig, OracleParams } from "./config.ts";

export const ORACLE_TOOL: ToolDefinition<typeof OracleParams, ScoutDetails> = {
  name: "oracle",
  label: "Oracle",
  description:
    "Deep code analysis scout. Use when you need to understand HOW code works — trace data flow, analyze architecture, find patterns, or get implementation details with precise file:line references. Oracle reads code deeply and reasons about it. For finding WHERE code is, use finder instead. Usually omit the optional `model` parameter unless the user explicitly asked for a specific model/provider.",
  parameters: OracleParams,

  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const error = validateQuery(params);
    if (error) return error;
    const config = buildOracleConfig();
    return executeScout(config, params as Record<string, unknown>, signal, onUpdate, ctx);
  },

  renderCall(_args, theme, _context) {
    return new ScoutCall("oracle", { theme });
  },

  renderResult(result, options, theme, context) {
    const component = context.lastComponent instanceof ScoutResult
      ? context.lastComponent
      : new ScoutResult(result, options, theme);
    component.update(result, options, theme, context.invalidate);
    return component;
  },
};
