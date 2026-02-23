/**
 * Skill Usage Tracker
 *
 * Tracks how often skills are loaded by intercepting `read` tool calls
 * for SKILL.md files. Persists cumulative stats to ~/.pi/agent/skill-usage.json.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, basename, dirname, isAbsolute } from "node:path";
import { homedir } from "node:os";

const USAGE_FILE = resolve(homedir(), ".pi", "agent", "skill-usage.json");

interface SkillRecord {
  count: number;
  lastUsed: string;
  firstUsed: string;
}

function loadUsageData(): Record<string, SkillRecord> {
  try {
    return JSON.parse(readFileSync(USAGE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveUsageData(data: Record<string, SkillRecord>): void {
  try {
    const dir = dirname(USAGE_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

function extractSkillName(filePath: string, cwd: string): string | null {
  let abs = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  if (abs === "~" || abs.startsWith("~/")) {
    abs = homedir() + abs.slice(1);
  }
  if (!isAbsolute(abs)) {
    abs = resolve(cwd, abs);
  }
  if (basename(abs) !== "SKILL.md") return null;
  return basename(dirname(abs));
}

export default function (pi: ExtensionAPI) {
  const data = loadUsageData();

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read" || event.isError) return;

    const path = (event.input as { path?: string })?.path;
    if (!path) return;

    const skill = extractSkillName(path, ctx.cwd);
    if (!skill) return;

    const now = new Date().toISOString();
    const existing = data[skill];
    data[skill] = {
      count: (existing?.count ?? 0) + 1,
      lastUsed: now,
      firstUsed: existing?.firstUsed ?? now,
    };
    saveUsageData(data);
  });
}
