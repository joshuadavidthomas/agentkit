# agentkit

A personal collection of skills and extensions for Pi and other agentic LLM tools.

## Installation

```bash
./install.sh
```

This installs everything:

| What | Where |
|------|-------|
| Pi extensions | `~/.pi/agent/extensions/` (symlinked) |
| Skills | `~/.agents/skills/` (symlinked) |
| [dcg](https://github.com/Dicklesworthstone/destructive_command_guard) config | `~/.config/dcg/` (symlinked) |

## Pi Extensions

Extensions for [pi](https://shittycodingagent.ai/), a TUI coding agent.

#### [answer](./pi-extensions/answer.ts)

Extract questions from the last assistant message into an interactive Q&A interface.

When the assistant asks multiple questions, `/answer` (or `Ctrl+.`) extracts them using a fast model (prefers Codex mini, falls back to Haiku), then presents a TUI for navigating and answering each question. Answers are compiled and submitted when complete.

#### [beans](./pi-extensions/beans.ts)

Integrates [Beans](https://github.com/hmans/beans) with pi by running `beans prime` in a project using Beans to track issues and injecting its output into the system prompt at session start and after compaction.

#### [custom-provider-cloudflare-ai-gateway](./pi-extensions/custom-provider-cloudflare-ai-gateway/)

Custom provider that routes AI models through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)'s OpenAI-compatible endpoint. Supports multiple upstream providers (OpenAI, Anthropic, Workers AI) through a unified interface with Cloudflare's observability, caching, and rate limiting.

Model definitions are sourced from [models.dev](https://models.dev) (65+ models), cached locally at `~/.cache/pi/cloudflare-ai-gateway-models.json`, and refreshed hourly in the background. An embedded snapshot provides offline/first-run support. Configure via `~/.pi/agent/cloudflare-ai-gateway.json` with your account ID and gateway name.

#### [custom-provider-zai](./pi-extensions/custom-provider-zai/)

Vendored from [vedang/agents](https://github.com/vedang/agents).

Custom provider for [ZAI](https://z.ai/) GLM models through Cerebras and ZAI endpoints. Supports GLM-4.7 (via Cerebras for fast inference, or via ZAI with reasoning), and GLM-5 (via ZAI with reasoning).

Routes requests to the correct backend based on model ID, with per-request sampling knobs (temperature, top_p, clear_thinking) configurable via environment variables or options. Requires `CEREBRAS_API_KEY` and/or `ZAI_API_KEY` (via config file or environment variables).

#### [dcg](./pi-extensions/dcg.ts)

Bash tool override that integrates with [dcg (Destructive Command Guard)](https://github.com/Dicklesworthstone/destructive_command_guard).

Runs every bash command through dcg's hook mode before execution. When dcg blocks a potentially destructive command, presents an interactive decision UI:

- **Deny** (default): Block the command
- **Allow once**: Permit this specific invocation only
- **Allow always**: Add to project or global allowlist

Displays severity badges, detailed reasons, and tracks allow decisions in tool results. Falls back gracefully when dcg isn't available or returns unexpected output.

#### [handoff](./pi-extensions/handoff.ts)

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

#### [messages](./pi-extensions/messages.ts)

Whimsical working messages while the agent thinks.

Replaces the default "Working..." message with randomly selected playful alternatives like "Percolating...", "Consulting the void...", "Herding pointers...", and "Reticulating splines...". Messages change on each turn for variety and delight.

#### [notify](./pi-extensions/notify.ts)

Desktop notifications when the agent finishes. Uses a cheap model to summarize what was done ("Wrote auth.ts") or what's blocking ("Need: which database?") so you know at a glance whether to come back.

Supported terminals: Ghostty, iTerm2, WezTerm, rxvt-unicode. Not supported: Kitty (uses OSC 99), Terminal.app, Windows Terminal, Alacritty.

#### [peon-ping](./pi-extensions/peon-ping/)

Sound notifications for pi using [peon-ping](https://github.com/PeonPing/peon-ping) / OpenPeon sound packs. Plays themed audio clips (Warcraft III Peon, GLaDOS, Duke Nukem, StarCraft, and more) on lifecycle events:

| Event | Sound category |
|-------|---------------|
| Session start | `session.start` — "Ready to work?" |
| Agent starts working | `task.acknowledge` — "Work, work." |
| Rapid prompts (≥3 in 10s) | `user.spam` — annoyed voice line |
| Agent finishes | `task.complete` — completion sound + desktop notification |

`/peon` opens a settings panel to toggle sounds, switch packs, adjust volume, and enable/disable individual categories. Browsing packs previews each one as you scroll. `/peon install` downloads the default 10 packs from the [peon-ping registry](https://peonping.github.io/registry/).

Cross-platform audio: `afplay` (macOS), `pw-play`/`paplay`/`ffplay`/`mpv`/`aplay` (Linux), PowerShell MediaPlayer (WSL). Also picks up existing packs from `~/.claude/hooks/peon-ping/` if you have a Claude Code installation. Config and state stored in `~/.config/peon-ping/`.

#### [ralph](./pi-extensions/ralph/)

**Experimental.** In-session iterative agent loop with fresh context per iteration, implementing [Geoffrey Huntley's Ralph Wiggum loop approach](https://ghuntley.com/ralph/).

Uses the pi SDK in-process (no subprocess, no RPC) to run repeated agent turns against a task file. Supports steering mid-iteration with queued user messages, follow-ups for next iteration, and comprehensive stats tracking (cost, tokens, duration). State persisted to `.ralph/<name>/` with iteration snapshots.

#### [read](./pi-extensions/read.ts)

Overrides the built-in read tool to handle directories gracefully.

When called on a directory, returns an `ls -la` listing with a hint instead of erroring with EISDIR. All other behavior delegates to the built-in implementation.

#### [scouts](./pi-extensions/scouts/)

Scout subagent system — spins up focused small-model sessions with purpose-built tool sets, returning structured results with custom TUI rendering. Originally vendored from [pi-finder](https://github.com/default-anton/pi-finder) and [pi-librarian](https://github.com/default-anton/pi-librarian), now significantly expanded.

Features:
- **Model tier system**: Each scout has a default tier (`fast` or `capable`) overridable per-call via `modelTier` parameter
- **Usage-aware model selection**: Checks provider utilization via [vibeusage](https://github.com/joshuadavidthomas/vibeusage), deprioritizing providers above 85% and skipping those above 95%
- **Interleaved TUI rendering**: Tool calls and text rendered chronologically with collapsible markdown output
- **Turn budget enforcement**: Blocks tool use on the final turn to force a summary response

Registers four tools:

- **finder** (fast): Read-only workspace scout — locates files, directories, and components when exact locations are unknown
- **librarian** (fast, overridable to capable): External research scout — searches GitHub repos and the web, fetches code and documentation
- **oracle** (capable): Deep code analysis scout — traces data flow, analyzes architecture, finds patterns with precise file:line references. Read-only (restricted bash allowlist)
- **scouts**: Parallel dispatch — runs multiple scouts concurrently for independent research tasks

#### [skill-requires-path](./pi-extensions/skill-requires-path/)

Strips skills from the system prompt when their `requires-path` frontmatter field doesn't exist in the current project. Skills declare a path requirement (e.g., `requires-path: ".jj/"`) and the extension removes them from the LLM's context when the path is absent — the LLM never sees the skill.

#### [statusline](./pi-extensions/statusline.ts)

Starship-style custom footer with model context, git status, costs, and token stats.

## Skills

### [brave-search](./skills/brave-search/SKILL.md)

Web search and content extraction via Brave Search API.

### [btca](./skills/btca/SKILL.md)

Query codebases semantically using LLMs. Use when asking questions about libraries, frameworks, or source code — searches actual source, not outdated docs.

Wraps the [btca (Better Context App)](https://btca.dev) CLI tool. Covers installation, resource management (git repos and local codebases), model configuration via OpenCode, and includes example configs with common resources like Svelte and Tailwind.

### [researching-codebases](./skills/researching-codebases/SKILL.md)

Methodical approach to researching unfamiliar codebases using scout subagents.

### [shadcn-svelte-forms](./skills/shadcn-svelte-forms/SKILL.md)

Patterns for building forms with shadcn-svelte and bits-ui. Covers Field.* component patterns, checkbox groups, radio groups, and form validation display.

### Rust

A suite of skills encoding idiomatic defaults and "think in Rust" principles for AI agents. These skills go beyond syntax to provide judgment on type-driven design, ownership strategies, and ecosystem-standard patterns.

| Skill | Description |
|-------|-------------|
| [rust-async](./skills/rust-async/SKILL.md) | Async patterns and Tokio. Channel selection, blocking avoidance, graceful shutdown, cancellation safety, and sync↔async bridging. |
| [rust-atomics](./skills/rust-atomics/SKILL.md) | Atomics and memory ordering defaults. Atomic-vs-lock decisions, ordering selection, compare_exchange patterns, publication edges, and unsound-concurrency traps. |
| [rust-error-handling](./skills/rust-error-handling/SKILL.md) | Error strategy and design. Library-vs-application axis, structured errors (thiserror), ergonomic propagation (anyhow), and boundary rules. |
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
| [thinking-in-rust](./skills/thinking-in-rust/SKILL.md) | **The paradigm shift skill.** 18 rules for shifting from "compiles" to "thinks in Rust" — newtypes, enums over booleans, exhaustive matching, parse-don't-validate, iterators over indexing, Option over sentinels, ownership restructuring, visibility as design. General-purpose entry point; delegates to specialized skills. |

### Salsa

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

Oracle scout and librarian web research expansion inspired by [Amp](https://ampcode.com/)'s agent architecture (oracle advisor, web tool integration).

Answer pi extension from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

Messages pi extension from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff) (Apache 2.0, Armin Ronacher).

Notify pi extension from [pi-coding-agent examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions) (MIT, Mario Zechner).

Scouts pi extension from [default-anton/pi-finder](https://github.com/default-anton/pi-finder), [default-anton/pi-librarian](https://github.com/default-anton/pi-librarian), and [default-anton/pi-subagent-model-selection](https://github.com/default-anton/pi-subagent-model-selection) (MIT, Anton Kuzmenko).

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

Rust skills reference and adapt guidance from several sources, including:

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

Z.ai custom pi provider extension from [vedang/agents](https://github.com/vedang/agents) ([DWTFYWT](https://github.com/vedang/agents/blob/49d1e6984268cb1604d0bcc084cc7241ced0a4e8/LICENSE.txt), Vedang Manerikar).

Peon-ping pi extension uses the [peon-ping](https://github.com/PeonPing/peon-ping) sound pack registry and [OpenPeon](https://github.com/PeonPing/og-packs) sound packs (CC-BY-NC-4.0).

## License

agentkit is licensed under the MIT license. See the [`LICENSE`](LICENSE) file for more information.
