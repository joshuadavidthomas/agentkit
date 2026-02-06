---
# agentkit-ip0c
title: Improve single subagent tool call rendering
status: completed
type: feature
priority: normal
created_at: 2026-02-06T07:12:28Z
updated_at: 2026-02-06T07:13:21Z
---

## Problem

Single subagent results show tool calls in an ugly format:
```
 ls {"path":"/home/josh/projects/joshuadavid...
 grep {"pattern":"djls\\.toml","path":"/home/j...
```

Should look like ralph loop's formatting:
```
  ▸ ls ./docs/configuration/
  ▸ grep "djls\.toml" ./docs/
  ▸ bash find . -name "*.toml"
```

## Checklist
- [ ] Update `shortenPath` in formatters.ts to try CWD-relative shortening first
- [ ] Add `formatToolCallParts` returning `{ label, summary }` for two-color rendering
- [ ] Add specific handlers for grep, glob, ls tools
- [ ] Update render.ts single mode to use `▸` prefix with colored tool name + dim args
- [ ] Update `formatToolCall` to use parts function for consistency