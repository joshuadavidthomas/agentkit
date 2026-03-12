# Compound Engineering Plugin for Pi

Install the compound engineering plugin into Pi using native infrastructure instead of their compat extension.

## Context

The [compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) is a Claude Code plugin with 28 agents, 22 commands, 20+ skills, and 1 MCP server. It has a built-in CLI converter for Pi, but that converter ships a compat extension that duplicates functionality we already have (subagents, interactive Q&A) or that's better handled by a skill (MCPorter).

Instead of using their converter, we're building native Pi support by:
- Using the specialist scout for agent dispatch (replacing their `subagent` tool)
- Extending answer.ts for structured questions (replacing their `ask_user_question` tool)
- Writing an MCPorter skill (replacing their `mcporter_list`/`mcporter_call` tools)
- Writing a conversion script that rewrites plugin content for our infrastructure

## Done

### Specialist scout
- [x] `specialist-prompts.md.ts` — preamble + skill content as system prompt, turn budget guidance
- [x] `skill-resolver.ts` — resolves skill names from `~/.agents/skills/`, `~/.pi/agent/skills/`, `.pi/skills/` (walking up). Discriminated union returns, input validation, no silent failures
- [x] `specialist-config.ts` — shared config builder used by standalone tool and parallel dispatch
- [x] Standalone `specialist` tool — single skill dispatch through `executeScout`
- [x] Parallel dispatch — specialist added to `scouts` tool, dynamic config per skill
- [x] Declarative tool access — defaults to `["read", "bash"]`, caller passes `tools` array to opt in to `write`/`edit`

## Remaining

### 1. ask_user_question tool

Extend `pi-extensions/answer.ts` to register an `ask_user_question` tool the model can call mid-turn. The existing `/answer` command is user-initiated (extracts questions from the last assistant message). The new tool is model-initiated (the model calls it to ask the user a question with optional selectable choices).

**Parameters:**
- `question` (string) — the question to show the user
- `options` (string[], optional) — selectable choices
- `allowCustom` (boolean, optional, default true) — whether to allow free-text when options are provided

**Behavior:**
- No options: show `ctx.ui.input(question)`, return the answer
- With options + allowCustom: show `ctx.ui.select(question, [...options, "Other"])`, if "Other" selected show `ctx.ui.input("Your answer")`
- With options, no custom: show `ctx.ui.select(question, options)`
- User cancels: return "User cancelled."

**Used by:** `ce:brainstorm` (5 uses), `ce:plan` (4), `setup` (3), skill creation workflows, `test-browser`, `test-xcode`, `report-bug`, `deepen-plan`

### 2. MCPorter skill

Write a skill at `skills/mcporter/SKILL.md` that teaches the agent how to use MCPorter via bash for MCP server access. Not an extension, not a tool — just instructions.

**Content should cover:**
- `mcporter list <server> --json` to discover available tools
- `mcporter call <server>.<tool> --args '{}' --output json` to invoke tools
- Config path resolution: `.pi/compound-engineering/mcporter.json` (project), `~/.pi/agent/compound-engineering/mcporter.json` (global)
- The Context7 server that ships with compound engineering

**Used by:** `deepen-plan`, `create-agent-skills` workflows (resolve-library-id, get-library-docs)

### 3. Conversion script

Write `scripts/convert-compound-engineering.sh` (or `.ts`) that takes the compound engineering plugin source and installs it into `~/.pi/agent/` using our infrastructure.

**What it does:**

#### Skills (direct copy)
- Copy all `plugins/compound-engineering/skills/*/` to `~/.pi/agent/skills/`
- These are already SKILL.md files, Pi uses them natively

#### Agents → Skills
- Convert each `plugins/compound-engineering/agents/*/*.md` into a skill at `~/.pi/agent/skills/<name>/SKILL.md`
- Parse the agent frontmatter (name, description, model, capabilities)
- Generate SKILL.md with frontmatter and agent body as content

#### Commands → Prompts
- Convert each non-`disable-model-invocation` command to a prompt at `~/.pi/agent/prompts/<name>.md`
- Rewrite content:
  - `Task agent-name(args)` → prose referencing specialist tool: `Use the specialist tool with skill="agent-name" and task="args"`
  - For parallel Task blocks → prose referencing scouts tool: `Use the scouts tool to run these specialist tasks in parallel`
  - `AskUserQuestion` → `ask_user_question`
  - `TodoWrite`/`TodoRead` → `file-based todos (todos/ directory)`
  - Slash commands `/ce:X` → `/ce-X` (Pi prompt name normalization, colons to hyphens)
  - `Teammate(...)` → add a note: `(Swarm mode not available in Pi — skip this step)`
  - MCP tool references like `mcp__context7__*` → add MCPorter note

#### MCPorter config
- Convert `.mcp.json` to `~/.pi/agent/compound-engineering/mcporter.json`
- Map `type: "http"` servers to `{ baseUrl: ... }` format
- Map `type: "stdio"` servers to `{ command: ..., args: ... }` format

#### AGENTS.md block
- Append (or upsert) a managed block in `~/.pi/agent/AGENTS.md` explaining the compound engineering setup:
  - How `Task agent(args)` maps to the specialist tool
  - How parallel dispatch uses the scouts tool
  - How ask_user_question works
  - How MCPorter provides MCP access
  - List of installed skills, prompts, and their categories

#### What it does NOT do
- Install the compat extension (`compound-engineering-compat.ts`)
- Create any new extension files
- Modify existing extensions

### 4. Uninstall/update support

The conversion script should be re-runnable:
- Skills and prompts are overwritten on re-run
- AGENTS.md block is upserted (replace between markers)
- A `--clean` flag removes everything it installed

### 5. Integration into install.sh

Add compound engineering to `install.sh` so it runs as part of the normal agentkit install flow. Needs the compound engineering plugin repo path — either cloned as a submodule, a configurable path, or fetched on demand.

## Open questions

- Should the conversion script live in agentkit or as a fork/PR to the compound engineering repo?
- What model should the specialist default to for compound engineering agents? Sonnet 4.5 works but some agents (like learnings-researcher) specify `model: haiku` in their frontmatter — should we respect that?
- The `ce:work` swarm mode uses `Teammate` extensively — is that something to tackle later with ralph, or just mark as unsupported?
- Some commands have `disable-model-invocation: true` (like `/lfg`, `/slfg`) — these are orchestration sequences, not prompts. How to handle in Pi? Could become prompt templates that just list the steps.
