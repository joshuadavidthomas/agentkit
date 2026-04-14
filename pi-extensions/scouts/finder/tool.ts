import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { executeScout } from "../execute.ts";
import { ScoutCall, ScoutResult } from "../render.ts";
import type { ScoutDetails } from "../types.ts";
import { validateQuery } from "../validate.ts";
import { FINDER_CONFIG, FinderParams } from "./config.ts";

export const FINDER_TOOL: ToolDefinition<typeof FinderParams, ScoutDetails> = {
  name: "finder",
  label: "Finder",
  description:
    "Read-only workspace scout for coding and personal-assistant tasks. Use when exact file/folder locations are unknown, you'd otherwise do exploratory ls/rg/fd/find/grep/read, or you need targeted evidence from large directories. Finder handles the reconnaissance and returns concise, relevant output: Summary, Locations (path:lineStart-lineEnd), Evidence, and Searched. Usually omit the optional `model` parameter unless the user explicitly asked for a specific model/provider.",
  parameters: FinderParams,

  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const error = validateQuery(params);
    if (error) return error;
    return executeScout(FINDER_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
  },

  renderCall(args, theme, context) {
    return new ScoutCall("finder", args as Record<string, unknown>, theme, undefined, context);
  },

  renderResult(result, options, theme) {
    return new ScoutResult(result, options, theme);
  },
};
