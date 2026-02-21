// Model selection for scout subagents.
//
// Supports two tiers:
//   - "fast"    → cheap/quick models (Haiku, Gemini Flash)
//   - "capable" → mid-tier reasoning models (Sonnet, Gemini Pro)
//
// Each scout has a default tier, and the caller can override per-invocation.
// When usage data is available (via vibeusage), candidates are scored by
// provider headroom (lower utilization = preferred).

import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  type UsageSnapshot,
  getProviderUtilization,
  getUsageSnapshot,
  mapProvider,
} from "./usage-cache.ts";

export type ModelTier = "fast" | "capable";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AuthMode = "oauth" | "api-key";
export type AuthSource = "runtime" | "api_key" | "oauth" | "env" | "fallback" | "none";

export interface SelectedModel {
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
const DEPRIORITIZE_THRESHOLD = 85;
const SKIP_THRESHOLD = 95;

interface CandidateSpec {
  provider: string;
  match: (id: string) => boolean;
  thinkingLevel: ThinkingLevel;
  label: string;
}

// Fast tier — cheap, quick models for simple lookups
const OAUTH_FAST_CANDIDATES: CandidateSpec[] = [
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

const API_KEY_FAST_CANDIDATES: CandidateSpec[] = [
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

// Capable tier — mid-tier reasoning models for deep analysis
const OAUTH_CAPABLE_CANDIDATES: CandidateSpec[] = [
  {
    provider: "anthropic",
    match: (id) => id.includes("sonnet-4") && !id.includes("haiku"),
    thinkingLevel: "low",
    label: "anthropic/claude-sonnet-4",
  },
  {
    provider: "google-antigravity",
    match: (id) => id.includes("gemini-3-pro") || id.includes("gemini-2.5-pro"),
    thinkingLevel: "low",
    label: "google-antigravity/gemini-pro",
  },
  // Fall through to fast tier if no capable models available
  ...OAUTH_FAST_CANDIDATES,
];

const API_KEY_CAPABLE_CANDIDATES: CandidateSpec[] = [
  {
    provider: "anthropic",
    match: (id) => id.includes("sonnet-4") && !id.includes("haiku"),
    thinkingLevel: "low",
    label: "anthropic/claude-sonnet-4",
  },
  {
    provider: "google-vertex",
    match: (id) => id.includes("gemini-3-pro") || id.includes("gemini-2.5-pro"),
    thinkingLevel: "low",
    label: "google-vertex/gemini-pro",
  },
  {
    provider: "google",
    match: (id) => id.includes("gemini-3-pro") || id.includes("gemini-2.5-pro"),
    thinkingLevel: "low",
    label: "google/gemini-pro",
  },
  // Fall through to fast tier if no capable models available
  ...API_KEY_FAST_CANDIDATES,
];

// Candidate lists by auth mode and tier
const CANDIDATE_LISTS: Record<AuthMode, Record<ModelTier, CandidateSpec[]>> = {
  "oauth": {
    "fast": OAUTH_FAST_CANDIDATES,
    "capable": OAUTH_CAPABLE_CANDIDATES,
  },
  "api-key": {
    "fast": API_KEY_FAST_CANDIDATES,
    "capable": API_KEY_CAPABLE_CANDIDATES,
  },
};

// Universal fallback candidates (tried after primary list)
const FALLBACK_FINDERS: Array<
  (available: Model<Api>[], tier: ModelTier, currentProvider?: string) => { model: Model<Api>; thinkingLevel: ThinkingLevel; label: string } | null
> = [
  // Sonnet on current provider (for capable tier)
  (available, tier, currentProvider) => {
    if (tier !== "capable" || !currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider && c.id.includes("sonnet-4"));
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${currentProvider}/sonnet-4 (fallback)` } : null;
  },
  // Gemini Flash on current provider
  (available, _tier, currentProvider) => {
    if (!currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider && c.id.includes("gemini-3-flash"));
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${currentProvider}/gemini-3-flash (fallback)` } : null;
  },
  // Haiku 4.5 on current provider
  (available, _tier, currentProvider) => {
    if (!currentProvider) return null;
    const m = available.find((c) => c.provider === currentProvider && c.id.includes("haiku-4-5"));
    return m ? { model: m, thinkingLevel: "low" as ThinkingLevel, label: `${currentProvider}/haiku-4.5 (fallback)` } : null;
  },
  // Current model with low thinking (last resort)
  (available, _tier, currentProvider) => {
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
): SelectedModel {
  return {
    model,
    thinkingLevel,
    authMode: auth.authMode,
    authSource: auth.authSource,
    reason: `${reason}; ${auth.basis}`,
  };
}

function scoreProvider(provider: string, usage: UsageSnapshot | null): number | undefined {
  if (!usage) return undefined;
  const vibeProvider = mapProvider(provider);
  if (!vibeProvider) return undefined;
  return getProviderUtilization(usage, vibeProvider);
}

function findCandidate(
  available: Model<Api>[],
  spec: CandidateSpec,
): Model<Api> | null {
  return available.find((m) => m.provider === spec.provider && spec.match(m.id)) ?? null;
}

function selectFromCandidates(
  available: Model<Api>[],
  candidates: CandidateSpec[],
  usage: UsageSnapshot | null,
  auth: AuthResolution,
  tier: ModelTier,
  currentProvider?: string,
): SelectedModel | null {
  const deprioritized: Array<{ model: Model<Api>; spec: CandidateSpec; utilization: number }> = [];

  for (const spec of candidates) {
    const model = findCandidate(available, spec);
    if (!model) continue;

    const utilization = scoreProvider(spec.provider, usage);

    if (utilization === undefined) {
      return makeSelection(model, spec.thinkingLevel, auth, spec.label);
    }

    if (utilization >= SKIP_THRESHOLD) continue;

    if (utilization >= DEPRIORITIZE_THRESHOLD) {
      deprioritized.push({ model, spec, utilization });
      continue;
    }

    return makeSelection(
      model,
      spec.thinkingLevel,
      auth,
      `${spec.label} (${utilization}% used)`,
    );
  }

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

  for (const finder of FALLBACK_FINDERS) {
    const found = finder(available, tier, currentProvider);
    if (!found) continue;

    const utilization = scoreProvider(found.model.provider, usage);
    if (utilization !== undefined && utilization >= SKIP_THRESHOLD) continue;

    const usageNote = utilization !== undefined ? ` (${utilization}% used)` : "";
    return makeSelection(found.model, found.thinkingLevel, auth, `${found.label}${usageNote}`);
  }

  return null;
}

// Main entry point
export async function getModelForTier(
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
  tier: ModelTier = "fast",
): Promise<SelectedModel | null> {
  const available = modelRegistry.getAvailable();
  const auth = detectAuthResolution(modelRegistry, currentModel);
  const usage = await getUsageSnapshot();
  const candidates = CANDIDATE_LISTS[auth.authMode][tier];

  return selectFromCandidates(
    available,
    candidates,
    usage,
    auth,
    tier,
    currentModel?.provider,
  );
}

// Backward-compatible alias
export type SelectedSmallModel = SelectedModel;
export const getSmallModelFromProvider = (
  modelRegistry: ModelRegistry,
  currentModel: Model<Api> | undefined,
) => getModelForTier(modelRegistry, currentModel, "fast");
