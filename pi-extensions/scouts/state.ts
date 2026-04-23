// Shared state helpers for scout execution and result shaping.

import type { ScoutDetails } from "./types.ts";

type ScoutStatus = ScoutDetails["status"];
type ScoutRunDetails = ScoutDetails["runs"][number];

export function createInitialRun(query: string): ScoutRunDetails {
  return {
    status: "running",
    query,
    turns: 0,
    displayItems: [],
    activityPhase: "thinking",
    startedAt: Date.now(),
  };
}

export function createRunningScoutDetails(query: string): ScoutDetails {
  return {
    mode: "single",
    status: "running",
    runs: [createInitialRun(query)],
  };
}

export function createErrorScoutDetails(query: string, error: string): ScoutDetails {
  const run = createInitialRun(query);
  run.status = "error";
  run.error = error;
  run.summaryText = error;
  run.endedAt = Date.now();

  return {
    mode: "single",
    status: "error",
    runs: [run],
  };
}

export function computeOverallStatus(runs: ScoutRunDetails[]): ScoutStatus {
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "error")) return "error";
  if (runs.length > 0 && runs.every((run) => run.status === "aborted")) return "aborted";
  return "done";
}
