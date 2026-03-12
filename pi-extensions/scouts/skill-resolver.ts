// Resolve a skill name to its SKILL.md content.
//
// Searches the same directories pi uses for skill discovery:
//   ~/.agents/skills/<name>/SKILL.md
//   ~/.pi/agent/skills/<name>/SKILL.md
//   .pi/skills/<name>/SKILL.md (from cwd, walking up)
//   .agents/skills/<name>/SKILL.md (from cwd, walking up)
//
// Also checks pi packages for installed skills.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import os from "node:os";

const SKILL_FILENAME = "SKILL.md";

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

export interface ResolvedSkill {
  name: string;
  path: string;
  content: string;
}

export function resolveSkill(name: string, cwd: string): ResolvedSkill | null {
  const searchDirs = getSkillSearchDirs(cwd);

  for (const dir of searchDirs) {
    const skillPath = join(dir, name, SKILL_FILENAME);
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, "utf-8");
      return { name, path: skillPath, content };
    }
  }

  return null;
}

export function listAvailableSkills(cwd: string): string[] {
  const searchDirs = getSkillSearchDirs(cwd);
  const seen = new Set<string>();

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
    } catch {
      // skip inaccessible directories
    }
  }

  return [...seen].sort();
}
