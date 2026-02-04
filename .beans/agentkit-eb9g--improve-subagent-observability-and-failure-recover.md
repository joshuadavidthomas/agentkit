---
# agentkit-eb9g
title: Improve subagent observability and failure recovery
status: completed
type: feature
priority: normal
created_at: 2026-02-04T22:10:15Z
updated_at: 2026-02-04T22:14:04Z
---

Improve the pi-subagents extension to help calling agents better understand and recover from subagent runs, especially failures.

## Problem

When subagent runs fail (especially parallel), the calling agent:
1. Doesn't get enough inline info to understand what went wrong
2. Tries `subagent_status` without parameters and hits a dead end
3. Abandons investigation, wasting the run

## Solution

Multiple improvements to tooling, output formatting, and descriptions.

## Checklist

- [x] **A: `subagent_status` with no args lists recent runs**
  - When called without `id` or `dir`, show recent runs from current session (or globally)
  - Include: id, mode, status, timestamp, artifact dir
  - Guide user toward inspection: "To inspect: subagent_status({ id: 'xyz' })"
  - Added `listRecentRuns()` to utils.ts, merges in-memory asyncJobs with disk runs

- [x] **B: Inline failure details in results**
  - When parallel/chain tasks fail, include the error message inline
  - Show truncated error in the step output, not just "failed"
  - Shows error preview and artifact output path for failed steps
  - **Important**: Added to text content (what agent sees), not just TUI rendering

- [x] **C: Add recovery guidance on failures**
  - When any task fails, append investigation hints to output
  - Include: path to failed output file in text content
  - TUI also shows `subagent_status({})` and `ls` hints for human
  - **Important**: Agent sees artifact paths in tool result text, not just TUI

- [x] **D: Session-aware run tracking**
  - `subagent_status` with no args merges in-memory asyncJobs with disk runs
  - In-memory jobs take precedence (more up-to-date)

- [x] **E: Richer `subagent_status` description**
  - Rewrite description to cover all use cases (not just failures)
  - Include: checking async progress, reviewing completed runs, listing recent, finding artifacts
  - Add parameter examples inline

- [x] **F: Actionable artifact paths in output**
  - When showing artifact dir, also show specific file paths for failed tasks
  - Format as ready-to-use read commands

## Files

- `runtimes/pi/extensions/pi-subagents/index.ts` - status tool, run tracking
- `runtimes/pi/extensions/pi-subagents/render.ts` - result rendering
- `runtimes/pi/extensions/pi-subagents/chain-execution.ts` - chain failure handling
- `runtimes/pi/extensions/pi-subagents/formatters.ts` - output formatting utilities
- `runtimes/pi/extensions/pi-subagents/types.ts` - may need new types for session tracking