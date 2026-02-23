// Web search and content extraction tools for the librarian scout.
//
// webSearch wraps the brave-search skill script (search.js) as a typed
// AgentTool and requires the BRAVE_API_KEY environment variable.
//
// webFetch implements content extraction inline using Readability + Turndown
// (no external scripts, no API key needed).

import { execFile } from "node:child_process";
import * as path from "node:path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
// @ts-ignore — turndown-plugin-gfm has no type declarations
import { gfm } from "turndown-plugin-gfm";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

// Resolve the brave-search skill directory relative to this extension
function getBraveSearchDir(): string {
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

// Convert HTML to clean markdown using Turndown with GFM support
function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  turndown.use(gfm);
  turndown.addRule("removeEmptyLinks", {
    filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
    replacement: () => "",
  });
  return turndown
    .turndown(html)
    .replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
    .replace(/ +/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Fetch a URL and extract readable content as markdown
async function fetchWebContent(
  url: string,
  signal?: AbortSignal,
): Promise<{ title?: string; content: string }> {
  const timeoutSignal = AbortSignal.timeout(15_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: combinedSignal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();

  // Primary: Readability extraction
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  if (article?.content) {
    return {
      title: article.title || undefined,
      content: htmlToMarkdown(article.content),
    };
  }

  // Fallback: strip non-content elements, find main content area
  const fallbackDom = new JSDOM(html, { url });
  const doc = fallbackDom.window.document;
  doc
    .querySelectorAll("script, style, noscript, nav, header, footer, aside")
    .forEach((el) => el.remove());

  const title = doc.querySelector("title")?.textContent?.trim();
  const main =
    doc.querySelector("main, article, [role='main'], .content, #content") ||
    doc.body;
  const mainHtml = main?.innerHTML || "";

  if (mainHtml.trim().length > 100) {
    return {
      title: title || undefined,
      content: htmlToMarkdown(mainHtml),
    };
  }

  throw new Error("Could not extract readable content from this page.");
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
      try {
        const { title, content } = await fetchWebContent(params.url, signal);
        const parts: string[] = [];
        if (title) {
          parts.push(`# ${title}\n`);
        }
        parts.push(content);
        const output = parts.join("\n").trim();
        return output ? toolOk(output) : toolError(`No readable content extracted from ${params.url}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return toolError(`Failed to fetch ${params.url}: ${msg}`);
      }
    },
  };
}
