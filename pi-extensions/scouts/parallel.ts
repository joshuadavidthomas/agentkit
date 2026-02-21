// Parallel scout dispatch.
//
// Runs multiple scouts concurrently and aggregates results.
// Each scout gets its own ScoutDetails tracked independently,
// with combined progress updates for the TUI.

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  type ScoutConfig,
  type ScoutDetails,
  type ScoutRunDetails,
  type ScoutStatus,
  computeOverallStatus,
  executeScout,
} from "./scout-core.ts";

export interface ParallelTask {
  scout: string;
  params: Record<string, unknown>;
}

export interface ParallelScoutResult {
  scout: string;
  details: ScoutDetails;
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

export interface ParallelDetails {
  mode: "parallel";
  status: ScoutStatus;
  results: ParallelScoutResult[];
}

export async function executeParallelScouts(
  configs: Map<string, ScoutConfig>,
  tasks: ParallelTask[],
  signal: AbortSignal | undefined,
  onUpdate: ((update: any) => void) | undefined,
  ctx: ExtensionContext,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: ParallelDetails;
  isError: boolean;
}> {
  const results: ParallelScoutResult[] = tasks.map((t) => ({
    scout: t.scout,
    details: { status: "running" as ScoutStatus, runs: [] },
    content: [{ type: "text" as const, text: "(running...)" }],
    isError: false,
  }));

  let lastUpdate = 0;
  const emitCombined = (force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdate < 150) return;
    lastUpdate = now;

    const statuses = results.map((r) => r.details.status);
    const overallStatus: ScoutStatus = statuses.every((s) => s === "done")
      ? "done"
      : statuses.some((s) => s === "running")
        ? "running"
        : statuses.some((s) => s === "error")
          ? "error"
          : "done";

    const combinedText = results
      .map((r) => `[${r.scout}] ${r.content[0]?.text ?? "(no output)"}`)
      .join("\n\n");

    onUpdate?.({
      content: [{ type: "text", text: combinedText }],
      details: {
        mode: "parallel",
        status: overallStatus,
        results,
      } satisfies ParallelDetails,
    });
  };

  emitCombined(true);

  const promises = tasks.map(async (task, i) => {
    const config = configs.get(task.scout);
    if (!config) {
      results[i] = {
        scout: task.scout,
        details: { status: "error", runs: [] },
        content: [{ type: "text" as const, text: `Unknown scout: ${task.scout}` }],
        isError: true,
      };
      emitCombined(true);
      return;
    }

    const result = await executeScout(
      config,
      task.params,
      signal,
      (update) => {
        // Capture intermediate updates for this scout
        results[i] = {
          scout: task.scout,
          details: update.details ?? results[i].details,
          content: update.content ?? results[i].content,
          isError: false,
        };
        emitCombined();
      },
      ctx,
    );

    results[i] = {
      scout: task.scout,
      details: result.details,
      content: result.content,
      isError: result.isError,
    };
    emitCombined(true);
  });

  await Promise.allSettled(promises);

  const overallStatus = results.every((r) => r.details.status === "done")
    ? "done" as ScoutStatus
    : results.some((r) => r.details.status === "error")
      ? "error" as ScoutStatus
      : "done" as ScoutStatus;

  const combinedText = results
    .map((r) => `[${r.scout}] ${r.content[0]?.text ?? "(no output)"}`)
    .join("\n\n");

  return {
    content: [{ type: "text", text: combinedText }],
    details: {
      mode: "parallel",
      status: overallStatus,
      results,
    },
    isError: results.some((r) => r.isError),
  };
}
