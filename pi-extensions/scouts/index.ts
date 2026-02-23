// Scouts extension — registers finder, librarian, and oracle tools.
//
// Finder and librarian originally vendored from pi-finder v1.2.2 and
// pi-librarian v1.1.2, consolidated into a single extension with shared
// infrastructure in scout-core.ts.
//
// Original authors: Anton Kuzmenko
// pi-finder: https://github.com/default-anton/pi-finder
// pi-librarian: https://github.com/default-anton/pi-librarian

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  type ScoutConfig,
  type ScoutDetails,
  executeScout,
  renderParallelResult,
  renderScoutCall,
  renderScoutResult,
} from "./scout-core.ts";
import { executeParallelScouts } from "./parallel.ts";
import { buildFinderSystemPrompt, buildFinderUserPrompt } from "./finder-prompts.md.ts";
import { createGitHubTools } from "./github-tools.ts";
import { createGrepGitHubTool } from "./grep-app-tool.ts";
import { buildLibrarianSystemPrompt, buildLibrarianUserPrompt } from "./librarian-prompts.md.ts";
import { buildOracleSystemPrompt, buildOracleUserPrompt } from "./oracle-prompts.md.ts";
import { createReadOnlyBashTool } from "./read-only-bash.ts";
import { createWebSearchTool, createWebFetchTool } from "./web-tools.ts";

// Shared parameter: model override
const ModelParam = Type.Optional(
  Type.String({
    description: "Model override. Specify a model ID (e.g. 'claude-opus-4-6', 'gpt-5.3-codex', 'gemini-3.1-pro') to use a specific model instead of the scout's default.",
  }),
);

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
  model: ModelParam,
});

// Librarian tool parameters
const DEFAULT_MAX_SEARCH_RESULTS = 30;

const LibrarianParams = Type.Object({
  query: Type.String({
    description: [
      "Describe what to research — code in GitHub repos, web documentation, or both.",
      "Include known context: repo/owner hints for GitHub, specific URLs or technologies for web research.",
      "Do not guess unknown details; if scope is uncertain, say that explicitly and let Librarian discover it.",
      "The librarian returns concise findings with citations and evidence.",
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
  model: ModelParam,
});

// Oracle tool parameters
const OracleParams = Type.Object({
  query: Type.String({
    description: [
      "Describe what to analyze in the codebase.",
      "Include: specific goal, relevant files/components if known, what kind of analysis (trace data flow, explain architecture, find patterns, review implementation).",
      "Oracle reads code deeply and reasons about it. Use for questions that need understanding, not just location.",
      "Examples:",
      "- 'Trace the request lifecycle through the auth middleware in src/auth/. How does token validation work?'",
      "- 'Analyze the caching strategy in pkg/cache/. What are the eviction policies and edge cases?'",
      "- 'Find all implementations of the Repository pattern and show how they handle errors.'",
    ].join("\n"),
  }),
  model: ModelParam,
});

// Scout configurations
const FINDER_CONFIG: ScoutConfig = {
  name: "finder",
  maxTurns: 6,
  defaultModel: "claude-haiku-4-5",
  buildSystemPrompt: buildFinderSystemPrompt,
  buildUserPrompt: buildFinderUserPrompt,
};

const LIBRARIAN_CONFIG: ScoutConfig = {
  name: "librarian",
  maxTurns: 12,
  defaultModel: "claude-haiku-4-5",
  buildSystemPrompt: buildLibrarianSystemPrompt,
  buildUserPrompt: buildLibrarianUserPrompt,
  getTools: () => [
    createGrepGitHubTool(),
    ...createGitHubTools(),
    createWebSearchTool(),
    createWebFetchTool(),
  ],
};

const ORACLE_CONFIG: ScoutConfig = {
  name: "oracle",
  maxTurns: 12,
  defaultModel: "claude-opus-4-6",
  buildSystemPrompt: buildOracleSystemPrompt,
  buildUserPrompt: buildOracleUserPrompt,
};

// Helper: validate query param, return error result or null
function validateQuery(params: unknown): { content: Array<{ type: "text"; text: string }>; details: ScoutDetails; isError: true } | null {
  const rawQuery = (params as any).query;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    return {
      content: [{ type: "text", text: "Invalid parameters: expected `query` to be a non-empty string." }],
      details: { status: "error", runs: [] } satisfies ScoutDetails,
      isError: true,
    };
  }
  return null;
}

export default function scoutsExtension(pi: ExtensionAPI) {
  // Finder — local workspace scout
  pi.registerTool({
    name: "finder",
    label: "Finder",
    description:
      "Read-only workspace scout for coding and personal-assistant tasks. Use when exact file/folder locations are unknown, you'd otherwise do exploratory ls/rg/fd/find/grep/read, or you need targeted evidence from large directories. Finder handles the reconnaissance and returns concise, relevant output: Summary, Locations (path:lineStart-lineEnd), Evidence, and Searched.",
    parameters: FinderParams as any,

    async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
      const error = validateQuery(params);
      if (error) return error;
      return executeScout(FINDER_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      return renderScoutCall("finder", args as Record<string, unknown>, theme);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderScoutResult("finder", result, options, theme);
    },
  });

  // Librarian — GitHub research scout
  pi.registerTool({
    name: "librarian",
    label: "Librarian",
    description:
      "External research scout for coding and personal-assistant tasks. Use when the answer lives outside the local workspace — in GitHub repos, web documentation, or both. Librarian can search GitHub code, read repo files, search the web, and fetch page content. Use for API research, finding implementations in other repos, reading docs, or any question requiring external sources.",
    parameters: LibrarianParams as any,

    async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
      const error = validateQuery(params);
      if (error) return error;
      return executeScout(LIBRARIAN_CONFIG, params as Record<string, unknown>, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      const a = args as Record<string, unknown>;
      const repos = Array.isArray(a?.repos) ? a.repos.length : 0;
      const owners = Array.isArray(a?.owners) ? a.owners.length : 0;
      return renderScoutCall("librarian", a, theme, `repos:${repos} owners:${owners}`);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderScoutResult("librarian", result, options, theme);
    },
  });

  // Oracle — deep code analysis scout
  pi.registerTool({
    name: "oracle",
    label: "Oracle",
    description:
      "Deep code analysis scout. Use when you need to understand HOW code works — trace data flow, analyze architecture, find patterns, or get implementation details with precise file:line references. Oracle reads code deeply and reasons about it. For finding WHERE code is, use finder instead.",
    parameters: OracleParams as any,

    async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
      const error = validateQuery(params);
      if (error) return error;

      // Oracle gets read-only bash + read, scoped to the workspace
      const oracleConfig: ScoutConfig = {
        ...ORACLE_CONFIG,
        getTools: () => [
          createReadOnlyBashTool(ctx.cwd),
          createReadTool(ctx.cwd),
        ],
      };

      return executeScout(oracleConfig, params as Record<string, unknown>, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      return renderScoutCall("oracle", args as Record<string, unknown>, theme);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderScoutResult("oracle", result, options, theme);
    },
  });

  // Scouts — parallel dispatch
  const scoutConfigs = new Map<string, ScoutConfig>([
    ["finder", FINDER_CONFIG],
    ["librarian", LIBRARIAN_CONFIG],
    // Oracle config is built dynamically with ctx.cwd, handled in execute below
  ]);

  const ScoutsParams = Type.Object({
    tasks: Type.Array(
      Type.Object({
        scout: Type.String({
          description: "Scout name: 'finder', 'librarian', or 'oracle'.",
        }),
        query: Type.String({
          description: "The query/task for this scout.",
        }),
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

  pi.registerTool({
    name: "scouts",
    label: "Scouts",
    description:
      "Run multiple scouts in parallel. Use when you need to fire off several independent research/analysis tasks simultaneously — e.g. search GitHub for one thing while analyzing local code for another. Each task should be independent; avoid running multiple instances of the same scout on the same codebase (use one scout with a broader query instead).",
    parameters: ScoutsParams as any,

    async execute(_toolCallId: string, params: unknown, signal: any, onUpdate: any, ctx: any) {
      const p = params as { tasks: Array<{ scout: string; query: string; repos?: string[]; owners?: string[]; model?: string }> };

      if (!Array.isArray(p.tasks) || p.tasks.length === 0) {
        return {
          content: [{ type: "text", text: "Invalid parameters: expected non-empty `tasks` array." }],
          details: { mode: "parallel", status: "error", results: [] },
          isError: true,
        };
      }

      // Build configs map with oracle (needs ctx.cwd for read-only tools)
      const configs = new Map(scoutConfigs);
      configs.set("oracle", {
        ...ORACLE_CONFIG,
        getTools: () => [
          createReadOnlyBashTool(ctx.cwd),
          createReadTool(ctx.cwd),
        ],
      });

      const tasks = p.tasks.map((t) => ({
        scout: t.scout,
        params: {
          query: t.query,
          repos: t.repos,
          owners: t.owners,
          model: t.model,
        } as Record<string, unknown>,
      }));

      return executeParallelScouts(configs, tasks, signal, onUpdate, ctx);
    },

    renderCall(args: any, theme: any) {
      const p = args as { tasks?: Array<{ scout: string; query: string }> };
      const count = Array.isArray(p?.tasks) ? p.tasks.length : 0;
      const scouts = Array.isArray(p?.tasks)
        ? [...new Set(p.tasks.map((t) => t.scout))].join(", ")
        : "";
      const info = `${count} task${count === 1 ? "" : "s"}${scouts ? ` (${scouts})` : ""}`;
      return renderScoutCall("scouts", args as Record<string, unknown>, theme, info);
    },

    renderResult(result: any, options: any, theme: any) {
      return renderParallelResult(result, options, theme);
    },
  });
}
