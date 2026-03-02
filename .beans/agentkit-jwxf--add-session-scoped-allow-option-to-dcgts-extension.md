---
# agentkit-jwxf
title: Add session-scoped allow option to dcg.ts extension
status: completed
type: task
priority: normal
created_at: 2026-02-25T15:57:22Z
updated_at: 2026-02-25T16:00:58Z
---

Update the dcg.ts pi extension permission flow to include an intermediate approval choice between "allow once" and "allow always".

The new option should allow approvals for the current pi session only (project or global scope should still apply for persistent allows).

## Checklist
- [x] Locate current dcg.ts approval option handling and persistence logic
- [x] Add a new "allow for this session" option between once and always
- [x] Ensure session-scoped approvals are honored for repeated calls in the same session
- [x] Verify formatting/types/build checks relevant to this extension
- [x] Update bean checklist and summarize changes

### Summary
- Added a new decision menu option: **Allow for this session**.
- Session approvals are tracked in-memory by `ruleId` and automatically re-applied for later blocked commands in the same pi session.
- Allowed command result badges now distinguish `allowed (session)` from `allowed (once)` and persistent allows.

## Notes
- `npm run typecheck` currently fails in this repo because `tsconfig.json` includes only `runtimes/**/*.ts` and finds no inputs.
- Ran targeted check: `npx tsc --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022 pi-extensions/dcg.ts`.
- Targeted check reports pre-existing type-signature mismatches in this extension's tool callback typings.