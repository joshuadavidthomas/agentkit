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

Add compound engineering to `install.sh` so it runs as part of the normal agentkit install flow.

**Source repo:** Clone or fetch `EveryInc/compound-engineering-plugin` to `$XDG_CACHE_HOME/agentkit/compound-engineering-plugin` (typically `~/.cache/agentkit/compound-engineering-plugin`). On subsequent runs, `git pull` to update.

**Flow:**
1. `install.sh` checks if the repo exists in the cache dir
2. If not, `git clone https://github.com/EveryInc/compound-engineering-plugin.git`
3. If yes, `git -C <path> pull`
4. Run the conversion script pointing at the cached repo

### 6. Agent model mapping

Some compound engineering agents specify `model: haiku` or `model: inherit` in their frontmatter. The specialist scout already supports a `model` parameter, and the scouts parallel tool passes it through.

**Approach:**
- The conversion script reads each agent's `model` frontmatter field
- Maps Claude Code model names to Pi model IDs (e.g., `haiku` → `claude-haiku-4-5`, `inherit` → omit/use default)
- Embeds the model hint in the converted prompt text so the main agent passes it through when calling the specialist

### 7. Teammate/swarm mode

`Teammate` is Claude Code's built-in multi-agent swarm primitive. It provides:
- `spawnTeam` — create a named team
- Spawn teammates as background agents with names, inboxes, and colors
- `write` / `broadcast` — message one or all teammates
- `requestShutdown` / `approveShutdown` — graceful teardown
- `approvePlan` — leader approves teammate work
- `cleanup` — tear down the team

Used in `ce:work` swarm mode and the `orchestrating-swarms` skill (1600+ lines).

**Approach:** Map to ralph. Ralph is our in-session iterative loop engine. The mapping isn't 1:1 — ralph doesn't have team messaging or named agents — but the core pattern (spawn background work, coordinate, shut down) overlaps. This is a separate project. For now:
- The conversion script strips `Teammate(...)` calls with a note: `(Swarm mode: see ralph extension for Pi equivalent)`
- The `orchestrating-swarms` skill gets a Pi-specific preamble noting the differences
- Revisit after the basic workflow (`brainstorm → plan → work → review → compound`) is working

### 8. Orchestration commands as prompt templates

Commands with `disable-model-invocation: true` (like `/lfg`, `/slfg`) are step-by-step orchestration sequences, not interactive prompts. They tell the model to run a series of other commands in order.

**Approach:** Convert these to Pi prompt templates that list the steps. The model reads the template and executes each step sequentially. Example for `/lfg`:

```markdown
<!-- ~/.pi/agent/prompts/lfg.md -->
---
description: Full autonomous engineering workflow
argument-hint: "[feature description]"
---
1. Run /ce-plan {{args}}
2. Run /deepen-plan on the plan file
3. Run /ce-work on the plan file
4. Run /ce-review
5. Run /resolve-todo-parallel
...
```

The model already knows how to follow numbered steps. No special machinery needed.

## Ralph ↔ Teammate Analysis

Ralph and Teammate solve fundamentally different problems. Ralph is a **single-agent iterative loop** (one LoopEngine, one session, re-prompt with fresh context each iteration). Teammate is a **multi-agent coordination system** (N parallel workers, inbox messaging, shared task queues with dependency DAGs, leader/worker lifecycle).

**Overlap:** Both create AgentSession instances in-process. Both track work state on the filesystem. Both have fresh context per cycle.

**Divergence:** Everything about coordination. Ralph has zero multi-agent primitives.

| Aspect | Ralph | Teammate |
|--------|-------|----------|
| Agents | 1 | N parallel |
| Communication | steer/follow-up to self | inbox messages between agents |
| Task management | single task.md | shared queue with dependency DAG |
| Control | stop/kill | per-agent requestShutdown/approveShutdown |

### What ralph would need

Ralph's `LoopEngine` is already a good **worker** primitive. What's missing is an **orchestration layer above it**:

1. **Multi-session management** — `SessionPool` or `AgentRegistry` for N concurrent sessions with identities
2. **Messaging layer** — in-memory inbox/outbox with `write(target, msg)` and `broadcast(msg)`, structured message types (text, shutdown_request, idle_notification)
3. **Shared task queue** — `TaskStore` with create/claim/update/list, dependency tracking, auto-unblocking
4. **Leader/worker lifecycle** — leader loop that spawns workers, monitors inboxes, approves/rejects, coordinates shutdown
5. **Concurrent execution** — `LoopEngine.start()` already returns `Promise<void>`, so multiple engines can run via `Promise.all`

### Incremental path

1. `InboxManager` (in-memory message queues) + expose write/read as tools
2. `TaskStore` with dependency DAG + expose as tools
3. `RalphSwarm` wrapping multiple `LoopEngine` instances with a leader loop
4. Worker auto-claim (poll TaskStore for unblocked/unclaimed tasks) + shutdown coordination

Ralph's existing `nudge()` could deliver inbox messages to running workers — when a message arrives, steer the worker with it.

### For now

This is a separate project. The conversion script strips Teammate calls with a note. Revisit after the basic workflow works.
