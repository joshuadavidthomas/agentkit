/**
 * Skill resolution and caching for subagent extension
 * 
 * Uses pi's SettingsManager to respect user-configured skill paths.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

export interface ResolvedSkill {
	name: string;
	path: string;
	content: string;
	source: "project" | "user" | "settings";
}

interface SkillCacheEntry {
	mtime: number;
	skill: ResolvedSkill;
}

const skillCache = new Map<string, SkillCacheEntry>();
const MAX_CACHE_SIZE = 50;

// Lazy-initialized settings manager
let settingsManager: SettingsManager | null = null;

function getSettingsManager(cwd: string): SettingsManager {
	if (!settingsManager) {
		settingsManager = SettingsManager.create(cwd);
	}
	return settingsManager;
}

/**
 * Get all skill search paths in priority order.
 * Returns: project paths, then settings paths, then default global path.
 */
function getSkillSearchPaths(cwd: string): Array<{ basePath: string; source: "project" | "user" | "settings" }> {
	const paths: Array<{ basePath: string; source: "project" | "user" | "settings" }> = [];
	
	// 1. Project path (highest priority)
	paths.push({ 
		basePath: path.resolve(cwd, ".pi", "skills"), 
		source: "project" 
	});
	
	// 2. User-configured paths from settings (middle priority)
	try {
		const settings = getSettingsManager(cwd);
		const settingsPaths = settings.getSkillPaths();
		for (const p of settingsPaths) {
			// Expand ~ to home directory
			const expanded = p.startsWith("~") 
				? path.join(os.homedir(), p.slice(1))
				: p;
			paths.push({ basePath: expanded, source: "settings" });
		}
	} catch {
		// Settings not available, continue with defaults
	}
	
	// 3. Default global path (lowest priority)
	paths.push({ 
		basePath: path.join(os.homedir(), ".pi", "agent", "skills"), 
		source: "user" 
	});
	
	return paths;
}

function stripSkillFrontmatter(content: string): string {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---")) return normalized;

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) return normalized;

	return normalized.slice(endIndex + 4).trim();
}

export function resolveSkillPath(
	skillName: string,
	cwd: string,
): { path: string; source: "project" | "user" | "settings" } | undefined {
	const searchPaths = getSkillSearchPaths(cwd);
	
	for (const { basePath, source } of searchPaths) {
		// Check for SKILL.md in subdirectory (standard format)
		const skillDirPath = path.join(basePath, skillName, "SKILL.md");
		if (fs.existsSync(skillDirPath)) {
			return { path: skillDirPath, source };
		}
		
		// Also check for direct .md file (flat format)
		const skillFilePath = path.join(basePath, `${skillName}.md`);
		if (fs.existsSync(skillFilePath)) {
			return { path: skillFilePath, source };
		}
	}

	return undefined;
}

export function readSkill(
	skillName: string,
	skillPath: string,
	source: "project" | "user" | "settings",
): ResolvedSkill | undefined {
	try {
		const stat = fs.statSync(skillPath);
		const cached = skillCache.get(skillPath);
		if (cached && cached.mtime === stat.mtimeMs) {
			return cached.skill;
		}

		const raw = fs.readFileSync(skillPath, "utf-8");
		const content = stripSkillFrontmatter(raw);
		const skill: ResolvedSkill = {
			name: skillName,
			path: skillPath,
			content,
			source,
		};

		skillCache.set(skillPath, { mtime: stat.mtimeMs, skill });
		if (skillCache.size > MAX_CACHE_SIZE) {
			const firstKey = skillCache.keys().next().value;
			if (firstKey) skillCache.delete(firstKey);
		}

		return skill;
	} catch {
		return undefined;
	}
}

export function resolveSkills(
	skillNames: string[],
	cwd: string,
): { resolved: ResolvedSkill[]; missing: string[] } {
	const resolved: ResolvedSkill[] = [];
	const missing: string[] = [];

	for (const name of skillNames) {
		const trimmed = name.trim();
		if (!trimmed) continue;

		const location = resolveSkillPath(trimmed, cwd);
		if (!location) {
			missing.push(trimmed);
			continue;
		}

		const skill = readSkill(trimmed, location.path, location.source);
		if (skill) {
			resolved.push(skill);
		} else {
			missing.push(trimmed);
		}
	}

	return { resolved, missing };
}

export function buildSkillInjection(skills: ResolvedSkill[]): string {
	if (skills.length === 0) return "";

	return skills
		.map((s) => `<skill name="${s.name}">\n${s.content}\n</skill>`)
		.join("\n\n");
}

export function normalizeSkillInput(
	input: string | string[] | boolean | undefined,
): string[] | false | undefined {
	if (input === false) return false;
	if (input === true || input === undefined) return undefined;
	if (Array.isArray(input)) {
		// Deduplicate while preserving order
		return [...new Set(input.map((s) => s.trim()).filter((s) => s.length > 0))];
	}
	// Deduplicate while preserving order
	return [...new Set(input.split(",").map((s) => s.trim()).filter((s) => s.length > 0))];
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function extractDescription(skillPath: string): string | undefined {
	try {
		const content = fs.readFileSync(skillPath, "utf-8");
		if (content.startsWith("---")) {
			const endIndex = content.indexOf("\n---", 3);
			if (endIndex !== -1) {
				const fmBlock = content.slice(0, endIndex);
				const match = fmBlock.match(/description:\s*(.+)/);
				if (match) {
					let desc = match[1].trim();
					if (
						(desc.startsWith("\"") && desc.endsWith("\"")) ||
						(desc.startsWith("'") && desc.endsWith("'"))
					) {
						desc = desc.slice(1, -1);
					}
					return desc;
				}
			}
		}
	} catch {}
	return undefined;
}

export function discoverAvailableSkills(cwd: string): Array<{
	name: string;
	source: "project" | "user" | "settings";
	description?: string;
}> {
	const skills: Array<{ name: string; source: "project" | "user" | "settings"; description?: string }> = [];
	const seen = new Set<string>();
	const searchPaths = getSkillSearchPaths(cwd);

	// Reverse order so higher priority paths override lower priority
	const reversedPaths = [...searchPaths].reverse();

	for (const { basePath, source } of reversedPaths) {
		if (!fs.existsSync(basePath)) continue;

		try {
			const entries = fs.readdirSync(basePath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(basePath, entry.name);

				// Check for directory with SKILL.md
				const isDir = entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(fullPath));
				if (isDir) {
					const skillPath = path.join(fullPath, "SKILL.md");
					if (!fs.existsSync(skillPath)) continue;

					// Remove existing entry if this source has higher priority
					if (seen.has(entry.name)) {
						const idx = skills.findIndex((s) => s.name === entry.name);
						if (idx !== -1) skills.splice(idx, 1);
					}

					skills.push({ 
						name: entry.name, 
						source, 
						description: extractDescription(skillPath) 
					});
					seen.add(entry.name);
				}
				// Check for direct .md file (flat format)
				else if (entry.name.endsWith(".md") && entry.isFile()) {
					const skillName = entry.name.slice(0, -3);
					if (!skillName) continue;

					if (seen.has(skillName)) {
						const idx = skills.findIndex((s) => s.name === skillName);
						if (idx !== -1) skills.splice(idx, 1);
					}

					skills.push({ 
						name: skillName, 
						source, 
						description: extractDescription(fullPath) 
					});
					seen.add(skillName);
				}
			}
		} catch {}
	}

	return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function clearSkillCache(): void {
	skillCache.clear();
}

/**
 * Reset the settings manager (useful for testing or after settings change)
 */
export function resetSettingsManager(): void {
	settingsManager = null;
}
