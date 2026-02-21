---
# agentkit-m0g3
title: Add grep.app searchCode tool to librarian scout
status: completed
type: feature
priority: normal
created_at: 2026-02-20T19:41:21Z
updated_at: 2026-02-20T19:47:44Z
---

Add a `searchCode` tool to the librarian scout that calls grep.app's REST API for fast, literal code pattern search across public GitHub repos. Complements the existing `gh search code` approach.

## Design
- New file `pi-extensions/scouts/grep-app-tool.ts` with `createGrepAppTool()` factory
- Direct `fetch()` to `https://grep.app/api/search` — no MCP, no mcporter
- Strips HTML snippets to clean text with line numbers
- Includes facets summary (top repos/languages)
- Wired into librarian only (not finder)
- System prompt updated with guidance on when to use searchCode vs gh search code

## Checklist
- [x] Create `grep-app-tool.ts` with `createGrepAppTool()` factory
- [x] Update `scout-core.ts` ScoutConfig to accept additional tools
- [x] Wire the tool into the librarian in `index.ts`
- [x] Update librarian system prompt with searchCode strategy guidance
- [x] Test that it works end-to-end