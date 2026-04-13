// Shared parameter schemas and validation helpers.

import { Type } from "@sinclair/typebox";

import type { ScoutDetails } from "./types.ts";

// Shared parameter: model override — used by all scout tools
export const ModelParam = Type.Optional(
  Type.String({
    description: [
      "Advanced model override. Usually omit this.",
      "Only set it when the user explicitly requested a specific model/provider, or when a prior scout attempt failed and you need a deliberate retry.",
      "If omitted, the scout prefers an exact provider override when configured, otherwise a shared model-family stack based on the current session model, then its generic default.",
      "Examples: 'openai/gpt-5.4', 'anthropic/claude-opus-4-6', 'gemini-3.1-pro'.",
    ].join("\n"),
  }),
);

// Build a standardized error result
export function makeErrorResult(text: string, details?: Partial<ScoutDetails>) {
  return {
    content: [{ type: "text" as const, text }],
    details: { status: "error" as const, runs: [], ...details } satisfies ScoutDetails,
    isError: true as const,
  };
}

// Validate that `query` is a non-empty string, return error result or null
export function validateQuery(params: unknown): ReturnType<typeof makeErrorResult> | null {
  const rawQuery = (params as any).query;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    return makeErrorResult("Invalid parameters: expected `query` to be a non-empty string.");
  }
  return null;
}
