// Scouts extension — registers finder and librarian tools.
//
// Vendored from pi-finder v1.2.2 and pi-librarian v1.1.2, consolidated
// into a single extension with shared infrastructure in scout-core.ts.
//
// Original authors: Anton Kuzmenko
// pi-finder: https://github.com/default-anton/pi-finder
// pi-librarian: https://github.com/default-anton/pi-librarian

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  type ScoutConfig,
  type ScoutDetails,
  executeScout,
  renderScoutCall,
  renderScoutResult,
} from "./scout-core.ts";
import { buildFinderSystemPrompt, buildFinderUserPrompt } from "./finder-prompts.md.ts";
import { buildLibrarianSystemPrompt, buildLibrarianUserPrompt } from "./librarian-prompts.md.ts";

// Finder tool parameters
const FinderParams = Type.Object({
  query: Type.String({
    description: [
      "Describe what to find in the workspace (code + personal files).",
      "Include: (1) specific goal, (2) optional scope hints if known (paths/directories), (3) search hints (keywords/identifiers/filenames/extensions/metadata clues), (4) desired output type (paths, line ranges, directory structure, metadata), (5) what counts as 'found'.",
      "Finder uses rg/fd/ls and read — do not request grep or find.",
      "Examples:",
      "- Code: 'Find where user authentication is implemented. Search under src/auth and src/api for login/auth/authenticate, and return entrypoint + token handling with line ranges.'",
      "- Personal: 'In ~/Documents and ~/Desktop, find my latest trip itinerary PDF and list the top candidate paths with evidence.'",
    ].join("\n"),
  }),
});

// Librarian tool parameters
const DEFAULT_MAX_SEARCH_RESULTS = 30;

const LibrarianParams = Type.Object({
  query: Type.String({
    description: [
      "Describe exactly what to find in GitHub code.",
      "Include known context in the query when you have it (e.g. symbols/behavior, repo or owner hints, ref/branch hints, path hints, and desired output).",
      "Do not guess unknown details; if scope is uncertain, say that explicitly and let Librarian discover it.",
      "The librarian returns concise path-first findings with line-ranged evidence from downloaded files.",
    ].join("\n"),
  }),
  repos: Type.Optional(
    Type.Array(Type.String({ description: "Optional owner/repo filters (e.g. octocat/hello-world)" }), {
      description: "Optional explicit repository scope.",
      maxItems: 30,
    }),
  ),
  owners: Type.Optional(
    Type.Array(Type.String({ description: "Optional owner/org filters" }), {
      description: "Optional owner/org scope.",
      maxItems: 30,
    }),
  ),
  maxSearchResults: Type.Optional(
    Type.Number({
      description: `Maximum GitHub search hits per query (1-100, default ${DEFAULT_MAX_SEARCH_RESULTS})`,
      minimum: 1,
      maximum: 100,
      default: DEFAULT_MAX_SEARCH_RESULTS,
    }),
  ),
});

// Scout configurations
const FINDER_CONFIG: ScoutConfig = {
  name: "finder",
  maxTurns: 6,
  buildSystemPrompt: buildFinderSystemPrompt,
  buildUserPrompt: buildFinderUserPrompt,
  runningMessage: "Searching workspace…",
};

const LIBRARIAN_CONFIG: ScoutConfig = {
  name: "librarian",
  maxTurns: 10,
  async getWorkspace(_ctx: ExtensionContext): Promise<string> {
    const base = "/tmp/pi-librarian";
    await fs.mkdir(base, { recursive: true });
    const workspace = await fs.mkdtemp(path.join(base, "run-"));
    await fs.mkdir(path.join(workspace, "repos"), { recursive: true });
    return workspace;
  },
  buildSystemPrompt: buildLibrarianSystemPrompt,
  buildUserPrompt: buildLibrarianUserPrompt,
  runningMessage: "Searching GitHub…",
};

export default function scoutsExtension(pi: ExtensionAPI) {
  // Finder — local workspace scout
  pi.registerTool({
    name: "finder",
    label: "Finder",
    description:
      "Read-only workspace scout for coding and personal-assistant tasks. Use when exact file/folder locations are unknown, you'd otherwise do exploratory ls/rg/fd/find/grep/read, or you need targeted evidence from large directories. Finder handles the reconnaissance and returns concise, relevant output: Summary, Locations (path:lineStart-lineEnd), Evidence, and Searched.",
    parameters: FinderParams as any,

    async execute(_toolCallId: string, params: unknown, onUpdate: any, ctx: ExtensionContext, signal?: AbortSignal) {
      const rawQuery = (params as any).query;
      const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

      if (!query) {
        return {
          content: [{ type: "text", text: "Invalid parameters: expected `query` to be a non-empty string." }],
          details: { status: "error", runs: [] } satisfies ScoutDetails,
          isError: true,
        };
      }

      return executeScout(FINDER_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      return renderScoutCall("finder", args as Record<string, unknown>, theme);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderScoutResult("finder", result, options, theme, "Searching workspace…");
    },
  });

  // Librarian — GitHub research scout
  pi.registerTool({
    name: "librarian",
    label: "Librarian",
    description:
      "GitHub research scout for coding and personal-assistant tasks. Use when the answer likely lives in GitHub repos, exact repo/path locations are unknown, or you'd otherwise do exploratory gh search/tree probes plus ls/rg/fd/find/grep/read on fetched files. Librarian performs targeted reconnaissance in an isolated workspace and returns concise, path-first findings with line-ranged evidence.",
    parameters: LibrarianParams as any,

    async execute(_toolCallId: string, params: unknown, onUpdate: any, ctx: ExtensionContext, signal?: AbortSignal) {
      const rawQuery = (params as any).query;
      const query = typeof rawQuery === "string" ? rawQuery.trim() : "";

      if (!query) {
        return {
          content: [{ type: "text", text: "Invalid parameters: expected `query` to be a non-empty string." }],
          details: { status: "error", runs: [] } satisfies ScoutDetails,
          isError: true,
        };
      }

      return executeScout(LIBRARIAN_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      const a = args as Record<string, unknown>;
      const repos = Array.isArray(a?.repos) ? a.repos.length : 0;
      const owners = Array.isArray(a?.owners) ? a.owners.length : 0;
      return renderScoutCall("librarian", a, theme, `repos:${repos} owners:${owners}`);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderScoutResult("librarian", result, options, theme, "Searching GitHub…");
    },
  });
}
