---
# agentkit-f324
title: Vendor pi-finder and pi-librarian as unified scouts extension
status: completed
type: feature
priority: normal
created_at: 2026-02-19T22:23:33Z
updated_at: 2026-02-19T22:29:36Z
---

Vendor the pi-finder and pi-librarian extensions (plus pi-subagent-model-selection) into a single `pi-extensions/scouts/` directory.

The upstream extensions share ~90% of their code. Rather than copying three separate packages, consolidate:

- Extract the shared subagent session scaffold (abort handling, event tracking, turn budget, TUI rendering) into `scout-core.ts`
- Keep finder and librarian prompts/descriptions verbatim from upstream
- Inline pi-subagent-model-selection as `model-selection.ts`
- Single `index.ts` that registers both tools

## Checklist

- [x] Create `pi-extensions/scouts/` directory structure
- [x] Write `model-selection.ts` — inline from pi-subagent-model-selection
- [x] Write `scout-core.ts` — shared scaffold extracted from finder/librarian index.ts
- [x] Write `finder-prompts.md.ts` — verbatim from upstream
- [x] Write `librarian-prompts.md.ts` — verbatim from upstream
- [x] Write `index.ts` — registers both finder and librarian tools
- [x] Write `package.json` — pi extension manifest
- [x] Verify typecheck passes