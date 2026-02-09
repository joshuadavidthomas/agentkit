# agentkit

A personal collection of agents, skills, extensions, and scripts for Claude Code, OpenCode, Codex, Pi, and other agentic LLM tools.

## Installation

```bash
./install.sh
```

This installs everything:

| What | Where |
|------|-------|
| Agents | `~/.config/opencode/agents/`, `~/.pi/agent/agents/` (transformed) |
| Pi extensions | `~/.pi/agent/extensions/` (symlinked) |
| Skills | `~/.agents/skills/` (symlinked) |
| [dcg (Destructive Command Guard)](https://github.com/Dicklesworthstone/destructive_command_guard) config | `~/.config/dcg/` (symlinked) |


## Agents

Agents live in `agents/` using a superset frontmatter format that supports multiple harnesses. The install script transforms them to harness-specific formats. See [agents/README.md](./agents/README.md) for format details.

### [code-analyzer](./agents/code-analyzer.md)

Analyzes codebase implementation details with precise file:line references. Call when you need to understand HOW code works—traces data flow, identifies patterns, explains technical workings.

### [code-locator](./agents/code-locator.md)

Locates files, directories, and components relevant to a feature or task. A "super grep/glob/ls tool"—finds WHERE code lives without analyzing contents.

### [code-pattern-finder](./agents/code-pattern-finder.md)

Finds similar implementations, usage examples, or existing patterns to model after. Like code-locator but includes actual code snippets and details.

### [web-searcher](./agents/web-searcher.md)

Web research specialist for finding modern information not in training data. Searches strategically, fetches content, synthesizes findings with citations.

## Runtimes

### [Pi](./runtimes/pi/)

Extensions for [pi](https://shittycodingagent.ai/), a TUI coding agent.

#### [answer](./runtimes/pi/extensions/answer.ts)

Extract questions from the last assistant message into an interactive Q&A interface.

When the assistant asks multiple questions, `/answer` (or `Ctrl+.`) extracts them using a fast model (prefers Codex mini, falls back to Haiku), then presents a TUI for navigating and answering each question. Answers are compiled and submitted when complete.

#### [beans](./runtimes/pi/extensions/beans.ts)

Integrates [Beans](https://github.com/hmans/beans) with pi by running `beans prime` in a project using Beans to track issues and injecting its output into the system prompt at session start and after compaction.

#### [dcg](./runtimes/pi/extensions/dcg.ts)

Bash tool override that integrates with [dcg (Destructive Command Guard)](https://github.com/Dicklesworthstone/destructive_command_guard).

Runs every bash command through dcg's hook mode before execution. When dcg blocks a potentially destructive command, presents an interactive decision UI:

- **Deny** (default): Block the command
- **Allow once**: Permit this specific invocation only
- **Allow always**: Add to project or global allowlist

Displays severity badges, detailed reasons, and tracks allow decisions in tool results. Falls back gracefully when dcg isn't available or returns unexpected output.

#### [handoff](./runtimes/pi/extensions/handoff.ts)

Transfer context to a new focused session instead of compacting.

When sessions get long, compacting loses information. Handoff extracts what matters for your next task and creates a new session with a generated prompt containing:

- **Files**: Absolute paths to relevant files (targets 8-15 files)
- **Context**: Decisions made, constraints discovered, patterns established
- **Task**: Clear description of what to do next

The generated prompt appears in the editor for review before starting the new session.

```
/handoff now implement this for teams as well
/handoff execute phase one of the plan
/handoff check other places that need this fix
```

#### [messages](./runtimes/pi/extensions/messages.ts)

Whimsical working messages while the agent thinks.

Replaces the default "Working..." message with randomly selected playful alternatives like "Percolating...", "Consulting the void...", "Herding pointers...", and "Reticulating splines...". Messages change on each turn for variety and delight.

#### [notify](./runtimes/pi/extensions/notify.ts)

Desktop notifications when the agent finishes. Uses a cheap model to summarize what was done ("Wrote auth.ts") or what's blocking ("Need: which database?") so you know at a glance whether to come back.

Supported terminals: Ghostty, iTerm2, WezTerm, rxvt-unicode. Not supported: Kitty (uses OSC 99), Terminal.app, Windows Terminal, Alacritty.

#### [pi-subagents](./runtimes/pi/extensions/pi-subagents/)

Vendored from [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) with modifications:

- **Skill discovery**: Uses pi's `SettingsManager` for skill discovery (respects user-configured skill paths)
- **`subagent_status` without args**: Lists recent runs (async AND sync) by scanning artifact metadata files
- **Richer `subagent_status` description**: Documents all use cases (listing, progress checking, artifact inspection)
- **Inline failure details**: Failed steps include error message and artifact paths in tool result text (visible to agent, not just TUI)
- **Recovery guidance**: Failed runs show artifact paths in text content; TUI additionally shows `subagent_status({})` and `ls` hints
- **Reduced false positives**: Exit code 1 from search tools (grep, rg, find, fd) means "no matches", not failure
- **Parallel live progress**: Shows real-time progress for parallel tasks (upstream has no live updates for parallel)

Enables delegating tasks to subagents with chains, parallel execution, and TUI clarification.

#### [statusline](./runtimes/pi/extensions/statusline.ts)

Starship-style custom footer with model context, git status, costs, and token stats.

## Skills

### [brave-search](./skills/brave-search/SKILL.md)

Web search and content extraction via Brave Search API.

### [btca](./skills/btca/SKILL.md)

Query codebases semantically using LLMs. Use when asking questions about libraries, frameworks, or source code—searches actual source, not outdated docs.

Wraps the [btca (Better Context App)](https://btca.dev) CLI tool. Covers installation, resource management (git repos and local codebases), model configuration via OpenCode, and includes example configs with common resources like Svelte and Tailwind.

### [coolify-compose](./skills/coolify-compose/SKILL.md)

Convert Docker Compose files to Coolify templates.

### [diataxis](./skills/diataxis/SKILL.md)

Structure and write documentation using the [Diátaxis](https://diataxis.fr/) framework. Classifies content into tutorials, how-to guides, reference, and explanation. Includes all diataxis.fr pages as reference material for on-demand loading.

### [frontend-design-principles](./skills/frontend-design-principles/SKILL.md)

Create polished, intentional frontend interfaces. Fights the tendency toward generic AI output by requiring domain exploration and self-checks before generating code.

Includes:

- Required pre-generation gates (intent questions, four outputs: domain, color world, signature, defaults to reject)
- Required pre-showing checks (swap test, squint test, signature test, token test)
- Principles for avoiding sameness and default thinking
- Specialized guidance for app interfaces (dashboards, tools) and marketing (landing pages, creative work)
- Technical foundations (spacing, oklch colors, depth strategies, dark mode)

### [researching-codebases](./skills/researching-codebases/SKILL.md)

Methodical approach to researching unfamiliar codebases using specialized subagents.

### [skill-authoring](./skills/skill-authoring/SKILL.md)

Guide for authoring, creating, refining, or troubleshooting agent skills.

### [writing-cli-skills](./skills/writing-cli-skills/SKILL.md)

Guide for writing skills that wrap CLI tools. Use when creating a new CLI skill or reviewing an existing one.

The key constraint: hands-on use over documentation. Install the tool, try it yourself, note what surprises you. Reading docs is no substitute for actually running commands. Provides section templates, organization patterns (group by task, progressive disclosure), and a complete starting template in `references/`.

### [youtube-transcript](./skills/youtube-transcript/SKILL.md)

Extract and work with YouTube video transcripts.

## Tools

### [dcg](./dcg/)

Custom packs for [dcg (Destructive Command Guard)](https://github.com/Dicklesworthstone/destructive_command_guard).

> **Note:** Custom pack loading is not yet functional in dcg. The `ExternalPackLoader` is implemented but not wired up. See [issue #24](https://github.com/Dicklesworthstone/destructive_command_guard/issues/24).

#### [devtools-noblock](./dcg/devtools-noblock.yaml)

Prevents agents from running blocking dev server commands that hang indefinitely.

Blocks commands like `npm run dev`, `vite`, `python manage.py runserver`, `docker compose up` (without `-d`), `cargo watch`, and various `just` recipes that start attached servers or follow logs.

When blocked, the agent is instructed to ask if the server is already running, and if not, offer to run it in a tmux session.

## Acknowledgements

This repository includes and adapts work from several sources.

### agents

code-analyzer, code-locator, code-pattern-finder, and web-searcher are inspired by [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) (Apache 2.0).

### answer

From [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

### frontend-design-principles

Cobbled together from:

- The [frontend-design](https://github.com/anthropics/skills/tree/main/frontend-design) skill in [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0)
- [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) (MIT, Damola Akinleye)
- [Teaching Claude to Design Better: Improving Anthropic's Frontend Design Skill](https://www.justinwetch.com/blog/improvingclaudefrontend) ([relevant PR](https://github.com/anthropics/skills/pull/210) to official anthropics/skills skill) by Justin Wetch

### messages

From [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

### notify

From [pi-coding-agent examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions) (MIT, Mario Zechner).

### pi-subagents

Vendored from [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) (MIT, Nico Bailon).

### diataxis

Reference content derived from the [Diátaxis documentation framework](https://diataxis.fr/) by [Daniele Procida](https://vurt.eu) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Source repository: [evildmp/diataxis-documentation-framework](https://github.com/evildmp/diataxis-documentation-framework).

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
