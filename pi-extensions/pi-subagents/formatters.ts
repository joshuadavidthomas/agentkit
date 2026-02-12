/**
 * Formatting utilities for display output
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Usage, SingleResult } from "./types.js";
import type { ChainStep, SequentialStep } from "./settings.js";
import { isParallelStep } from "./settings.js";

/**
 * Format token count with k suffix for large numbers
 */
export function formatTokens(n: number): string {
	return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

/**
 * Format usage statistics into a compact string
 */
export function formatUsage(u: Usage, model?: string): string {
	const parts: string[] = [];
	if (u.turns) parts.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (u.input) parts.push(`in:${formatTokens(u.input)}`);
	if (u.output) parts.push(`out:${formatTokens(u.output)}`);
	if (u.cacheRead) parts.push(`R${formatTokens(u.cacheRead)}`);
	if (u.cacheWrite) parts.push(`W${formatTokens(u.cacheWrite)}`);
	if (u.cost) parts.push(`$${u.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Build a summary string for a completed/failed chain
 */
export function buildChainSummary(
	steps: ChainStep[],
	results: SingleResult[],
	chainDir: string,
	status: "completed" | "failed",
	failedStep?: { index: number; error: string },
): string {
	// Build step names for display
	const stepNames = steps
		.map((s) => (isParallelStep(s) ? `parallel[${s.parallel.length}]` : (s as SequentialStep).agent))
		.join(" → ");

	// Calculate total duration from results
	const totalDuration = results.reduce((sum, r) => sum + (r.progress?.durationMs || 0), 0);
	const durationStr = formatDuration(totalDuration);

	// Check for progress.md
	const progressPath = path.join(chainDir, "progress.md");
	const hasProgress = fs.existsSync(progressPath);
	const allSkills = new Set<string>();
	for (const r of results) {
		if (r.skills) r.skills.forEach((s) => allSkills.add(s));
	}
	const skillsLine = allSkills.size > 0 ? `🔧 Skills: ${[...allSkills].join(", ")}` : "";

	if (status === "completed") {
		const stepWord = results.length === 1 ? "step" : "steps";
		return `✅ Chain completed: ${stepNames} (${results.length} ${stepWord}, ${durationStr})${skillsLine ? `\n${skillsLine}` : ""}

📋 Progress: ${hasProgress ? progressPath : "(none)"}
📁 Artifacts: ${chainDir}`;
	} else {
		const stepInfo = failedStep ? ` at step ${failedStep.index + 1}` : "";
		const errorInfo = failedStep?.error ? `: ${failedStep.error}` : "";
		
		const failedResults = results.filter(r => r.exitCode !== 0);
		const failedOutputs = failedResults
			.filter(r => r.artifactPaths?.outputPath)
			.map(r => `  ${r.artifactPaths!.outputPath}`)
			.join("\n");
		const outputsSection = failedOutputs ? `\n📄 Failed outputs:\n${failedOutputs}` : "";
		
		return `❌ Chain failed${stepInfo}${errorInfo}${skillsLine ? `\n${skillsLine}` : ""}${outputsSection}

📋 Progress: ${hasProgress ? progressPath : "(none)"}
📁 Artifacts: ${chainDir}`;
	}
}

/**
 * Replace all occurrences of CWD and HOME in a string with short forms.
 * Useful for shortening bash commands that contain full paths.
 */
function shortenPaths(s: string): string {
	const cwd = process.cwd();
	const home = process.env.HOME || "";
	let result = s;
	if (cwd) result = result.replaceAll(cwd, ".");
	if (home) result = result.replaceAll(home, "~");
	return result;
}

/**
 * Format a tool call into label + summary parts for two-color rendering.
 * Label is the tool name, summary is the formatted arguments.
 */
export function formatToolCallParts(name: string, args: Record<string, unknown>): { label: string; summary: string } {
	switch (name) {
		case "bash": {
			const cmd = shortenPaths(((args.command as string) || "").trim());
			const truncated = cmd.length > 100 ? cmd.slice(0, 97) + "..." : cmd;
			return { label: "bash", summary: truncated };
		}
		case "read": {
			const readPath = shortenPath((args.path || args.file_path || "") as string);
			const range = args.offset ? `:${args.offset}` : "";
			return { label: "read", summary: readPath + range };
		}
		case "write": {
			const writePath = shortenPath((args.path || args.file_path || "") as string);
			const lineCount = typeof args.content === "string" ? args.content.split("\n").length : undefined;
			const suffix = lineCount ? ` (${lineCount} lines)` : "";
			return { label: "write", summary: writePath + suffix };
		}
		case "edit": {
			return { label: "edit", summary: shortenPath((args.path || args.file_path || "") as string) };
		}
		case "grep": {
			const pattern = (args.pattern as string) || "";
			const grepPath = shortenPath((args.path || "") as string);
			const truncPattern = pattern.length > 40 ? pattern.slice(0, 37) + "..." : pattern;
			return { label: "grep", summary: `"${truncPattern}" ${grepPath}` };
		}
		case "glob": {
			const globPattern = (args.pattern as string) || "";
			const globPath = args.path ? shortenPath(args.path as string) : "";
			return { label: "glob", summary: globPath ? `${globPattern} in ${globPath}` : globPattern };
		}
		case "ls": {
			return { label: "ls", summary: shortenPath((args.path || ".") as string) };
		}
		default: {
			// Try to find the most meaningful arg
			const previewKeys = ["command", "path", "file_path", "pattern", "query", "url", "task", "search"];
			for (const key of previewKeys) {
				if (args[key] && typeof args[key] === "string") {
					const val = shortenPaths(args[key] as string);
					const truncated = val.length > 80 ? val.slice(0, 77) + "..." : val;
					return { label: name, summary: truncated };
				}
			}
			const s = JSON.stringify(args);
			const truncated = s.length > 60 ? s.slice(0, 57) + "..." : s;
			return { label: name, summary: truncated };
		}
	}
}

/**
 * Format a tool call for display (single string form)
 */
export function formatToolCall(name: string, args: Record<string, unknown>): string {
	const { label, summary } = formatToolCallParts(name, args);
	if (label === "bash") return `$ ${summary}`;
	return `${label} ${summary}`;
}

/**
 * Shorten a path by making it relative to CWD or replacing home directory with ~
 */
export function shortenPath(p: string): string {
	const cwd = process.cwd();
	// Try CWD-relative first (most readable in project context)
	if (cwd && p.startsWith(cwd + "/")) {
		return "./" + p.slice(cwd.length + 1);
	}
	if (p === cwd) return ".";
	const home = process.env.HOME;
	// Only shorten if HOME is defined and non-empty, and path starts with it
	if (home && p.startsWith(home)) {
		return `~${p.slice(home.length)}`;
	}
	return p;
}
