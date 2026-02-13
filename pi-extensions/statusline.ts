/**
 * Starship-style Statusline Extension
 *
 * Custom footer with:
 * - Line 1: Model info, context %, duration, cwd, VCS status (Starship-style)
 * - Line 2: Cost, token stats
 *
 * Supports both git and jj (Jujutsu) version control systems.
 * In colocated repos (.jj/ + .git/), jj takes priority.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { truncateToWidth } from "@mariozechner/pi-tui";

const PROVIDER_MAP = {
  "github-copilot": "copilot",
  "google-antigravity": "google",
  "openai-codex": "openai",
} as const;

// VCS types
type VcsType = "git" | "jj";

// Shared VCS state flags
const VCS_STATE = {
  CONFLICTED: "=",
  STASHED: "$",
  DELETED: "✘",
  RENAMED: "»",
  MODIFIED: "!",
  STAGED: "+",
  UNTRACKED: "?",
  EMPTY: "∅",
} as const;

type VcsStateKey = keyof typeof VCS_STATE;

const VCS_AHEAD_BEHIND = {
  DIVERGED: "⇕",
  AHEAD: "⇡",
  BEHIND: "⇣",
} as const;

// Display order for state symbols (Starship order, with EMPTY at end)
const VCS_STATE_ORDER: VcsStateKey[] = [
  "CONFLICTED",
  "STASHED",
  "DELETED",
  "RENAMED",
  "MODIFIED",
  "STAGED",
  "UNTRACKED",
  "EMPTY",
];

interface VcsStatus {
  vcs: VcsType;
  identifier: string;              // git: branch name, jj: short change ID
  label?: string;                  // jj: bookmark name if present
  aheadBehind: (typeof VCS_AHEAD_BEHIND)[keyof typeof VCS_AHEAD_BEHIND] | null;
  states: Set<VcsStateKey>;
}

// VCS status cache
let vcsStatusCache: { status: VcsStatus | null; timestamp: number } | null = null;
const VCS_CACHE_TTL = 2000; // 2 seconds

function runCmd(cmd: string, ...args: string[]): string | null {
  try {
    const result = execSync([cmd, ...args].join(" "), {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

// VCS detection

function detectVcs(): VcsType | null {
  // .jj/ means jj repo — even colocated repos should use jj
  if (existsSync(join(process.cwd(), ".jj"))) return "jj";
  if (runCmd("git", "rev-parse", "--git-dir")) return "git";
  return null;
}

// Git provider

function getGitStatus(): VcsStatus | null {
  const status: VcsStatus = {
    vcs: "git",
    identifier: "detached",
    aheadBehind: null,
    states: new Set(),
  };

  // Branch name
  status.identifier = runCmd("git", "branch", "--show-current") || "detached";

  // Ahead/behind
  const revList = runCmd("git", "rev-list", "--left-right", "--count", "@{upstream}...HEAD");
  if (revList) {
    const parts = revList.split(/\s+/);
    if (parts.length === 2) {
      const behind = parseInt(parts[0], 10);
      const ahead = parseInt(parts[1], 10);
      if (ahead > 0 && behind > 0) {
        status.aheadBehind = VCS_AHEAD_BEHIND.DIVERGED;
      } else if (ahead > 0) {
        status.aheadBehind = VCS_AHEAD_BEHIND.AHEAD;
      } else if (behind > 0) {
        status.aheadBehind = VCS_AHEAD_BEHIND.BEHIND;
      }
    }
  }

  // Porcelain status
  const porcelain = runCmd("git", "status", "--porcelain=v1");
  if (porcelain) {
    for (const line of porcelain.split("\n")) {
      if (line.length < 2) continue;
      const index = line[0];
      const worktree = line[1];

      if (index === "U" || worktree === "U" || (index === "A" && worktree === "A")) {
        status.states.add("CONFLICTED");
        continue;
      }

      if (index === "R") status.states.add("RENAMED");
      else if (index === "D") status.states.add("DELETED");
      else if ("AMC".includes(index)) status.states.add("STAGED");
      else if (index === "?") status.states.add("UNTRACKED");

      if (worktree === "M") status.states.add("MODIFIED");
      else if (worktree === "D") status.states.add("DELETED");
    }
  }

  // Stash
  if (runCmd("git", "stash", "list")) {
    status.states.add("STASHED");
  }

  return status;
}

// jj provider

function getJjStatus(): VcsStatus | null {
  // Single template call to get change ID, bookmarks, conflict, empty status
  const template = [
    'change_id.shortest()',
    '"\\n"',
    'if(bookmarks, bookmarks.join(","), "")',
    '"\\n"',
    'if(conflict, "true", "false")',
    '"\\n"',
    'if(empty, "true", "false")',
  ].join(" ++ ");

  const logOutput = runCmd("jj", "log", "-r", "@", "--no-graph", "-T", `'${template}'`);
  if (!logOutput) return null;

  const lines = logOutput.split("\n");
  if (lines.length < 4) return null;

  const changeId = lines[0].trim();
  const bookmarks = lines[1].trim();
  const hasConflict = lines[2].trim() === "true";
  const isEmpty = lines[3].trim() === "true";

  const status: VcsStatus = {
    vcs: "jj",
    identifier: changeId,
    label: bookmarks || undefined,
    aheadBehind: null,
    states: new Set(),
  };

  if (hasConflict) status.states.add("CONFLICTED");
  if (isEmpty) status.states.add("EMPTY");

  // File-level status from jj diff --summary
  const diffSummary = runCmd("jj", "diff", "--summary");
  if (diffSummary) {
    for (const line of diffSummary.split("\n")) {
      if (!line.trim()) continue;
      const code = line[0];
      if (code === "M") status.states.add("MODIFIED");
      else if (code === "D") status.states.add("DELETED");
      else if (code === "A") status.states.add("UNTRACKED"); // new files in jj
      else if (code === "R") status.states.add("RENAMED");
    }
  }

  return status;
}

// Shared formatting

function formatVcsStates(status: VcsStatus): string {
  let result = "";

  for (const state of VCS_STATE_ORDER) {
    // Skip git-only states for jj, skip jj-only states for git
    if (status.vcs === "jj" && (state === "STASHED" || state === "STAGED")) continue;
    if (status.vcs === "git" && state === "EMPTY") continue;

    if (status.states.has(state)) {
      result += VCS_STATE[state];
    }
  }

  if (status.aheadBehind) {
    result += status.aheadBehind;
  }

  return result;
}

function getVcsStatus(): VcsStatus | null {
  // Check cache
  if (vcsStatusCache && Date.now() - vcsStatusCache.timestamp < VCS_CACHE_TTL) {
    return vcsStatusCache.status;
  }

  const vcsType = detectVcs();
  let status: VcsStatus | null = null;

  if (vcsType === "git") {
    status = getGitStatus();
  } else if (vcsType === "jj") {
    status = getJjStatus();
  }

  vcsStatusCache = { status, timestamp: Date.now() };
  return status;
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
        vcsStatusCache = null;
        tui.requestRender();
      });

      return {
        dispose: unsub,
        invalidate() {
          vcsStatusCache = null;
        },
        render(width: number): string[] {
          const state = ctx.sessionManager;
          const model = ctx.model;

          // === LINE 1: Model, context, duration, cwd, VCS ===
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

            let contextColor: "success" | "warning" | "error" = "success";
            if (contextPercent >= 65) contextColor = "error";
            else if (contextPercent >= 40) contextColor = "warning";

            const contextStr = ` ${contextPercent.toFixed(0)}%`;
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
            line1Parts.push(theme.fg("warning", theme.bold(` ${sycophancyCount}`)));
          }

          // Current directory (basename only, bold cyan)
          const cwd = process.cwd();
          const cwdName = cwd.split("/").pop() || cwd;
          line1Parts.push(theme.fg("dim", "in ") + theme.fg("accent", theme.bold(cwdName)));

          // VCS status
          const vcsStatus = getVcsStatus();
          if (vcsStatus) {
            const vcsIcon = vcsStatus.vcs === "jj" ? "" : "";
            let vcsPart = theme.fg("dim", "on ") +
              theme.fg("muted", theme.bold(`${vcsIcon} ${vcsStatus.identifier}`));

            // jj: show bookmark label after change ID
            if (vcsStatus.label) {
              vcsPart += " " + theme.fg("dim", vcsStatus.label);
            }

            const statusStr = formatVcsStates(vcsStatus);
            if (statusStr) {
              vcsPart += " " + theme.fg("error", theme.bold(`[${statusStr}]`));
            }
            line1Parts.push(vcsPart);
          }

          const line1 = line1Parts.join(" ");

          // === LINE 2: Cost, tokens ===
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

          const usingSubscription = model ? ctx.modelRegistry.isUsingOAuth(model) : false;

          const line2Parts: string[] = [];

          const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
          line2Parts.push(theme.fg("dim", costStr));

          if (totalInput || totalOutput) {
            line2Parts.push(theme.fg("dim", `↑${formatTokens(totalInput)} ↓${formatTokens(totalOutput)}`));
          }

          const line2 = line2Parts.join(" ");

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

  // Invalidate VCS cache on turn end (files may have changed)
  pi.on("turn_end", async () => {
    vcsStatusCache = null;
  });
}
