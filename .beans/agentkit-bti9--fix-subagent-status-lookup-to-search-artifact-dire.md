---
# agentkit-bti9
title: Fix subagent_status lookup to search artifact directories
status: completed
type: bug
priority: normal
created_at: 2026-02-05T16:53:05Z
updated_at: 2026-02-05T16:54:33Z
---

## Problem

`subagent_status` lists runs from artifacts directory but can't find them when looking up by ID.

**Listing** combines:
1. memoryJobs (in-memory)
2. asyncRuns from ASYNC_DIR
3. artifactRuns from listRunsFromArtifacts()

**Lookup** only searches:
1. ASYNC_DIR
2. RESULTS_DIR

So artifact-based runs show in listing but 'not found' on inspect.

## Solution

Add artifact directory search to the lookup logic.

## Checklist
- [x] Add helper to find run in artifact dirs by ID prefix (`findRunInArtifacts` in utils.ts)
- [x] Update lookup logic to check artifacts after async/results
- [x] Display artifact run info with agents, state, output files