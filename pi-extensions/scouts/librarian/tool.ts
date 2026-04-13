import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { executeScout } from "../execute.ts";
import { renderScoutCall, renderScoutResult } from "../render.ts";
import type { ScoutDetails } from "../types.ts";
import { validateQuery } from "../validate.ts";
import { LIBRARIAN_CONFIG, LibrarianParams } from "./config.ts";

export const LIBRARIAN_TOOL: ToolDefinition<any, ScoutDetails> = {
  name: "librarian",
  label: "Librarian",
  description:
    "External research scout for coding and personal-assistant tasks. Use when the answer lives outside the local workspace — in GitHub repos, web documentation, or both. Librarian can search GitHub code, read repo files, search the web, and fetch page content. Use for API research, finding implementations in other repos, reading docs, or any question requiring external sources. Usually omit the optional `model` parameter unless the user explicitly asked for a specific model/provider.",
  parameters: LibrarianParams,

  async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
    const error = validateQuery(params);
    if (error) return error;
    return executeScout(LIBRARIAN_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
  },

  renderCall(args: any, theme: any, context: any) {
    const a = args as Record<string, unknown>;
    const repos = Array.isArray(a?.repos) ? a.repos.length : 0;
    const owners = Array.isArray(a?.owners) ? a.owners.length : 0;
    return renderScoutCall("librarian", a, theme, `repos:${repos} owners:${owners}`, context);
  },

  renderResult(result: any, options: any, theme: any) {
    return renderScoutResult("librarian", result, options, theme);
  },
};
