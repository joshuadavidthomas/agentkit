# agentkit

A personal collection of commands, skills, subagents, and scripts for Claude Code, OpenCode, Codex, Pi, and other agentic-based LLM tools.

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

#### [statusline](./runtimes/pi/extensions/statusline.ts)

Starship-style custom footer with model context, git status, costs, and token stats.

## Skills

### [btca](./skills/btca/SKILL.md)

Query codebases semantically using LLMs. Use when asking questions about libraries, frameworks, or source code — searches actual source, not outdated docs.

Wraps the [btca (Better Context App)](https://btca.dev) CLI tool. Covers installation, resource management (git repos and local codebases), model configuration via OpenCode, and includes example configs with common resources like Svelte and Tailwind.

### [frontend-design-principles](./skills/frontend-design-principles/SKILL.md)

Create polished, intentional frontend interfaces. Fights the tendency toward generic AI output by requiring domain exploration and self-checks before generating code.

Includes:

- Required pre-generation gates (intent questions, four outputs: domain, color world, signature, defaults to reject)
- Required pre-showing checks (swap test, squint test, signature test, token test)
- Principles for avoiding sameness and default thinking
- Specialized guidance for app interfaces (dashboards, tools) and marketing (landing pages, creative work)
- Technical foundations (spacing, oklch colors, depth strategies, dark mode)

### [writing-cli-skills](./skills/writing-cli-skills/SKILL.md)

Guide for writing skills that wrap CLI tools. Use when creating a new CLI skill or reviewing an existing one.

The key constraint: hands-on use over documentation. Install the tool, try it yourself, note what surprises you. Reading docs is no substitute for actually running commands. Provides section templates, organization patterns (group by task, progressive disclosure), and a complete starting template in `references/`.

## Acknowledgements

This repository includes and adapts work from several sources.

### answer

From [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

### frontend-design-principles

Cobbled together from:

- The [frontend-design](https://github.com/anthropics/skills/tree/main/frontend-design) skill in [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0)
- [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) (MIT, Damola Akinleye)
- [Teaching Claude to Design Better: Improving Anthropic's Frontend Design Skill](https://www.justinwetch.com/blog/improvingclaudefrontend) ([relevant PR](https://github.com/anthropics/skills/pull/210) to official anthropics/skills skill) by Justin Wetch

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
