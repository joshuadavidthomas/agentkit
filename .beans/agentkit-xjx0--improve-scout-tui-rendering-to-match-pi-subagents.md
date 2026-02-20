---
# agentkit-xjx0
title: Improve scout TUI rendering to match pi-subagents style
status: completed
type: task
priority: normal
created_at: 2026-02-19T22:58:20Z
updated_at: 2026-02-19T22:58:51Z
---

The current scout (finder/librarian) rendering dumps the full markdown response first, then lists tool calls at the bottom as an afterthought. This reads weirdly — the tool calls should be interleaved with the output chronologically like pi-subagents does.

## Current problems
- Tool calls appear below the response content, making the flow backwards
- No chronological interleaving of tools and text
- Running state doesn't show a compact fixed-height view
- No usage/token/duration stats in the footer

## Target behavior (match pi-subagents render.ts)
- Tool calls rendered inline chronologically with `▸` markers
- Intermediate text shown dim/truncated
- Final text rendered as full markdown
- While running: compact fixed-height view with last N tool calls
- Footer with model, tokens, duration stats

## Key challenge
The scout subagent currently only captures a flat `toolCalls[]` list and a final `summaryText`. To get interleaved rendering, we'd need to capture the message stream with interleaved tool/text blocks — similar to `getDisplayItems()` in pi-subagents/utils.ts.

## References
- `pi-extensions/pi-subagents/render.ts` — target rendering style
- `pi-extensions/pi-subagents/formatters.ts` — tool call formatting
- `pi-extensions/pi-subagents/utils.ts` — `getDisplayItems()` for message parsing
- `pi-extensions/scouts/scout-core.ts` — current rendering in `renderScoutResult()`