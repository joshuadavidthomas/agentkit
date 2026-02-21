// Web search and content extraction tools for the librarian scout.
//
// Wraps the brave-search skill scripts (search.js, content.js) as proper
// typed AgentTools. Requires BRAVE_API_KEY environment variable.

import { execFile } from "node:child_process";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// Resolve the brave-search skill directory relative to this extension
function getBraveSearchDir(): string {
  // Walk up from pi-extensions/scouts/ to repo root, then into skills/brave-search/
  return path.resolve(import.meta.dirname, "../../skills/brave-search");
}

function execScript(
  script: string,
  args: string[],
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const child = execFile(
      "node",
      [script, ...args],
      {
        maxBuffer: 5 * 1024 * 1024,
        timeout: 60_000,
        env: { ...process.env },
      },
      (error, stdout, stderr) => {
        if (signal?.aborted) {
          reject(new Error("Aborted"));
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (error as any).code ?? 1 : 0,
        });
      },
    );

    if (signal) {
      const onAbort = () => child.kill();
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => signal.removeEventListener("abort", onAbort));
    }
  });
}

function toolError(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
    isError: true,
  };
}

function toolOk(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

// Web search tool
const webSearchSchema = Type.Object({
  query: Type.String({
    description: "Search query. Use specific terms, not natural language questions.",
  }),
  numResults: Type.Optional(
    Type.Number({
      description: "Number of results (default: 5, max: 20).",
      minimum: 1,
      maximum: 20,
    }),
  ),
  content: Type.Optional(
    Type.Boolean({
      description: "Fetch and include page content as markdown for each result. Slower but more thorough.",
    }),
  ),
  freshness: Type.Optional(
    Type.String({
      description: "Filter by time: 'pd' (past day), 'pw' (past week), 'pm' (past month), 'py' (past year), or 'YYYY-MM-DDtoYYYY-MM-DD' for a date range.",
    }),
  ),
  country: Type.Optional(
    Type.String({
      description: "Two-letter country code for regional results (default: US).",
    }),
  ),
});

export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
  return {
    name: "webSearch",
    label: "webSearch",
    description:
      "Search the web using Brave Search. Returns titles, links, snippets, and optionally full page content as markdown. Use for documentation, API references, current information, and facts not available in code.",
    parameters: webSearchSchema,

    async execute(_toolCallId, params, signal) {
      if (!process.env.BRAVE_API_KEY) {
        return toolError("BRAVE_API_KEY environment variable is not set. Cannot perform web searches.");
      }

      const args: string[] = [params.query];

      if (params.numResults) {
        args.push("-n", String(params.numResults));
      }
      if (params.content) {
        args.push("--content");
      }
      if (params.freshness) {
        args.push("--freshness", params.freshness);
      }
      if (params.country) {
        args.push("--country", params.country);
      }

      const scriptPath = path.join(getBraveSearchDir(), "search.js");
      const result = await execScript(scriptPath, args, signal);

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || result.stdout.trim();
        return toolError(`Web search failed: ${msg}`);
      }

      const output = result.stdout.trim();
      if (!output) {
        return toolOk("No results found.");
      }

      return toolOk(output);
    },
  };
}

// Web content extraction tool
const webFetchSchema = Type.Object({
  url: Type.String({
    description: "URL to fetch and extract readable content from.",
  }),
});

export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
  return {
    name: "webFetch",
    label: "webFetch",
    description:
      "Fetch a web page and extract its readable content as markdown. Use to read documentation pages, blog posts, or any URL discovered via webSearch.",
    parameters: webFetchSchema,

    async execute(_toolCallId, params, signal) {
      const scriptPath = path.join(getBraveSearchDir(), "content.js");
      const result = await execScript(scriptPath, [params.url], signal);

      if (result.exitCode !== 0) {
        const msg = result.stderr.trim() || result.stdout.trim();
        return toolError(`Failed to fetch ${params.url}: ${msg}`);
      }

      const output = result.stdout.trim();
      if (!output) {
        return toolError(`No readable content extracted from ${params.url}`);
      }

      return toolOk(output);
    },
  };
}
