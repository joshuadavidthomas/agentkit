// Model selection for scout subagents.
//
// Originally from pi-subagent-model-selection v0.1.4, now extended with
// usage-aware selection via vibeusage. When usage data is available,
// candidates are scored by provider headroom (lower utilization = preferred).
// When unavailable, falls back to the original heuristic.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  type UsageSnapshot,
  getProviderUtilization,
  getUsageSnapshot,
  mapProvider,
} from "./usage-cache.ts";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AuthMode = "oauth" | "api-key";
export type AuthSource = "runtime" | "api_key" | "oauth" | "env" | "fallback" | "none";

export interface SelectedSmallModel {
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  authMode: AuthMode;
  authSource: AuthSource;
  reason: string;
}

interface AuthResolution {
  authMode: AuthMode;
  authSource: AuthSource;
  basis: string;
}

// Utilization thresholds
const DEPRIORITIZE_THRESHOLD = 85; // >85% → push down the list
const SKIP_THRESHOLD = 95; // >95% → skip entirely

// Candidate models for scouts, in preference order.
// Each entry is a provider + model ID pattern + thinking level.
interface CandidateSpec {
  provider: string;
  match: (id: string) => boolean;
  thinkingLevel: ThinkingLevel;
  label: string;
}

// OAuth candidates (when using subscription auth)
// Haiku first — handles custom tool schemas better than Gemini Flash.
const OAUTH_CANDIDATES: CandidateSpec[] = [
  {
    provider: "anthropic",
    match: (id) => id.includes("haiku-4-5"),
    thinkingLevel: "low",
    label: "anthropic/claude-haiku-4.5",
  },
  {
    provider: "google-antigravity",
    match: (id) => id.includes("gemini-3-flash"),
    thinkingLevel: "low",
    label: "google-antigravity/gemini-3-flash",
  },
];

// API-key candidates
const API_KEY_CANDIDATES: CandidateSpec[] = [
  {
    provider: "google-vertex",
    match: (id) => id.includes("gemini-3-flash"),
    thinkingLevel: "low",
    label: "google-vertex/gemini-3-flash",
  },
  {
    provider: "google",
    match: (id) => id.includes("gemini-3-flash"),
    thinkingLevel: "low",
    label: "google/gemini-3-flash",
  },
];

// Universal fallback candidates (tried after primary list)
const FALLBACK_CANDIDATE_FINDERS: Array<
  (available: Model<Api>[], currentProvider?: string) => { model: Model<Api>; thinkingLevel: ThinkingLevel; label: string } | null
> = [
  // Gemini Flash on current provider
  (available, currentProvider) => {
    if (!currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider && c.id.includes("gemini-3-flash"));
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${currentProvider}/gemini-3-flash (fallback)` } : null;
  },
  // Haiku 4.5 on current provider
  (available, currentProvider) => {
    if (!currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider && c.id.includes("haiku-4-5"));
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${currentProvider}/haiku-4.5 (fallback)` } : null;
  },
  // Current model with low thinking (last resort)
  (available, currentProvider) => {
    if (!currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider);
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${m.provider}/${m.id} (fallback, low thinking)` } : null;
  },
];

function detectAuthResolution(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
): AuthResolution {
  if (!currentModel) {
    return {
      authMode: "api-key",
      authSource: "none",
      basis: "no current model; default to api-key policy",
    };
  }

  const registry = modelRegistry as any;
  if (typeof registry.getAuthSource === "function") {
    const authSource: AuthSource = registry.getAuthSource(currentModel.provider);
    const authMode: AuthMode = authSource === "oauth" ? "oauth" : "api-key";
    return { authMode, authSource, basis: `provider auth source=${authSource}` };
  }

  const usesOAuth = modelRegistry.isUsingOAuth?.(currentModel) ?? false;
  return {
    authMode: usesOAuth ? "oauth" : "api-key",
    authSource: usesOAuth ? "oauth" : "none",
    basis: usesOAuth ? "derived from isUsingOAuth" : "derived from isUsingOAuth=false",
  };
}

function makeSelection(
  model: Model<Api>,
  thinkingLevel: ThinkingLevel,
  auth: AuthResolution,
  reason: string,
): SelectedSmallModel {
  return {
    model,
    thinkingLevel,
    authMode: auth.authMode,
    authSource: auth.authSource,
    reason: `${reason}; ${auth.basis}`,
  };
}

// Score a pi provider using vibeusage data.
// Returns utilization 0-100, or undefined if no data.
function scoreProvider(provider: string, usage: UsageSnapshot | null): number | undefined {
  if (!usage) return undefined;
  const vibeProvider = mapProvider(provider);
  if (!vibeProvider) return undefined;
  return getProviderUtilization(usage, vibeProvider);
}

// Try to find a matching available model for a candidate spec
function findCandidate(
  available: Model<Api>[],
  spec: CandidateSpec,
): Model<Api> | null {
  return available.find((m) => m.provider === spec.provider && spec.match(m.id)) ?? null;
}

// Core selection: walk the candidate list, apply usage scoring
function selectFromCandidates(
  available: Model<Api>[],
  candidates: CandidateSpec[],
  usage: UsageSnapshot | null,
  auth: AuthResolution,
  currentProvider?: string,
): SelectedSmallModel | null {
  // Phase 1: Try candidates in preference order, skip exhausted providers
  const deprioritized: Array<{ model: Model<Api>; spec: CandidateSpec; utilization: number }> = [];

  for (const spec of candidates) {
    const model = findCandidate(available, spec);
    if (!model) continue;

    const utilization = scoreProvider(spec.provider, usage);

    // No usage data → use this candidate (original heuristic behavior)
    if (utilization === undefined) {
      return makeSelection(model, spec.thinkingLevel, auth, spec.label);
    }

    // Skip exhausted providers
    if (utilization >= SKIP_THRESHOLD) continue;

    // Deprioritize but remember high-usage providers
    if (utilization >= DEPRIORITIZE_THRESHOLD) {
      deprioritized.push({ model, spec, utilization });
      continue;
    }

    // Good headroom — use it
    return makeSelection(
      model,
      spec.thinkingLevel,
      auth,
      `${spec.label} (${utilization}% used)`,
    );
  }

  // Phase 2: If all preferred candidates were deprioritized, pick the least-used
  if (deprioritized.length > 0) {
    deprioritized.sort((a, b) => a.utilization - b.utilization);
    const best = deprioritized[0];
    return makeSelection(
      best.model,
      best.spec.thinkingLevel,
      auth,
      `${best.spec.label} (${best.utilization}% used, deprioritized)`,
    );
  }

  // Phase 3: Universal fallbacks
  for (const finder of FALLBACK_CANDIDATE_FINDERS) {
    const found = finder(available, currentProvider);
    if (!found) continue;

    const utilization = scoreProvider(found.model.provider, usage);
    if (utilization !== undefined && utilization >= SKIP_THRESHOLD) continue;

    const usageNote = utilization !== undefined ? ` (${utilization}% used)` : "";
    return makeSelection(found.model, found.thinkingLevel, auth, `${found.label}${usageNote}`);
  }

  return null;
}

// Main entry point — async because it may fetch usage data
export async function getSmallModelFromProvider(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
): Promise<SelectedSmallModel | null> {
  const available = modelRegistry.getAvailable();
  const auth = detectAuthResolution(modelRegistry, currentModel);

  // Fetch usage data (returns cached if fresh, null if unavailable)
  const usage = await getUsageSnapshot();

  const candidates = auth.authMode === "oauth" ? OAUTH_CANDIDATES : API_KEY_CANDIDATES;

  return selectFromCandidates(
    available,
    candidates,
    usage,
    auth,
    currentModel?.provider,
  );
}
