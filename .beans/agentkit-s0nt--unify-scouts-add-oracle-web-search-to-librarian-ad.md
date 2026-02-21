---
# agentkit-s0nt
title: 'Unify scouts: add oracle + web search to librarian, add parallel dispatch, retire pi-subagents'
status: completed
type: epic
priority: normal
created_at: 2026-02-21T05:49:51Z
updated_at: 2026-02-21T07:12:52Z
---

## Overview

Consolidated the two parallel subagent systems (scouts extension + vendored pi-subagents) into a single scouts-based system with three scouts, model tier selection, and parallel dispatch.

## Result

Four tools registered:

| Scout | Purpose | Default Tier | Tools |
|-------|---------|-------------|-------|
| **finder** | Find where code lives locally | fast | bash, read |
| **librarian** | External research — GitHub + web | fast | GitHub tools, grepGitHub, webSearch, webFetch |
| **oracle** | Deep read-only code analysis | capable | read, read-only bash |
| **scouts** | Parallel dispatch | — | dispatches to any scout |

All scouts accept `modelTier` parameter to override default (fast ↔ capable).

## What was removed

- `pi-extensions/pi-subagents/` — vendored subagent system (9,500+ lines)
- `agents/` — 4 agent .md files (code-analyzer, code-locator, code-pattern-finder, web-searcher)
- `scripts/` — agent transform script
- Agent installation from install.sh