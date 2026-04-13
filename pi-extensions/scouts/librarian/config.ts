import { Type } from "@sinclair/typebox";

import type { ScoutConfig } from "../types.ts";
import { FAST_MODELS } from "../models.ts";
import { ModelParam } from "../validate.ts";
import { buildLibrarianSystemPrompt, buildLibrarianUserPrompt } from "./prompt.ts";
import { createGrepGitHubTool } from "./tools/grep-app.ts";
import { createGitHubTools } from "./tools/github.ts";
import { createWebSearchTool, createWebFetchTool } from "./tools/web.ts";

const DEFAULT_MAX_SEARCH_RESULTS = 30;

export const LibrarianParams = Type.Object({
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

export const LIBRARIAN_CONFIG: ScoutConfig = {
  name: "librarian",
  maxTurns: 12,
  defaultModel: "claude-haiku-4-5",
  familyModelCandidates: FAST_MODELS,
  buildSystemPrompt: buildLibrarianSystemPrompt,
  buildUserPrompt: buildLibrarianUserPrompt,
  getTools: () => [
    createGrepGitHubTool(),
    ...createGitHubTools(),
    createWebSearchTool(),
    createWebFetchTool(),
  ],
};
