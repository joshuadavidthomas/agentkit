---
# agentkit-s0nt
title: 'Unify scouts: add oracle + web search to librarian, add parallel dispatch, retire pi-subagents'
status: draft
type: epic
created_at: 2026-02-21T05:49:51Z
updated_at: 2026-02-21T05:49:51Z
---

## Overview

Consolidate the two parallel subagent systems (scouts extension + vendored pi-subagents) into a single scouts-based system. Add two new scouts (oracle, web searcher via expanded librarian), add parallel dispatch, and retire the pi-subagents extension.

## Current State

**Scouts** (pi-extensions/scouts/) — registered as direct tools:
- `finder` — local workspace file/code location (Haiku, bash+read)
- `librarian` — GitHub research (Haiku, dedicated GitHub tools + grepGitHub)

**Subagents** (pi-extensions/pi-subagents/) — vendored, dispatched via `subagent` tool:
- `code-analyzer` — deep code analysis (Sonnet, read+grep+ls)
- `code-locator` — file location (Haiku, grep+ls) — **redundant with finder**
- `code-pattern-finder` — find similar implementations (Sonnet, read+grep+ls)
- `web-searcher` — web research (Sonnet, read+grep+ls+bash) — **tools dont match purpose**

## Target State

Three scouts, all registered as direct tools with shared TUI rendering:

| Scout | Purpose | Model | Tools |
|-------|---------|-------|-------|
| **finder** (exists) | Find where code lives locally | Haiku | bash, read |
| **librarian** (expand) | External research — GitHub + web | Sonnet | GitHub tools, grepGitHub, brave search, web fetch |
| **oracle** (new) | Deep read-only code analysis & reasoning | Sonnet | read, bash (read-only: rg, fd, ls, cat, wc, head, tail, file, stat) |

Plus a lightweight **parallel dispatch** mechanism so the main agent can fire multiple scouts concurrently.

## Checklist

### Oracle scout
- [ ] Create oracle-prompts.md.ts with system/user prompts (read-only senior advisor, amp-inspired)
- [ ] Create read-only bash tool variant (allowlist: rg, fd, ls, cat, wc, head, tail, file, stat, nl)
- [ ] Register oracle in index.ts with ScoutConfig (Sonnet model, read-only tools)
- [ ] Add model selection support for Sonnet-tier models (current model-selection.ts only picks small/cheap models)

### Expand librarian with web tools
- [ ] Create web search tool wrapping brave-search/search.js (typed params: query, numResults, freshness, country, content flag)
- [ ] Create web fetch tool wrapping brave-search/content.js (typed params: url)
- [ ] Add web tools to librarian config getTools()
- [ ] Update librarian system prompt to cover web research workflow alongside GitHub research
- [ ] Update librarian parameter schema — maybe add a `scope` hint (github/web/auto)?
- [ ] Bump librarian to Sonnet model selection

### Model selection updates
- [ ] Add Sonnet-tier candidate lists to model-selection.ts (for oracle + expanded librarian)
- [ ] Keep existing Haiku selection for finder
- [ ] ScoutConfig should specify model tier preference (small vs medium)

### Parallel dispatch
- [ ] Design lightweight parallel scout mechanism (main agent calls one tool that dispatches N scouts concurrently)
- [ ] Shared TUI rendering for parallel results (status per scout, progressive updates)
- [ ] Handle abort/cancellation for parallel runs

### Retire pi-subagents
- [ ] Remove pi-subagents from extension loading
- [ ] Remove agent .md files from ~/.pi/agent/agents/ (or leave them inert)
- [ ] Remove pi-extensions/pi-subagents/ directory
- [ ] Update tool descriptions / system prompt references

### Cleanup
- [ ] Remove code-locator agent (redundant with finder)
- [ ] Remove code-analyzer agent (replaced by oracle)
- [ ] Remove code-pattern-finder agent (replaced by oracle)
- [ ] Remove web-searcher agent (replaced by expanded librarian)
- [ ] Update README.md