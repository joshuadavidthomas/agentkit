---
# agentkit-s0nt
title: 'Unify scouts: add oracle + web search to librarian, add parallel dispatch, retire pi-subagents'
status: draft
type: epic
priority: normal
created_at: 2026-02-21T05:49:51Z
updated_at: 2026-02-21T05:52:01Z
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

| Scout | Purpose | Default Tier | Tools |
|-------|---------|-------------|-------|
| **finder** (exists) | Find where code lives locally | fast | bash, read |
| **librarian** (expand) | External research — GitHub + web | fast (overridable to capable) | GitHub tools, grepGitHub, brave search, web fetch |
| **oracle** (new) | Deep read-only code analysis & reasoning | capable (overridable to fast) | read, bash (read-only: rg, fd, ls, cat, wc, head, tail, file, stat) |

Plus a lightweight **parallel dispatch** mechanism so the main agent can fire multiple scouts concurrently.

## Model Tier System

Model selection gets a `modelTier` concept — `"fast"` (Haiku/Flash) vs `"capable"` (Sonnet).

- Each scout has a **default tier** in its ScoutConfig
- Each scout **exposes `modelTier` as an optional parameter** on the tool call
- The main agent can override: e.g. `librarian({ query: "...", modelTier: "capable" })` for a deep web synthesis, or `oracle({ query: "...", modelTier: "fast" })` for a quick question
- `model-selection.ts` gets separate candidate lists per tier

This lets the same scout handle both quick lookups and deep research without needing separate tools.

## Checklist

### Model tier system
- [ ] Add `ModelTier` type (`"fast" | "capable"`) to model-selection.ts
- [ ] Add Sonnet-tier candidate lists (OAUTH_CAPABLE_CANDIDATES, API_KEY_CAPABLE_CANDIDATES)
- [ ] Export a `getModelForTier(registry, currentModel, tier)` function (or extend existing `getSmallModelFromProvider`)
- [ ] Add `defaultModelTier` field to ScoutConfig
- [ ] Wire `modelTier` parameter through executeScout — override default with param if provided

### Oracle scout
- [ ] Create oracle-prompts.md.ts with system/user prompts (read-only senior advisor, amp-inspired)
- [ ] Create read-only bash tool variant (allowlist: rg, fd, ls, cat, wc, head, tail, file, stat, nl)
- [ ] Register oracle in index.ts with ScoutConfig (capable tier default, read-only tools)
- [ ] Add `modelTier` optional parameter to oracle tool schema

### Expand librarian with web tools
- [ ] Create web search tool wrapping brave-search/search.js (typed params: query, numResults, freshness, country, content flag)
- [ ] Create web fetch tool wrapping brave-search/content.js (typed params: url)
- [ ] Add web tools to librarian config getTools()
- [ ] Update librarian system prompt to cover web research workflow alongside GitHub research
- [ ] Update librarian parameter schema — add `modelTier` optional parameter
- [ ] Set librarian default tier to fast (cheap GitHub lookups), overridable to capable for deep synthesis

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