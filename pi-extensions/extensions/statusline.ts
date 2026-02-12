/**
 * Starship-style Statusline Extension
 *
 * Custom footer with:
 * - Line 1: Model info, context %, duration, cwd, git branch + status (Starship-style)
 * - Line 2: Cost, token stats
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { truncateToWidth } from "@mariozechner/pi-tui";

const PROVIDER_MAP = {
  "github-copilot": "copilot",
  "google-antigravity": "google",
  "openai-codex": "openai",
} as const;

// Git status symbols following Starship format
const GIT_STATE = {
  CONFLICTED: "=",
  STASHED: "$",
  DELETED: "✘",
  RENAMED: "»",
  MODIFIED: "!",
  STAGED: "+",
  UNTRACKED: "?",
} as const;

const GIT_AHEAD_BEHIND = {
  DIVERGED: "⇕",
  AHEAD: "⇡",
  BEHIND: "⇣",
} as const;

// Order for displaying git state symbols (Starship order)
const GIT_STATE_ORDER = [
  "CONFLICTED",
  "STASHED",
  "DELETED",
  "RENAMED",
  "MODIFIED",
  "STAGED",
  "UNTRACKED",
] as const;

interface GitStatus {
  branch: string | null;
  aheadBehind: (typeof GIT_AHEAD_BEHIND)[keyof typeof GIT_AHEAD_BEHIND] | null;
  states: Set<keyof typeof GIT_STATE>;
}

// Cache for git status
let gitStatusCache: { status: GitStatus | null; timestamp: number } | null = null;
const GIT_CACHE_TTL = 2000; // 2 seconds

function runGit(...args: string[]): string | null {
  try {
    const result = execSync(["git", ...args].join(" "), {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

function getGitStatus(): GitStatus | null {
  // Check cache
  if (gitStatusCache && Date.now() - gitStatusCache.timestamp < GIT_CACHE_TTL) {
    return gitStatusCache.status;
  }

  // Check if we're in a git repo
  if (!runGit("rev-parse", "--git-dir")) {
    gitStatusCache = { status: null, timestamp: Date.now() };
    return null;
  }

  const status: GitStatus = {
    branch: null,
    aheadBehind: null,
    states: new Set(),
  };

  // Get branch name
  status.branch = runGit("branch", "--show-current") || "detached";

  // Get ahead/behind
  const revList = runGit("rev-list", "--left-right", "--count", "@{upstream}...HEAD");
  if (revList) {
    const parts = revList.split(/\s+/);
    if (parts.length === 2) {
      const behind = parseInt(parts[0], 10);
      const ahead = parseInt(parts[1], 10);
      if (ahead > 0 && behind > 0) {
        status.aheadBehind = GIT_AHEAD_BEHIND.DIVERGED;
      } else if (ahead > 0) {
        status.aheadBehind = GIT_AHEAD_BEHIND.AHEAD;
      } else if (behind > 0) {
        status.aheadBehind = GIT_AHEAD_BEHIND.BEHIND;
      }
    }
  }

  // Get porcelain status
  const porcelain = runGit("status", "--porcelain=v1");
  if (porcelain) {
    for (const line of porcelain.split("\n")) {
      if (line.length < 2) continue;
      const index = line[0];
      const worktree = line[1];

      // Check for conflicts
      if (index === "U" || worktree === "U" || (index === "A" && worktree === "A")) {
        status.states.add("CONFLICTED");
        continue;
      }

      // Index changes
      if (index === "R") status.states.add("RENAMED");
      else if (index === "D") status.states.add("DELETED");
      else if ("AMC".includes(index)) status.states.add("STAGED");
      else if (index === "?") status.states.add("UNTRACKED");

      // Worktree changes
      if (worktree === "M") status.states.add("MODIFIED");
      else if (worktree === "D") status.states.add("DELETED");
    }
  }

  // Check for stash
  if (runGit("stash", "list")) {
    status.states.add("STASHED");
  }

  gitStatusCache = { status, timestamp: Date.now() };
  return status;
}

function formatGitStatus(status: GitStatus): string {
  let result = "";

  // States in Starship order
  for (const state of GIT_STATE_ORDER) {
    if (status.states.has(state)) {
      result += GIT_STATE[state];
    }
  }

  // Ahead/behind
  if (status.aheadBehind) {
    result += status.aheadBehind;
  }

  return result;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}m`;
  if (count >= 1_000) return `${Math.floor(count / 1_000)}k`;
  return count.toString();
}

// Sycophantic phrases to count
const SYCOPHANTIC_PHRASES = [
  "you're absolutely right",
  "you're right",
  "great question",
  "excellent point",
  "that's a great idea",
  "brilliant suggestion",
];

function countSycophancy(sessionManager: { getBranch(): Array<{ type: string; message: { role: string; content: Array<{ type: string; text?: string }> } }> }): number {
  let count = 0;

  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;

    for (const block of entry.message.content) {
      if (block.type !== "text" || !block.text) continue;
      const text = block.text.toLowerCase();
      for (const phrase of SYCOPHANTIC_PHRASES) {
        // Count occurrences of each phrase
        let idx = 0;
        while ((idx = text.indexOf(phrase, idx)) !== -1) {
          count++;
          idx += phrase.length;
        }
      }
    }
  }

  return count;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => {
        // Invalidate git cache when branch changes
        gitStatusCache = null;
        tui.requestRender();
      });

      return {
        dispose: unsub,
        invalidate() {
          // Invalidate git cache on manual invalidation
          gitStatusCache = null;
        },
        render(width: number): string[] {
          const state = ctx.sessionManager;
          const model = ctx.model;

          // === LINE 1: Model, context, duration, cwd, git ===
          let line1Parts: string[] = [];

          // Model: "󰚩 claude-sonnet-4 from anthropic" (bold blue)
          if (model) {
            const modelIcon = "󰚩";
            const modelName = model.name || model.id;
            line1Parts.push(
              theme.fg("accent", theme.bold(`${modelIcon} ${modelName.toLowerCase()}`)) +
              theme.fg("dim", " from ") +
              theme.fg("muted", PROVIDER_MAP[model.provider as keyof typeof PROVIDER_MAP] || model.provider)
            );
          }

          // Context percentage with color coding
          // Get last assistant message for context calculation
          const branch = state.getBranch();
          const lastAssistant = branch
            .slice()
            .reverse()
            .find(
              (e) =>
                e.type === "message" &&
                e.message.role === "assistant" &&
                (e.message as AssistantMessage).stopReason !== "aborted"
            );

          if (lastAssistant && lastAssistant.type === "message") {
            const msg = lastAssistant.message as AssistantMessage;
            const contextTokens =
              msg.usage.input + msg.usage.output + msg.usage.cacheRead + msg.usage.cacheWrite;
            const contextWindow = model?.contextWindow || 0;
            const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

            // Color based on percentage (matching your Python script thresholds)
            let contextColor: "success" | "warning" | "error" = "success";
            if (contextPercent >= 65) contextColor = "error";
            else if (contextPercent >= 40) contextColor = "warning";

            const contextStr = ` ${contextPercent.toFixed(0)}%`;
            const contextDetail = `(${formatTokens(contextTokens)}/${formatTokens(contextWindow)})`;

            line1Parts.push(
              theme.fg("dim", "at ") +
              theme.fg(contextColor, theme.bold(contextStr)) +
              " " +
              theme.fg("dim", theme.italic(contextDetail))
            );
          }

          // Sycophancy count (bold yellow)
          const sycophancyCount = countSycophancy(state as any);
          if (sycophancyCount > 0) {
            line1Parts.push(theme.fg("warning", theme.bold(` ${sycophancyCount}`)));
          }

          // Current directory (basename only, bold cyan)
          const cwd = process.cwd();
          const cwdName = cwd.split("/").pop() || cwd;
          line1Parts.push(theme.fg("dim", "in ") + theme.fg("accent", theme.bold(cwdName)));

          // Git branch (bold magenta) and status (bold red)
          const gitStatus = getGitStatus();
          if (gitStatus?.branch) {
            let gitPart = theme.fg("dim", "on ") + theme.fg("muted", theme.bold(` ${gitStatus.branch}`));
            const statusStr = formatGitStatus(gitStatus);
            if (statusStr) {
              gitPart += " " + theme.fg("error", theme.bold(`[${statusStr}]`));
            }
            line1Parts.push(gitPart);
          }

          const line1 = line1Parts.join(" ");

          // === LINE 2: Cost, tokens, model on right ===
          let totalInput = 0;
          let totalOutput = 0;
          let totalCost = 0;

          for (const entry of state.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const msg = entry.message as AssistantMessage;
              totalInput += msg.usage.input;
              totalOutput += msg.usage.output;
              totalCost += msg.usage.cost.total;
            }
          }

          // Check if using subscription (OAuth)
          const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;

          const line2Parts: string[] = [];

          // Cost with subscription indicator
          const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
          line2Parts.push(theme.fg("dim", costStr));

          // Token stats
          if (totalInput || totalOutput) {
            line2Parts.push(theme.fg("dim", `↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)}`));
          }

          const line2 = line2Parts.join(" ");

          // Add extension statuses if any
          const lines = [truncateToWidth(line1, width), truncateToWidth(line2, width)];

          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => text.replace(/[\r\n\t]/g, " ").trim());
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width));
          }

          return lines;
        },
      };
    });
  });

  // Invalidate git cache on turn end (files may have changed)
  pi.on("turn_end", async () => {
    gitStatusCache = null;
  });
}
