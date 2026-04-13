import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { createBashTool, createEditTool, createReadTool, createWriteTool, DefaultResourceLoader, type Skill } from "@mariozechner/pi-coding-agent";
import { parse as parseYaml } from "yaml";

import type { ScoutConfig } from "../types.ts";
import type { ThinkingLevel } from "../models.ts";
import { HEAVY_MODELS } from "../models.ts";
import { ModelParam } from "../validate.ts";
import { buildSpecialistSystemPrompt, buildSpecialistUserPrompt } from "./prompt.ts";

export type SpecialistTool = "read" | "bash" | "write" | "edit";

export const SpecialistParams = Type.Object({
  skill: Type.String({
    description: [
      "Name of the skill to load as domain expertise.",
      "The specialist becomes an expert in this skill and applies it to the task.",
      "Use listAvailableSkills to discover what's installed.",
    ].join("\n"),
  }),
  task: Type.String({
    description: [
      "The task for the specialist to execute using the loaded skill.",
      "Be specific about what you want analyzed, reviewed, created, or investigated.",
    ].join("\n"),
  }),
  tools: Type.Optional(
    Type.Array(
      Type.String({ enum: ["read", "bash", "write", "edit"] }),
      { description: "Tools the specialist can use. Defaults to [\"read\", \"bash\"]. Add \"write\" and \"edit\" for tasks that need to modify files." },
    ),
  ),
  model: ModelParam,
});

const DEFAULT_TOOLS: SpecialistTool[] = ["read", "bash"];

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return parseYaml(match[1]) ?? {};
  } catch {
    return {};
  }
}

async function discoverSkills(cwd: string): Promise<Skill[]> {
  const loader = new DefaultResourceLoader({ cwd, noExtensions: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  return loader.getSkills().skills;
}

export async function buildSpecialistConfig(
  skillName: string,
  cwd: string,
  options?: { configName?: string; tools?: SpecialistTool[] },
): Promise<ScoutConfig | { error: string }> {
  const trimmed = skillName.trim();

  if (!trimmed) {
    return { error: "Specialist requires a skill name." };
  }

  const allSkills = await discoverSkills(cwd);
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

  const fm = parseFrontmatter(content);
  const configName = options?.configName ?? `specialist:${trimmed}`;
  const tools = options?.tools ?? DEFAULT_TOOLS;

  const toolBuilders: Record<SpecialistTool, () => any> = {
    read: () => createReadTool(cwd),
    bash: () => createBashTool(cwd),
    write: () => createWriteTool(cwd),
    edit: () => createEditTool(cwd),
  };

  const frontmatterModel = fm.model as string | undefined;

  return {
    name: configName,
    maxTurns: 16,
    defaultModel: frontmatterModel || "anthropic/claude-sonnet-4-6",
    familyModelCandidates: frontmatterModel
      ? undefined
      : HEAVY_MODELS,
    defaultThinkingLevel: (fm["thinking-level"] as ThinkingLevel) || undefined,
    buildSystemPrompt: (maxTurns) => buildSpecialistSystemPrompt(content, maxTurns, match.baseDir),
    buildUserPrompt: buildSpecialistUserPrompt,
    getTools: () => tools.map((t) => toolBuilders[t]()),
  };
}
