// Specialist scout config builder — centralizes skill resolution and config construction.
//
// Used by both the specialist tool registration and the parallel scouts dispatcher
// to avoid duplicating the skill resolution + error handling + config building logic.

import { readFileSync } from "node:fs";
import { createBashTool, createEditTool, createReadTool, createWriteTool, loadSkills, type Skill } from "@mariozechner/pi-coding-agent";

import type { ScoutConfig } from "./scout-core.ts";
import { buildSpecialistSystemPrompt, buildSpecialistUserPrompt } from "./specialist-prompts.md.ts";

export type SpecialistTool = "read" | "bash" | "write" | "edit";

const DEFAULT_TOOLS: SpecialistTool[] = ["read", "bash"];

export interface SpecialistConfigOptions {
  // Optional config name override. Defaults to "specialist" for single-use,
  // or "specialist:<skillName>" for parallel execution (to distinguish multiple specialists).
  configName?: string;
  // Which tools to give the specialist. Defaults to ["read", "bash"].
  tools?: SpecialistTool[];
}

function discoverSkills(cwd: string): Skill[] {
  const { skills } = loadSkills({ cwd });
  return skills;
}

export function buildSpecialistConfig(
  skillName: string,
  cwd: string,
  options?: SpecialistConfigOptions,
): ScoutConfig | { error: string } {
  const trimmed = skillName.trim();

  if (!trimmed) {
    return { error: "Specialist requires a skill name." };
  }

  const allSkills = discoverSkills(cwd);
  const match = allSkills.find((s) => s.name === trimmed);

  if (!match) {
    const names = allSkills.map((s) => s.name);
    const suggestion = names.length > 0 ? ` Available: ${names.join(", ")}` : "";
    return { error: `Skill not found: ${trimmed}.${suggestion}` };
  }

  let content: string;
  try {
    content = readFileSync(match.filePath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to read ${match.filePath}: ${message}` };
  }

  const configName = options?.configName ?? `specialist:${trimmed}`;
  const tools = options?.tools ?? DEFAULT_TOOLS;

  const toolBuilders: Record<SpecialistTool, () => any> = {
    read: () => createReadTool(cwd),
    bash: () => createBashTool(cwd),
    write: () => createWriteTool(cwd),
    edit: () => createEditTool(cwd),
  };

  return {
    name: configName,
    maxTurns: 16,
    defaultModel: "claude-sonnet-4-5",
    buildSystemPrompt: (maxTurns) => buildSpecialistSystemPrompt(content, maxTurns, match.baseDir),
    buildUserPrompt: buildSpecialistUserPrompt,
    getTools: () => tools.map((t) => toolBuilders[t]()),
  };
}
