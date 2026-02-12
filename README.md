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

#### [custom-provider-cloudflare-ai-gateway](./runtimes/pi/extensions/custom-provider-cloudflare-ai-gateway/)

Custom provider that routes AI models through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)'s OpenAI-compatible endpoint. Supports multiple upstream providers (OpenAI, Anthropic, Workers AI) through a unified interface with Cloudflare's observability, caching, and rate limiting.

Model definitions are sourced from [models.dev](https://models.dev) (65+ models), cached locally at `~/.cache/pi/cloudflare-ai-gateway-models.json`, and refreshed hourly in the background. An embedded snapshot provides offline/first-run support. Configure via `~/.pi/agent/cloudflare-ai-gateway.json` with your account ID and gateway name.

#### [custom-provider-zai](./runtimes/pi/extensions/custom-provider-zai/)

Custom provider for [ZAI](https://z.ai/) GLM models through Cerebras and ZAI endpoints. Supports GLM-4.7 (via Cerebras for fast inference, or via ZAI with reasoning), and GLM-5 (via ZAI with reasoning).

Routes requests to the correct backend based on model ID, with per-request sampling knobs (temperature, top_p, clear_thinking) configurable via environment variables or options. Requires `CEREBRAS_API_KEY` and/or `ZAI_API_KEY` (via config file or environment variables).

Vendored from [vedang/agents](https://github.com/vedang/agents) ([DWTFYWT](https://github.com/vedang/agents/blob/49d1e6984268cb1604d0bcc084cc7241ced0a4e8/LICENSE.txt), Vedang Manerikar).

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

### Rust

A suite of skills encoding idiomatic defaults and "think in Rust" principles for AI agents. These skills go beyond syntax to provide judgment on type-driven design, ownership strategies, and ecosystem-standard patterns.

| Skill | Description |
|-------|-------------|
| [rust-async](./skills/rust-async/SKILL.md) | Async patterns and Tokio. Channel selection, blocking avoidance, graceful shutdown, cancellation safety, and sync↔async bridging. |
| [rust-atomics](./skills/rust-atomics/SKILL.md) | Atomics and memory ordering defaults. Atomic-vs-lock decisions, ordering selection, compare_exchange patterns, publication edges, and unsound-concurrency traps. |
| [rust-error-handling](./skills/rust-error-handling/SKILL.md) | Error strategy and design. Library-vs-application axis, structured errors (thiserror), ergonomic propagation (anyhow), and boundary rules. |
| [rust-idiomatic](./skills/rust-idiomatic/SKILL.md) | **The paradigm shift skill.** Core defaults agents consistently miss: newtypes for domain strings, enums over booleans, exhaustive matching, parse-don't-validate. |
| [rust-interop](./skills/rust-interop/SKILL.md) | Cross-language integration. Framework selection (PyO3, napi-rs, wasm-bindgen, cxx) and boundary ownership/panic rules. |
| [rust-macros](./skills/rust-macros/SKILL.md) | Declarative (macro_rules!) and procedural macros. Grammar patterns, hygiene, syn/quote conventions, and expansion debugging. |
| [rust-ownership](./skills/rust-ownership/SKILL.md) | Ownership, borrowing, and lifetimes. Decision framework for smart pointers, function signatures, and navigating borrow checker errors. |
| [rust-performance](./skills/rust-performance/SKILL.md) | Performance optimization rulebook. Allocation reduction, data structure selection, bounds-check elimination, and profiling discipline. |
| [rust-project-structure](./skills/rust-project-structure/SKILL.md) | Workspace and API surface design. Crate layout, feature flag unification, public API checklist, and documentation conventions. |
| [rust-serde](./skills/rust-serde/SKILL.md) | Serialization patterns and schema design. Enum wire representations, high-leverage attributes, and adapter patterns (serde_with). |
| [rust-testing](./skills/rust-testing/SKILL.md) | Testing ecosystem survey. Property testing (proptest), snapshot testing (insta), fixtures (rstest), mocking (mockall), and nextest runner. |
| [rust-traits](./skills/rust-traits/SKILL.md) | Trait design and dispatch. Enforces enum → generics → trait objects hierarchy; covers object safety and standard-trait patterns. |
| [rust-type-design](./skills/rust-type-design/SKILL.md) | Type-driven domain modeling. Patterns for newtypes, typestate, builders, phantom types, and sealing. |
| [rust-unsafe](./skills/rust-unsafe/SKILL.md) | Soundness, safety invariants, and UB avoidance. Mandatory documentation requirements (// SAFETY:), Miri validation, and FFI boundaries. |

#### Salsa

A suite of skills for [Salsa](https://github.com/salsa-rs/salsa), the incremental computation framework for Rust. Salsa powers rust-analyzer, ty, Cairo, and other projects that need sub-second response times on large codebases after small edits. The skills cover everything from getting started to production-grade patterns, with reference material drawn from real-world Salsa projects.

| Skill | Description |
|-------|-------------|
| [salsa-accumulators](./skills/salsa-accumulators/SKILL.md) | Side-channel output from tracked functions — diagnostics, warnings, logs |
| [salsa-advanced-plumbing](./skills/salsa-advanced-plumbing/SKILL.md) | Low-level patterns — `specify`, `singleton`, `attach`, persistence, synthetic writes |
| [salsa-cancellation](./skills/salsa-cancellation/SKILL.md) | Cancellation handling for interactive systems — LSP servers, watch-mode CLIs |
| [salsa-cycle-handling](./skills/salsa-cycle-handling/SKILL.md) | Handling recursive/cyclic queries with fixed-point iteration and fallback values |
| [salsa-database-architecture](./skills/salsa-database-architecture/SKILL.md) | Database struct design, layered trait hierarchies, crate boundaries, test vs production patterns |
| [salsa-durability](./skills/salsa-durability/SKILL.md) | Optimizing performance by assigning durability levels to skip revalidation |
| [salsa-incremental-testing](./skills/salsa-incremental-testing/SKILL.md) | Verifying incremental reuse with event capture and memoization assertions |
| [salsa-lsp-integration](./skills/salsa-lsp-integration/SKILL.md) | Building LSP servers with Salsa — host/snapshot concurrency, editor changes, diagnostics |
| [salsa-memory-management](./skills/salsa-memory-management/SKILL.md) | Controlling cache growth, LRU sizing, and preventing unbounded memory usage |
| [salsa-overview](./skills/salsa-overview/SKILL.md) | Start here — what Salsa is, core concepts, and routing to specialized skills |
| [salsa-production-patterns](./skills/salsa-production-patterns/SKILL.md) | Graduating from prototype to production — the maturity model and scaling strategies |
| [salsa-query-pipeline](./skills/salsa-query-pipeline/SKILL.md) | Designing tracked function pipelines — return modes, LRU, `no_eq`, granularity strategies |
| [salsa-struct-selection](./skills/salsa-struct-selection/SKILL.md) | Choosing between `#[salsa::input]`, `#[salsa::tracked]`, `#[salsa::interned]`, and plain types |

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

code-analyzer, code-locator, code-pattern-finder, and web-searcher agents are inspired by [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) (Apache 2.0).

Answer pi extension from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

The frontend-design-principles skill was cobbled together from:

- The [frontend-design](https://github.com/anthropics/skills/tree/main/frontend-design) skill in [anthropics/skills](https://github.com/anthropics/skills) (Apache 2.0)
- [Dammyjay93/interface-design](https://github.com/Dammyjay93/interface-design) (MIT, Damola Akinleye)
- [Teaching Claude to Design Better: Improving Anthropic's Frontend Design Skill](https://www.justinwetch.com/blog/improvingclaudefrontend) ([relevant PR](https://github.com/anthropics/skills/pull/210) to official anthropics/skills skill) by Justin Wetch

Messages pi extension from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

Notify pi extension from [pi-coding-agent examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions) (MIT, Mario Zechner).

pi-subagents pi extension vendored from [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) (MIT, Nico Bailon).

Diátaxis reference content derived from the [Diátaxis documentation framework](https://diataxis.fr/) by [Daniele Procida](https://vurt.eu) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)). Source repository: [evildmp/diataxis-documentation-framework](https://github.com/evildmp/diataxis-documentation-framework).

Salsa skills reference code and patterns from:

- [BAML](https://github.com/BoundaryML/baml) (Apache-2.0)
- [Cairo](https://github.com/starkware-libs/cairo) (Apache-2.0)
- [Fe](https://github.com/argotorg/fe) (Apache-2.0)
- [Mun](https://github.com/mun-lang/mun) (MIT OR Apache-2.0)
- [Salsa](https://github.com/salsa-rs/salsa) (MIT OR Apache-2.0)
- [WGSL Analyzer](https://github.com/wgsl-analyzer/wgsl-analyzer) (MIT OR Apache-2.0)
- [django-language-server](https://github.com/joshuadavidthomas/django-language-server) (Apache-2.0)
- [rust-analyzer](https://github.com/rust-lang/rust-analyzer) (MIT OR Apache-2.0)
- [stc](https://github.com/dudykr/stc) (Apache-2.0)
- [ty](https://github.com/astral-sh/ty) / [Ruff monorepo](https://github.com/astral-sh/ruff) (MIT)

Rust Ecosystem skills reference and adapt guidance from several sources, including:

- [Actors with Tokio](https://ryhl.io/blog/actors-with-tokio/) by Alice Ryhl
- [Aiming for correctness with types](https://fasterthanli.me/articles/aiming-for-correctness-with-types) by Amos Wenger (fasterthanlime)
- [Async: What is blocking?](https://ryhl.io/blog/async-what-is-blocking/) by Alice Ryhl
- [Common Rust Lifetime Misconceptions](https://github.com/pretzelhammer/rust-blog/blob/master/posts/common-rust-lifetime-misconceptions.md) by pretzelhammer (CC BY-SA 4.0)
- [Rust Atomics and Locks](https://marabos.nl/atomics/) by Mara Bos
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale (CC BY 4.0)
- [Error Handling Survey](https://blog.yoshuawuyts.com/error-handling-survey/) by Yoshua Wuyts
- [Error Handling in Rust](https://blog.burntsushi.net/rust-error-handling/) by Andrew Gallant (BurntSushi)
- [Error handling in Rust](https://www.lpalmieri.com/posts/error-handling-rust/) by Luca Palmieri
- [Making Illegal States Unrepresentable](https://corrode.dev/blog/illegal-state/) by corrode.dev
- [Modular Errors in Rust](https://sabrinajewson.org/blog/errors) by Sabrina Jewson
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) by Alexis King
- [Pin](https://without.boats/blog/pin/) by Without Boats
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) (MIT OR Apache-2.0)
- [Rust Design Patterns](https://github.com/rust-unofficial/patterns) (MPL-2.0)
- [The Rust Programming Language](https://github.com/rust-lang/book) (MIT OR Apache-2.0)
- [The Rust Reference](https://github.com/rust-lang/reference) (MIT OR Apache-2.0)
- [The Rustonomicon](https://github.com/rust-lang/nomicon) (MIT OR Apache-2.0)
- [The Typestate Pattern in Rust](https://cliffle.com/blog/rust-typestate/) by Cliff L. Biffle

custom-provider-zai pi extension vendored from [vedang/agents](https://github.com/vedang/agents) ([DWTFYWT - Do What The Fuck You Want To Public License[](https://github.com/vedang/agents/blob/49d1e6984268cb1604d0bcc084cc7241ced0a4e8/LICENSE.txt), Vedang Manerikar).

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
