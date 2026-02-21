// Read-only bash tool for the oracle scout.
//
// Wraps pi's createBashTool but rejects commands that could modify
// the workspace. Only allows a known set of read-only commands.

import { createBashTool } from "@mariozechner/pi-coding-agent";

// Commands the oracle is allowed to run
const ALLOWED_COMMANDS = new Set([
  "rg", "fd", "ls", "cat", "wc", "head", "tail", "file", "stat", "nl",
  "find", "tree", "du", "grep", "awk", "sed", "sort", "uniq", "cut",
  "tr", "diff", "comm", "tee", "xargs", "echo", "printf", "test",
  "basename", "dirname", "realpath", "readlink",
]);

// Patterns that indicate mutation regardless of the command
const MUTATION_PATTERNS = [
  /\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln)\b/,
  /\b(git\s+(commit|push|checkout|reset|clean|stash|merge|rebase|pull|add|init))\b/,
  /\b(npm|npx|yarn|pnpm|bun|pip|cargo|go)\s+(install|add|remove|run|build|publish)\b/,
  /\b(make|cmake|ninja)\b/,
  /[>|]\s*tee\b/,  // tee used for writing
  />\s*[^&]/,       // output redirection (but not >&2)
  /\bsudo\b/,
  /\bcurl\b.*-[^s]*[oO]/,  // curl with -o/-O (download to file)
  /\bwget\b/,
];

function extractLeadCommand(command: string): string | null {
  const trimmed = command.trim();
  // Handle env vars, cd prefixes, etc.
  const match = trimmed.match(/^(?:(?:cd\s+\S+\s*&&\s*)|(?:\w+=\S+\s+))*(\w[\w.-]*)/);
  return match?.[1] ?? null;
}

function isReadOnly(command: string): { ok: boolean; reason?: string } {
  // Check mutation patterns first
  for (const pattern of MUTATION_PATTERNS) {
    if (pattern.test(command)) {
      return { ok: false, reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }

  // For piped commands, check each segment
  const segments = command.split(/[|;]/).map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    // Handle subshells and command substitution loosely — check the inner command
    const inner = segment.replace(/^\(+/, "").replace(/\)+$/, "").trim();
    const lead = extractLeadCommand(inner);

    if (!lead) continue;

    // Allow && and || chains by checking each part
    const parts = inner.split(/\s*(?:&&|\|\|)\s*/);
    for (const part of parts) {
      const partLead = extractLeadCommand(part);
      if (partLead && !ALLOWED_COMMANDS.has(partLead)) {
        return { ok: false, reason: `Command '${partLead}' is not in the read-only allowlist` };
      }
    }
  }

  return { ok: true };
}

export function createReadOnlyBashTool(cwd: string) {
  const baseTool = createBashTool(cwd);

  return {
    ...baseTool,
    name: "bash",
    description: "Execute read-only bash commands (rg, fd, ls, cat, wc, head, tail, file, stat, nl, find, tree, grep, sort, uniq, cut, diff). No writes, installs, or mutations allowed.",

    async execute(toolCallId: string, params: any, signal: any, onUpdate: any) {
      const command = typeof params?.command === "string" ? params.command : "";

      const check = isReadOnly(command);
      if (!check.ok) {
        return {
          content: [{ type: "text" as const, text: `Blocked: ${check.reason}. Oracle operates in read-only mode.` }],
          details: {},
          isError: true,
        };
      }

      return baseTool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
