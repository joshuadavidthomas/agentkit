// Specialist scout config builder — centralizes skill resolution and config construction.
//
// Used by both the specialist tool registration and the parallel scouts dispatcher
// to avoid duplicating the skill resolution + error handling + config building logic.

import { readFileSync } from "node:fs";
import { createBashTool, createEditTool, createReadTool, createWriteTool, DefaultResourceLoader, type Skill } from "@mariozechner/pi-coding-agent";
import { parse as parseYaml } from "yaml";

import type { ScoutConfig } from "./scout-core.ts";
import type { ThinkingLevel } from "./model-selection.ts";
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
  options?: SpecialistConfigOptions,
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
      : {
          openai: ["gpt-5.4", "gpt-5.4-pro"],
          anthropic: ["claude-sonnet-4-6", "claude-opus-4-6"],
          google: ["gemini-3.1-pro-preview", "gemini-2.5-pro"],
          kimi: ["kimi-k2-thinking", "k2p5"],
          zai: ["glm-5", "glm-5.1"],
          minimax: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
          mistral: ["devstral-medium-latest", "mistral-large-latest"],
          xai: ["grok-4", "grok-4-fast"],
        },
    defaultThinkingLevel: (fm["thinking-level"] as ThinkingLevel) || undefined,
    buildSystemPrompt: (maxTurns) => buildSpecialistSystemPrompt(content, maxTurns, match.baseDir),
    buildUserPrompt: buildSpecialistUserPrompt,
    getTools: () => tools.map((t) => toolBuilders[t]()),
  };
}
