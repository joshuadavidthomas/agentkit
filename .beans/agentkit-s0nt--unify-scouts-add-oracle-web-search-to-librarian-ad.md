---
# agentkit-s0nt
title: 'Unify scouts: add oracle + web search to librarian, add parallel dispatch, retire pi-subagents'
status: in-progress
type: epic
priority: normal
created_at: 2026-02-21T05:49:51Z
updated_at: 2026-02-21T06:24:31Z
---

## Overview

Consolidate the two parallel subagent systems (scouts extension + vendored pi-subagents) into a single scouts-based system. Add two new scouts (oracle, web searcher via expanded librarian), add parallel dispatch, and retire the pi-subagents extension.

## Checklist

### Model tier system
- [x] Add `ModelTier` type (`"fast" | "capable"`) to model-selection.ts
- [x] Add Sonnet-tier candidate lists (OAUTH_CAPABLE_CANDIDATES, API_KEY_CAPABLE_CANDIDATES)
- [x] Export `getModelForTier(registry, currentModel, tier)` function
- [x] Add `defaultModelTier` field to ScoutConfig
- [x] Wire `modelTier` parameter through executeScout

### Oracle scout
- [x] Create oracle-prompts.md.ts with system/user prompts
- [x] Create read-only bash tool variant (read-only-bash.ts)
- [x] Register oracle in index.ts with ScoutConfig (capable tier default, read-only tools)
- [x] Add `modelTier` optional parameter to oracle tool schema

### Expand librarian with web tools
- [x] Create web search tool wrapping brave-search/search.js (web-tools.ts)
- [x] Create web fetch tool wrapping brave-search/content.js (web-tools.ts)
- [x] Add web tools to librarian config getTools()
- [x] Update librarian system prompt to cover web research workflow alongside GitHub research
- [x] Update librarian parameter schema and tool description
- [x] Set librarian default tier to fast, overridable to capable

### Parallel dispatch
- [x] Implement parallel scout execution (parallel.ts)
- [x] TUI rendering for parallel results (renderParallelResult in scout-core.ts)
- [x] Register scouts parallel dispatch tool in index.ts
- [x] Handle abort/cancellation for parallel runs

### Retire pi-subagents
- [x] Update install.sh to skip pi-subagents extension
- [x] Remove agent .md files from ~/.pi/agent/agents/ via install.sh
- [x] Run install.sh to apply changes

### Remaining (future cleanup)
- [ ] Remove pi-extensions/pi-subagents/ directory from repo
- [ ] Remove agents/ directory from repo (keep for opencode for now)
- [ ] Update README.md