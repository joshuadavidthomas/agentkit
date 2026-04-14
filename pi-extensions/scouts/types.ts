// Shared types for scout subagents.

import type { ThinkingLevel } from "@mariozechner/pi-ai";

import type { ScoutWorkload } from "./models.ts";

export type ScoutStatus = "running" | "done" | "error" | "aborted";

// Interleaved display items — tool calls and text, in chronological order
export type DisplayItem =
  | { type: "tool"; name: string; args: Record<string, unknown>; isError?: boolean; toolCallId?: string; result?: string }
  | { type: "text"; text: string };

export interface ScoutRunDetails {
  status: ScoutStatus;
  query: string;
  turns: number;
  displayItems: DisplayItem[];
  summaryText?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ScoutDetails {
  mode: "single";
  status: ScoutStatus;
  subagentProvider?: string;
  subagentModelId?: string;
  runs: ScoutRunDetails[];
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

export type ScoutResultDetails = ScoutDetails | ParallelDetails;

export interface ScoutConfig {
  name: string;
  maxTurns: number;
  /** Optional fixed model for this scout config. Used before workload resolution. */
  configuredModel?: string;
  /** Optional scout workload. Drives provider-preserving profile selection when no explicit model override is set. */
  workload?: ScoutWorkload;
  /** Default thinking level. Overrides the selected model's default when set. */
  defaultThinkingLevel?: ThinkingLevel;
  buildSystemPrompt: (maxTurns: number) => string;
  buildUserPrompt: (params: Record<string, unknown>) => string;
  /**
   * Override the default tool set. If provided, replaces the defaults entirely.
   * Built-in tools (name matches allTools) go to `tools`, others go to `customTools`.
   */
  getTools?: () => any[];
}
