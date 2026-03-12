// Specialist scout config builder — centralizes skill resolution and config construction.
//
// Used by both the specialist tool registration and the parallel scouts dispatcher
// to avoid duplicating the skill resolution + error handling + config building logic.

import { createBashTool, createEditTool, createReadTool, createWriteTool } from "@mariozechner/pi-coding-agent";

import type { ScoutConfig } from "./scout-core.ts";
import { buildSpecialistSystemPrompt, buildSpecialistUserPrompt } from "./specialist-prompts.md.ts";
import { resolveSkill, listAvailableSkills } from "./skill-resolver.ts";

export interface SpecialistConfigOptions {
  // Optional config name override. Defaults to "specialist" for single-use,
  // or "specialist:<skillName>" for parallel execution (to distinguish multiple specialists).
  configName?: string;
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

  const result = resolveSkill(trimmed, cwd);

  if (result.status === "invalid-name") {
    return { error: `Invalid skill name: ${result.reason}` };
  }

  if (result.status === "read-error") {
    return { error: `Failed to read ${result.path}: ${result.error.message}` };
  }

  if (result.status === "not-found") {
    const { skills } = listAvailableSkills(cwd);
    const suggestion = skills.length > 0
      ? ` Available: ${skills.join(", ")}`
      : "";
    return { error: `Skill not found: ${trimmed}.${suggestion}` };
  }

  const configName = options?.configName ?? `specialist:${trimmed}`;

  return {
    name: configName,
    maxTurns: 16,
    defaultModel: "claude-sonnet-4-5",
    buildSystemPrompt: (maxTurns) => buildSpecialistSystemPrompt(result.skill.content, maxTurns),
    buildUserPrompt: buildSpecialistUserPrompt,
    getTools: () => [
      createReadTool(cwd),
      createBashTool(cwd),
      createWriteTool(cwd),
      createEditTool(cwd),
    ],
  };
}
