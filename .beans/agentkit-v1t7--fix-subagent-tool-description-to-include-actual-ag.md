---
# agentkit-v1t7
title: Fix subagent tool description to include actual agent names
status: completed
type: bug
priority: normal
created_at: 2026-02-05T01:23:23Z
updated_at: 2026-02-05T01:27:37Z
---

## Problem

When using pi-subagents extension, the LLM sometimes calls wrong agent names like 'code-scout' or 'codebase-analyzer' instead of the actual names ('code-locator', 'code-analyzer').

## Root Cause

The tool description is **static** with hardcoded example names:
```
CHAIN: { chain: [{agent:"scout"}, {agent:"planner"}] }
Example: { chain: [{agent:"scout", task:...}, {agent:"planner", task:...}] }
```

The LLM never sees the actual agent names until it gets an error.

## Solution

Discover agents at registration time and inject real names into the description:
1. Call `discoverAgents(process.cwd(), 'both')` at the start of `registerSubagentExtension()`
2. Build the description dynamically with actual agent names
3. Use real agent names in examples

## Checklist
- [x] Discover agents at registration time in index.ts
- [x] Update description to list available agents
- [x] Use real agent names in CHAIN example
- [x] Include agent descriptions (progressive disclosure)
- [x] Fix YAML parser to handle multi-line descriptions (added `yaml` dependency)