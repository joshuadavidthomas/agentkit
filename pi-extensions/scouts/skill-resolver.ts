// Resolve a skill name to its SKILL.md content.
//
// Searches the same directories pi uses for skill discovery:
//   ~/.agents/skills/<name>/SKILL.md
//   ~/.pi/agent/skills/<name>/SKILL.md
//   .pi/skills/<name>/SKILL.md (from cwd, walking up)
//   .agents/skills/<name>/SKILL.md (from cwd, walking up)

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import os from "node:os";

const SKILL_FILENAME = "SKILL.md";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export interface ResolvedSkill {
  name: string;
  path: string;
  content: string;
}

export type ResolveResult =
  | { status: "found"; skill: ResolvedSkill }
  | { status: "not-found"; searchedDirs: string[] }
  | { status: "invalid-name"; reason: string }
  | { status: "read-error"; path: string; error: Error };

export interface ListResult {
  skills: string[];
  errors: Array<{ dir: string; error: Error }>;
}

function validateSkillName(name: string): string | null {
  if (!name) return "Skill name cannot be empty.";
  if (name.includes("/") || name.includes("\\")) return "Skill name cannot contain path separators.";
  if (name.startsWith(".")) return "Skill name cannot start with a dot.";
  if (!SKILL_NAME_PATTERN.test(name)) return `Skill name must match ${SKILL_NAME_PATTERN} (lowercase, hyphens, underscores).`;
  return null;
}

function getSkillSearchDirs(cwd: string): string[] {
  const home = os.homedir();
  const dirs: string[] = [
    join(home, ".agents", "skills"),
    join(home, ".pi", "agent", "skills"),
  ];

  // Walk up from cwd looking for .pi/skills and .agents/skills
  let current = resolve(cwd);
  while (true) {
    dirs.push(join(current, ".pi", "skills"));
    dirs.push(join(current, ".agents", "skills"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
}

export function resolveSkill(name: string, cwd: string): ResolveResult {
  const invalid = validateSkillName(name);
  if (invalid) return { status: "invalid-name", reason: invalid };

  const searchDirs = getSkillSearchDirs(cwd);
  const searched: string[] = [];

  for (const dir of searchDirs) {
    const skillPath = join(dir, name, SKILL_FILENAME);
    searched.push(dir);

    if (existsSync(skillPath)) {
      try {
        const content = readFileSync(skillPath, "utf-8");
        return { status: "found", skill: { name, path: skillPath, content } };
      } catch (err) {
        return { status: "read-error", path: skillPath, error: err as Error };
      }
    }
  }

  return { status: "not-found", searchedDirs: searched };
}

export function listAvailableSkills(cwd: string): ListResult {
  const searchDirs = getSkillSearchDirs(cwd);
  const seen = new Set<string>();
  const errors: Array<{ dir: string; error: Error }> = [];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const skillPath = join(dir, entry.name, SKILL_FILENAME);
        if (existsSync(skillPath) && !seen.has(entry.name)) {
          seen.add(entry.name);
        }
      }
    } catch (err) {
      errors.push({ dir, error: err as Error });
    }
  }

  return { skills: [...seen].sort(), errors };
}
