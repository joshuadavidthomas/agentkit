---
# agentkit-p6w0
title: Prevent recursive subagent invocation (OOM crash)
status: completed
type: bug
priority: critical
created_at: 2026-02-06T07:07:29Z
updated_at: 2026-02-06T07:08:10Z
---

## Problem

When a subagent (e.g. code-analyzer) is spawned as a child pi process, it loads ALL extensions including the pi-subagents extension itself. Even though agents specify restricted tools (e.g. `tools: read, grep, glob, ls`), the `--tools` flag only controls built-in tools — extensions still load and register their own tools. This means the `subagent` tool is available to child pi processes, allowing recursive subagent calls that cascade into OOM crashes.

## Fix

Set `PI_IS_SUBAGENT=1` environment variable when spawning child pi processes. In the extension registration, check for this env var and skip registration entirely if set.

## Checklist
- [x] Add `PI_IS_SUBAGENT=1` to spawnEnv in `execution.ts` `runSync()`
- [x] Add env to `spawnRunner()` in `async-execution.ts`
- [x] Add env to `runPiStreaming()` in `subagent-runner.ts`
- [x] Add early return guard in `index.ts` `registerSubagentExtension()`