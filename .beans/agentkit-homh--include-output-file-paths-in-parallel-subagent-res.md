---
# agentkit-homh
title: Include output file paths in parallel subagent results
status: completed
type: feature
priority: normal
created_at: 2026-02-05T17:31:40Z
updated_at: 2026-02-05T17:32:41Z
---

## Problem

Parallel subagent runs return only '4/4 succeeded' - the calling agent has no way to access the actual findings without guessing file paths.

## Solution

1. **Add output paths to parallel success message** (primary fix)
   - List each task's output file path in the result
   - LLM can then `Read` what it needs (progressive disclosure)

2. **Enhance subagent_status to list files with sizes** (polish)
   - Show output files and sizes when inspecting a run
   - Helps LLM decide what's worth reading

## Checklist
- [x] Update parallel success result to include output file paths
- [x] Update subagent_status to list output files with sizes