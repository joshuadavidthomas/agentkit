import { appendFileSync } from "node:fs";

function isEnabled(): boolean {
  return Boolean(process.env.PI_CLAUDE_AGENT_SDK_DEBUG);
}

export function debug(message: string, data?: Record<string, unknown>) {
  if (!isEnabled()) return;
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[${new Date().toISOString()}] ${message}${suffix}\n`;
  try {
    appendFileSync("/tmp/pi-claude-agent-sdk-provider.log", line);
  } catch {
    // Ignore debug logging failures.
  }
}

const NOOP: (extra?: Record<string, unknown>) => void = () => {};

export function time(label: string): (extra?: Record<string, unknown>) => void {
  if (!isEnabled()) return NOOP;
  const start = performance.now();
  return (extra) => {
    debug(`time:${label}`, { ms: round(performance.now() - start), ...extra });
  };
}

const counters = new Map<string, { count: number; totalMs: number }>();

export function tally(label: string, ms: number): void {
  if (!isEnabled()) return;
  const entry = counters.get(label);
  if (entry) {
    entry.count += 1;
    entry.totalMs += ms;
  } else {
    counters.set(label, { count: 1, totalMs: ms });
  }
}

export function flushTally(label: string, extra?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const entry = counters.get(label);
  if (!entry) return;
  counters.delete(label);
  debug(`tally:${label}`, {
    count: entry.count,
    totalMs: round(entry.totalMs),
    avgMs: round(entry.totalMs / entry.count),
    ...extra,
  });
}

function round(ms: number): number {
  return Number(ms.toFixed(2));
}
