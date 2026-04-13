// Shared types for scout subagents.

import type { ModelFamily, ThinkingLevel } from "./models.ts";

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
  status: ScoutStatus;
  subagentProvider?: string;
  subagentModelId?: string;
  runs: ScoutRunDetails[];
}

export interface ScoutConfig {
  name: string;
  maxTurns: number;
  /** Generic default model ID (e.g. "claude-haiku-4-5", "anthropic/claude-opus-4-6"). */
  defaultModel?: string;
  /** Generic default candidate list, tried in order before falling back to the current model. */
  defaultModelCandidates?: string[];
  /** Shared model-family candidate lists, keyed by an explicit family name. */
  familyModelCandidates?: Partial<Record<ModelFamily, string[]>>;
  /** Exact provider overrides, keyed by provider id in lowercase (e.g. "openai", "openai-codex"). */
  providerModelCandidates?: Partial<Record<string, string[]>>;
  /** Default thinking level. Overrides the model-selection default when set. */
  defaultThinkingLevel?: ThinkingLevel;
  buildSystemPrompt: (maxTurns: number) => string;
  buildUserPrompt: (params: Record<string, unknown>) => string;
  /**
   * Override the default tool set. If provided, replaces the defaults entirely.
   * Built-in tools (name matches allTools) go to `tools`, others go to `customTools`.
   */
  getTools?: () => any[];
}
