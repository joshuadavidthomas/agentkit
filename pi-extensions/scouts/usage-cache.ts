// Shell out to `vibeusage --json` and cache the result in memory.
//
// If vibeusage isn't installed, times out, or returns bad data,
// returns null — callers fall back to the current heuristic.

import { execFile } from "node:child_process";

// How long to keep cached usage data (ms)
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// How long to wait for vibeusage to respond (ms)
const EXEC_TIMEOUT_MS = 10_000; // 10 seconds

// Mapping from pi provider names to vibeusage provider names
const PROVIDER_MAP: Record<string, string> = {
  anthropic: "claude",
  openai: "codex",
  "openai-codex": "codex",
  google: "gemini",
  "google-vertex": "gemini",
  "google-antigravity": "gemini",
  "google-gemini-cli": "gemini",
  "github-copilot": "copilot",
};

export interface UsagePeriod {
  name: string;
  utilization: number; // 0-100
  remaining: number; // 0-100
  period_type: string; // "session" | "daily" | "weekly" | "monthly"
  model?: string | null;
  resets_at?: string | null;
}

export interface ProviderUsage {
  periods: UsagePeriod[];
  source?: string;
  cached?: boolean;
}

export interface UsageSnapshot {
  providers: Record<string, ProviderUsage>;
  errors: Record<string, string>;
}

// In-memory cache
let cachedSnapshot: UsageSnapshot | null = null;
let cachedAt = 0;

// Resolve a pi provider name to a vibeusage provider name
export function mapProvider(piProvider: string): string | undefined {
  return PROVIDER_MAP[piProvider];
}

// Get the "tightest" utilization for a vibeusage provider.
// Returns the highest utilization across non-session periods,
// or the session period if that's all there is.
// Returns undefined if no data.
export function getProviderUtilization(
  snapshot: UsageSnapshot,
  vibeusageProvider: string,
): number | undefined {
  const provider = snapshot.providers[vibeusageProvider];
  if (!provider?.periods?.length) return undefined;

  // Prefer non-session periods (weekly/monthly/daily) as they represent
  // the binding constraint. Session limits reset fast.
  const nonSession = provider.periods.filter((p) => p.period_type !== "session");
  const relevant = nonSession.length > 0 ? nonSession : provider.periods;

  let maxUtilization = -1;
  for (const period of relevant) {
    if (typeof period.utilization === "number" && period.utilization > maxUtilization) {
      maxUtilization = period.utilization;
    }
  }

  return maxUtilization >= 0 ? maxUtilization : undefined;
}

// Get cached usage data, or fetch fresh if stale/missing.
// Returns null if vibeusage isn't available or fails.
export async function getUsageSnapshot(): Promise<UsageSnapshot | null> {
  const now = Date.now();
  if (cachedSnapshot && now - cachedAt < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const fresh = await fetchVibeusage();
  if (fresh) {
    cachedSnapshot = fresh;
    cachedAt = now;
  }

  // Return stale cache if fresh fetch failed but we have old data
  return fresh ?? cachedSnapshot;
}

// Clear the cache (useful for testing)
export function clearUsageCache(): void {
  cachedSnapshot = null;
  cachedAt = 0;
}

function fetchVibeusage(): Promise<UsageSnapshot | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        "vibeusage",
        ["--json"],
        { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout, _stderr) => {
          if (error) {
            // vibeusage not installed, timed out, or errored — that's fine
            resolve(null);
            return;
          }

          try {
            const data = JSON.parse(stdout);
            // Validate minimum shape
            if (data && typeof data.providers === "object") {
              resolve(data as UsageSnapshot);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        },
      );
    } catch {
      // execFile itself threw (e.g., vibeusage not found)
      resolve(null);
    }
  });
}
