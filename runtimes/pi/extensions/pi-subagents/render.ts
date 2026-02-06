/**
 * Rendering functions for subagent results
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getMarkdownTheme, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text, type Widget } from "@mariozechner/pi-tui";
import {
	type AsyncJobState,
	type Details,
	MAX_WIDGET_JOBS,
	WIDGET_KEY,
} from "./types.js";
import { formatTokens, formatUsage, formatDuration, formatToolCallParts, shortenPath } from "./formatters.js";
import { getFinalOutput, getDisplayItems, getOutputTail, getLastActivity } from "./utils.js";

type Theme = ExtensionContext["ui"]["theme"];

// Track last rendered widget state to avoid no-op re-renders
let lastWidgetHash = "";

/**
 * Compute a simple hash of job states for change detection
 */
function computeWidgetHash(jobs: AsyncJobState[]): string {
	return jobs.slice(0, MAX_WIDGET_JOBS).map(job =>
		`${job.asyncId}:${job.status}:${job.currentStep}:${job.updatedAt}:${job.totalTokens?.total ?? 0}`
	).join("|");
}

/**
 * Render the async jobs widget
 */
export function renderWidget(ctx: ExtensionContext, jobs: AsyncJobState[]): void {
	if (!ctx.hasUI) return;
	if (jobs.length === 0) {
		if (lastWidgetHash !== "") {
			lastWidgetHash = "";
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
		return;
	}

	// Check if anything changed since last render
	// Always re-render if any displayed job is running (output tail updates constantly)
	const displayedJobs = jobs.slice(0, MAX_WIDGET_JOBS);
	const hasRunningJobs = displayedJobs.some(job => job.status === "running");
	const newHash = computeWidgetHash(jobs);
	if (!hasRunningJobs && newHash === lastWidgetHash) {
		return; // Skip re-render, nothing changed
	}
	lastWidgetHash = newHash;

	const theme = ctx.ui.theme;
	const lines: string[] = [];
	lines.push(theme.fg("accent", "Async subagents"));

	for (const job of displayedJobs) {
		const id = job.asyncId.slice(0, 6);
		const status =
			job.status === "complete"
				? theme.fg("success", "complete")
				: job.status === "failed"
					? theme.fg("error", "failed")
					: theme.fg("warning", "running");

		const stepsTotal = job.stepsTotal ?? (job.agents?.length ?? 1);
		const stepIndex = job.currentStep !== undefined ? job.currentStep + 1 : undefined;
		const stepText = stepIndex !== undefined ? `step ${stepIndex}/${stepsTotal}` : `steps ${stepsTotal}`;
		const endTime = (job.status === "complete" || job.status === "failed") ? (job.updatedAt ?? Date.now()) : Date.now();
		const elapsed = job.startedAt ? formatDuration(endTime - job.startedAt) : "";
		const agentLabel = job.agents ? job.agents.join(" -> ") : (job.mode ?? "single");

		const tokenText = job.totalTokens ? ` | ${formatTokens(job.totalTokens.total)} tok` : "";
		const activityText = job.status === "running" ? getLastActivity(job.outputFile) : "";
		const activitySuffix = activityText ? ` | ${theme.fg("dim", activityText)}` : "";

		lines.push(`- ${id} ${status} | ${agentLabel} | ${stepText}${elapsed ? ` | ${elapsed}` : ""}${tokenText}${activitySuffix}`);

		if (job.status === "running" && job.outputFile) {
			const tail = getOutputTail(job.outputFile, 3);
			for (const line of tail) {
				lines.push(theme.fg("dim", `  > ${line}`));
			}
		}
	}

	ctx.ui.setWidget(WIDGET_KEY, lines);
}

/**
 * Render a subagent result
 */
export function renderSubagentResult(
	result: AgentToolResult<Details>,
	_options: { expanded: boolean },
	theme: Theme,
): Widget {
	const d = result.details;
	if (!d || !d.results.length) {
		const t = result.content[0];
		return new Text(t?.type === "text" ? t.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();

	if (d.mode === "single" && d.results.length === 1) {
		const r = d.results[0];
		const isRunning = r.progress?.status === "running";
		const icon = isRunning
			? theme.fg("warning", "...")
			: r.exitCode === 0
				? theme.fg("success", "ok")
				: theme.fg("error", "X");
		const output = r.truncation?.text || getFinalOutput(r.messages);

		const progressInfo = isRunning && r.progress
			? ` | ${r.progress.toolCount} tools, ${formatTokens(r.progress.tokens)} tok, ${formatDuration(r.progress.durationMs)}`
			: r.progressSummary
				? ` | ${r.progressSummary.toolCount} tools, ${formatTokens(r.progressSummary.tokens)} tok, ${formatDuration(r.progressSummary.durationMs)}`
				: "";

		const c = new Container();
		c.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${progressInfo}`, 0, 0));
		c.addChild(new Spacer(1));
		c.addChild(
			new Text(theme.fg("dim", `Task: ${r.task.slice(0, 150)}${r.task.length > 150 ? "..." : ""}`), 0, 0),
		);
		c.addChild(new Spacer(1));

		const items = getDisplayItems(r.messages);

		// Render items in chronological order: tool calls inline,
		// intermediate text as dim, final text as full markdown output
		for (let i = 0; i < items.length; i++) {
			const item = items[i]!;
			if (item.type === "tool") {
				const { label, summary } = formatToolCallParts(item.name, item.args);
				c.addChild(
					new Text(
						`  ${theme.fg("accent", "▸")} ${theme.fg("toolTitle", label)} ${theme.fg("dim", summary)}`,
						0,
						0,
					),
				);
			} else if (item.type === "text" && item.text.trim()) {
				// Check if this is the last text item — render as full output
				const isLastText = !items.slice(i + 1).some((it) => it.type === "text" && it.text.trim());
				if (isLastText) {
					// Add spacer only if preceded by tool calls (not at start)
					if (i > 0) c.addChild(new Spacer(1));
					c.addChild(new Markdown(item.text, 0, 0, mdTheme));
				} else {
					// Intermediate text — show truncated and dim
					const preview = item.text.trim().split("\n")[0]!.slice(0, 120);
					c.addChild(new Text(theme.fg("dim", preview + (item.text.length > 120 ? "..." : "")), 0, 0));
				}
			}
		}
		c.addChild(new Spacer(1));
		if (r.skills?.length) {
			c.addChild(new Text(theme.fg("dim", `Skills: ${r.skills.join(", ")}`), 0, 0));
		}
		if (r.skillsWarning) {
			c.addChild(new Text(theme.fg("warning", `⚠️ ${r.skillsWarning}`), 0, 0));
		}
		c.addChild(new Text(theme.fg("dim", formatUsage(r.usage, r.model)), 0, 0));
		if (r.sessionFile) {
			c.addChild(new Text(theme.fg("dim", `Session: ${shortenPath(r.sessionFile)}`), 0, 0));
		}

		if (r.artifactPaths) {
			c.addChild(new Text(theme.fg("dim", `Artifacts: ${shortenPath(r.artifactPaths.outputPath)}`), 0, 0));
		}

		if (r.exitCode !== 0 && !isRunning) {
			c.addChild(new Spacer(1));
			if (r.error) {
				const errorPreview = r.error.length > 150 ? r.error.slice(0, 147) + "..." : r.error;
				c.addChild(new Text(theme.fg("error", `Error: ${errorPreview}`), 0, 0));
			}
			c.addChild(new Text(theme.fg("dim", "To investigate:"), 0, 0));
			if (r.artifactPaths?.outputPath) {
				c.addChild(new Text(theme.fg("dim", `  read ${shortenPath(r.artifactPaths.outputPath)}`), 0, 0));
			}
			c.addChild(new Text(theme.fg("dim", `  subagent_status({})`), 0, 0));
		}

		return c;
	}

	const hasRunning = d.progress?.some((p) => p.status === "running") 
		|| d.results.some((r) => r.progress?.status === "running");
	const ok = d.results.filter((r) => r.progress?.status === "completed" || (r.exitCode === 0 && r.progress?.status !== "running")).length;
	const icon = hasRunning
		? theme.fg("warning", "...")
		: ok === d.results.length
			? theme.fg("success", "ok")
			: theme.fg("error", "X");

	const totalSummary =
		d.progressSummary ||
		d.results.reduce(
			(acc, r) => {
				const prog = r.progress || r.progressSummary;
				if (prog) {
					acc.toolCount += prog.toolCount;
					acc.tokens += prog.tokens;
					acc.durationMs =
						d.mode === "chain"
							? acc.durationMs + prog.durationMs
							: Math.max(acc.durationMs, prog.durationMs);
				}
				return acc;
			},
			{ toolCount: 0, tokens: 0, durationMs: 0 },
		);

	const summaryStr =
		totalSummary.toolCount || totalSummary.tokens
			? ` | ${totalSummary.toolCount} tools, ${formatTokens(totalSummary.tokens)} tok, ${formatDuration(totalSummary.durationMs)}`
			: "";

	const modeLabel = d.mode;
	// For parallel-in-chain, show task count (results) for consistency with step display
	// For sequential chains, show logical step count
	const hasParallelInChain = d.chainAgents?.some((a) => a.startsWith("["));
	const totalCount = hasParallelInChain ? d.results.length : (d.totalSteps ?? d.results.length);
	const currentStep = d.currentStepIndex !== undefined ? d.currentStepIndex + 1 : ok + 1;
	const stepInfo = hasRunning ? ` ${currentStep}/${totalCount}` : ` ${ok}/${totalCount}`;
	
	// Build chain visualization: "scout → planner" with status icons
	// Note: Only works correctly for sequential chains. Chains with parallel steps
	// (indicated by "[agent1+agent2]" format) have multiple results per step,
	// breaking the 1:1 mapping between chainAgents and results.
	const chainVis = d.chainAgents?.length && !hasParallelInChain
		? d.chainAgents
				.map((agent, i) => {
					const result = d.results[i];
					const isFailed = result && result.exitCode !== 0 && result.progress?.status !== "running";
					const isComplete = result && result.exitCode === 0 && result.progress?.status !== "running";
					const isCurrent = i === (d.currentStepIndex ?? d.results.length);
					const icon = isFailed
						? theme.fg("error", "✗")
						: isComplete
							? theme.fg("success", "✓")
							: isCurrent && hasRunning
								? theme.fg("warning", "●")
								: theme.fg("dim", "○");
					return `${icon} ${agent}`;
				})
				.join(theme.fg("dim", " → "))
		: null;

	const c = new Container();
	c.addChild(
		new Text(
			`${icon} ${theme.fg("toolTitle", theme.bold(modeLabel))}${stepInfo}${summaryStr}`,
			0,
			0,
		),
	);
	// Show chain visualization
	if (chainVis) {
		c.addChild(new Text(`  ${chainVis}`, 0, 0));
	}

	// === STATIC STEP LAYOUT (like clarification UI) ===
	// Each step gets a fixed section with task/output/status
	// Note: For chains with parallel steps, chainAgents indices don't map 1:1 to results
	// (parallel steps produce multiple results). Fall back to result-based iteration.
	const useResultsDirectly = hasParallelInChain || !d.chainAgents?.length;
	// For parallel mode, use totalSteps if available (tracks all tasks, not just started/completed)
	const stepsToShow = useResultsDirectly ? (d.totalSteps ?? d.results.length) : d.chainAgents!.length;

	const itemLabel = d.mode === "parallel" ? "Task" : "Step";
	c.addChild(new Spacer(1));

	for (let i = 0; i < stepsToShow; i++) {
		const r = d.results[i];
		// Get agent name from result, chainAgents, progress array, or fallback to generic label
		const progressForIndex = d.progress?.find((p) => p.index === i);
		const agentName = useResultsDirectly 
			? (r?.agent || progressForIndex?.agent || `${itemLabel.toLowerCase()}-${i + 1}`)
			: (d.chainAgents![i] || r?.agent || `${itemLabel.toLowerCase()}-${i + 1}`);

		if (!r) {
			// Show pending task with info from progress if available
			const taskPreview = progressForIndex?.task 
				? progressForIndex.task.slice(0, 80) + (progressForIndex.task.length > 80 ? "..." : "")
				: undefined;
			c.addChild(new Text(theme.fg("dim", `  ${itemLabel} ${i + 1}: ${agentName}`), 0, 0));
			if (taskPreview) {
				c.addChild(new Text(theme.fg("dim", `    task: ${taskPreview}`), 0, 0));
			}
			c.addChild(new Text(theme.fg("dim", `    status: ○ pending`), 0, 0));
			c.addChild(new Spacer(1));
			continue;
		}

		const progressFromArray = d.progress?.find((p) => p.index === i) 
			|| d.progress?.find((p) => p.agent === r.agent && p.status === "running");
		const rProg = r.progress || progressFromArray || r.progressSummary;
		const rRunning = rProg?.status === "running";

		const statusIcon = rRunning
			? theme.fg("warning", "●")
			: r.exitCode === 0
				? theme.fg("success", "✓")
				: theme.fg("error", "✗");
		const stats = rProg ? ` | ${rProg.toolCount} tools, ${formatDuration(rProg.durationMs)}` : "";
		const modelDisplay = r.model ? theme.fg("dim", ` (${r.model})`) : "";
		const header = rRunning
			? `${statusIcon} ${itemLabel} ${i + 1}: ${theme.bold(theme.fg("warning", r.agent))}${modelDisplay}${stats}`
			: `${statusIcon} ${itemLabel} ${i + 1}: ${theme.bold(r.agent)}${modelDisplay}${stats}`;
		c.addChild(new Text(header, 0, 0));

		// Task (truncated)
		const taskPreview = r.task.slice(0, 120) + (r.task.length > 120 ? "..." : "");
		c.addChild(new Text(theme.fg("dim", `    task: ${taskPreview}`), 0, 0));

		// Output target (extract from task)
		const outputMatch = r.task.match(/[Oo]utput(?:\s+to)?\s+([^\s]+\.(?:md|txt|json))/);
		if (outputMatch) {
			c.addChild(new Text(theme.fg("dim", `    output: ${outputMatch[1]}`), 0, 0));
		}

		if (r.skills?.length) {
			c.addChild(new Text(theme.fg("dim", `    skills: ${r.skills.join(", ")}`), 0, 0));
		}
		if (r.skillsWarning) {
			c.addChild(new Text(theme.fg("warning", `    ⚠️ ${r.skillsWarning}`), 0, 0));
		}

		if (r.exitCode !== 0 && !rRunning) {
			if (r.error) {
				// Truncate error to first 200 chars for inline display
				const errorPreview = r.error.length > 200 ? r.error.slice(0, 197) + "..." : r.error;
				c.addChild(new Text(theme.fg("error", `    error: ${errorPreview}`), 0, 0));
			}
			if (r.artifactPaths?.outputPath) {
				c.addChild(new Text(theme.fg("dim", `    full output: ${shortenPath(r.artifactPaths.outputPath)}`), 0, 0));
			}
		}

		if (rRunning && rProg) {
			// For parallel: minimal output (just current activity)
			// For chains: more detail since only one runs at a time
			const isParallel = d.mode === "parallel";
			
			if (!isParallel && rProg.skills?.length) {
				c.addChild(new Text(theme.fg("accent", `    skills: ${rProg.skills.join(", ")}`), 0, 0));
			}
			
			// Current tool or most recent
			if (rProg.currentTool) {
				const toolLine = rProg.currentToolArgs
					? `${rProg.currentTool}: ${rProg.currentToolArgs.slice(0, 80)}${rProg.currentToolArgs.length > 80 ? "..." : ""}`
					: rProg.currentTool;
				c.addChild(new Text(theme.fg("dim", `    ${toolLine}`), 0, 0));
			} else if (rProg.recentTools?.length) {
				const t = rProg.recentTools[0]!;
				const args = t.args.slice(0, 80) + (t.args.length > 80 ? "..." : "");
				c.addChild(new Text(theme.fg("dim", `    ${t.tool}: ${args}`), 0, 0));
			}
			
			// Only show more detail for chains (sequential)
			if (!isParallel) {
				if (rProg.recentTools?.length) {
					for (const t of rProg.recentTools.slice(0, 2)) {
						const args = t.args.slice(0, 90) + (t.args.length > 90 ? "..." : "");
						c.addChild(new Text(theme.fg("dim", `      ${t.tool}: ${args}`), 0, 0));
					}
				}
				const recentLines = (rProg.recentOutput ?? []).slice(-3);
				for (const line of recentLines) {
					c.addChild(new Text(theme.fg("dim", `      ${line.slice(0, 100)}${line.length > 100 ? "..." : ""}`), 0, 0));
				}
			}
		}

		c.addChild(new Spacer(1));
	}

	if (d.artifacts) {
		c.addChild(new Text(theme.fg("dim", `Artifacts dir: ${shortenPath(d.artifacts.dir)}`), 0, 0));
	}

	const failedResults = d.results.filter((r) => r.exitCode !== 0 && r.progress?.status !== "running");
	if (failedResults.length > 0) {
		c.addChild(new Spacer(1));
		c.addChild(new Text(theme.fg("dim", `${failedResults.length} task${failedResults.length > 1 ? "s" : ""} failed. To investigate:`), 0, 0));
		for (const fr of failedResults.slice(0, 3)) {
			if (fr.artifactPaths?.outputPath) {
				c.addChild(new Text(theme.fg("dim", `  read ${shortenPath(fr.artifactPaths.outputPath)}`), 0, 0));
			}
		}
		if (failedResults.length > 3) {
			c.addChild(new Text(theme.fg("dim", `  ... and ${failedResults.length - 3} more`), 0, 0));
		}
		if (d.artifacts?.dir) {
			c.addChild(new Text(theme.fg("dim", `  ls ${shortenPath(d.artifacts.dir)}`), 0, 0));
		}
		c.addChild(new Text(theme.fg("dim", `  subagent_status({})`), 0, 0));
	}

	return c;
}
