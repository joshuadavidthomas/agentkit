# Agents

Subagent definitions in a superset frontmatter format supporting multiple harnesses (OpenCode, Pi, etc.).

code-analyzer, code-locator, code-pattern-finder, and web-searcher are inspired by [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer).

## Installation

Run `./install.sh` from the repo root to transform and install agents to:

- `~/.config/opencode/agents/` (OpenCode)
- `~/.pi/agent/agents/` (Pi)

## Format

Each agent uses a superset frontmatter with harness-specific namespaces:

```yaml
---
description: What this agent does
model: openai/gpt-5.1-codex
temperature: 0.2

opencode:
  mode: subagent
  reasoningEffort: medium
  tools:
    read: true
    grep: true

pi:
  tools: read, grep, glob, ls
  output: analysis.md
---

System prompt goes here...
```

Common fields (description, model, temperature) are shared. Harness-specific fields live under their namespace.

The `scripts/transform-agent.ts` script extracts common fields + the relevant namespace for each harness.
