# Plan: Agentic Engineering Workflow

Implementation plan for the `/ak:*` workflow in pi. Design rationale is in [DESIGN.md](DESIGN.md).

## Done

### Specialist scout
- [x] Specialist prompts, skill resolver, shared config builder
- [x] Standalone `specialist` tool via `executeScout`
- [x] Parallel dispatch in `scouts` tool
- [x] Declarative tool access — defaults to `["read", "bash"]`, caller opts in to `write`/`edit`

### MCPorter skill
- [x] `skills/mcporter/SKILL.md` — workflow-agnostic CLI reference

### ask_user_question tool
- [x] Multi-question support with free-text, selectable options, inline "Other"
- [x] Confirmation screen, shared rendering, cancel handling

### Ralph loop engine
- [x] In-session iterative loop with pi SDK AgentSession
- [x] Steering mid-iteration, follow-up queue for next iteration
- [x] Stats tracking (cost, tokens, duration), state persistence
- [x] Custom editor with Enter/Alt+Enter/Esc routing

### Handoff extension
- [x] `/handoff` command — extracts files, context, and task into a new session prompt

## Phase 1: Ralph Enhancements ✅

Ralph is the loop engine for review and work phases.

### Context tree integration
- [x] `contextMode: "fresh" | "tree"` — `"fresh"` uses `newSession()`, `"tree"` uses `navigateTree()` with LLM-generated summaries
- [x] In tree mode: anchor entry at loop start, summaries accumulate as children along the path
- [x] Falls back to fresh context if summarization fails or is cancelled
- [x] `--context tree` CLI flag, defaults to `"fresh"`

### Exit detection
- [x] Dual-signal parsing: exit phrases AND continue-working phrases
- [x] Exit only when `exitPhrase && !continueWorking` — prevents premature exit after fixing things
- [x] Built-in default patterns (`--auto-exit` flag) or custom `ExitPatterns` via programmatic API

### Other enhancements
- [x] Cost ceiling — `--cost-ceiling <dollars>` stops loop when cumulative cost exceeds threshold
- [x] Post-loop summary — rendered markdown table with stop reason, iterations, duration, cost, tokens
- [x] Role sequences — `--roles file1.md,file2.md` cycles task files across iterations

## Phase 2: Conversion Script ✅

Convert compound engineering agents and skills into pi-native prompt templates and skills.

### Setup
- [x] Write `scripts/convert-compound-engineering.sh` — takes compound engineering source, installs into `~/.pi/agent/`
- [x] Source repo cloned/updated to `$XDG_CACHE_HOME/agentkit/compound-engineering-plugin`
- [x] Re-runnable (overwrites on re-run), `--clean` flag to remove everything
- [x] Integrate into `install.sh`

### Agent conversion
- [x] Convert 15 kept agents to skills under `~/.agents/skills/compound-engineering/`
- [x] Map `model` frontmatter (`inherit` → omit, no haiku agents in kept set)
- [x] Replace `mcp__context7__*` → librarian scout (agents didn't contain `Task(...)` calls)

### Skill resolver cleanup
- [x] Replace custom `skill-resolver.ts` with pi's native skill resolver — pi's `skills.ts` already discovers `SKILL.md` files recursively, respects `.gitignore`, handles symlinks, deduplicates

## Phase 3: Workflow Prompts

Each phase is a pi extension under `pi-extensions/ak-<name>/`. Design rationale in [docs/design/2026-04-01-phase-3-workflow-prompts.md](docs/design/2026-04-01-phase-3-workflow-prompts.md).

The sequence follows Horthy's CRISPY split: questions → research → design → structure → plan → work → implement → PR. Mechanical work (file checks, scout dispatch, output writing) is code. The LLM gets a focused prompt for just the interactive/reasoning parts. Cross-cutting patterns live in skills, not inlined.

### `/ak:brainstorm` (Questions)
- [x] Interactive Q&A via `ask_user_question` — one question at a time, structured choices
- [x] Check `docs/brainstorms/` for existing docs, offer resume
- [x] Lightweight repo scan via `finder` (documentarian: describe what exists)
- [x] Product pressure test — challenge whether this is the right problem
- [x] Output: `docs/brainstorms/YYYY-MM-DD-<topic>.md` — questions + problem framing
- [x] Points to `/ak:research`

### `/ak:research` (Facts)
- [ ] Takes research questions from brainstorm, NOT goals
- [ ] Confirm research scope with user before dispatching
- [ ] Dispatch agents in parallel via `scouts`:
  - `finder` (locator), `oracle` (analyzer), `librarian` (web researcher)
  - CE specialist skills when domain-specific research needed
- [ ] Documentarian framing: describe what exists, no opinions, no suggestions
- [ ] Each agent writes to `docs/research/YYYY-MM-DD-<topic>/`
- [ ] YAML frontmatter on artifacts (date, researcher role, branch, git commit)

### `/ak:design` (Where are we going?)
- [ ] Reads research artifacts from `docs/research/`
- [ ] ~200 lines of condensed human↔agent alignment
- [ ] Interactive: present understanding, ask questions, iterate until mental alignment
- [ ] The entire phase IS the conversation — model can't skip it
- [ ] Absorbs CE's requirements concept: current state, desired end state, patterns to follow, requirements, non-goals, resolved design questions
- [ ] Product questions resolve here — never write "TBD" for product decisions
- [ ] Technical questions can defer to plan
- [ ] No implementation details, no task breakdown
- [ ] Output: `docs/design/YYYY-MM-DD-<description>.md`

### `/ak:outline` (How do we get there?)
- [ ] Reads design document from `docs/design/`
- [ ] Phases AND the shape of the solution at each phase
- [ ] Testing checkpoints at each phase
- [ ] Like a C header file — signatures and types, not implementation
- [ ] Lighter interaction: propose, user approves or adjusts, done
- [ ] Output: `docs/outline/YYYY-MM-DD-<description>.md`

### `/ak:plan` (Task checklist)
- [ ] Reads outline from `docs/outline/`
- [ ] If no outline/design exists, suggest `/ak:design` but don't block
- [ ] Vertical slices: each task end-to-end, testable
- [ ] "What We're NOT Doing" section (anti-scope)
- [ ] Success criteria: automated (commands) + manual (human checks)
- [ ] Checkable tasks (`- [ ]`), mutable state
- [ ] Short and structural — sprint backlog, not specification
- [ ] Outline already has the structure; plan is the task checklist

### Plan review (ralph, tree mode)
- [ ] After plan written, ralph runs review in tree mode
- [ ] Each pass reviews plan only — no code writing
- [ ] Heuristics: "What decision is being avoided? What assumptions are unstated? Are tasks vertical slices?"
- [ ] Max 3 passes

### `/ak:work` (Implement)
- [ ] Implement each task with self-review
- [ ] Plan as mutable state — check off items as work progresses
- [ ] Mismatch protocol: Expected / Found / Why this matters
- [ ] After all tasks: one final single-pass review
- [ ] Points to `/ak:review`

### `/ak:review` (Parallel review agents)
- [ ] Ralph review loop, tree mode — each iteration carries summary of prior findings
- [ ] Dispatch parallel review agents via `scouts` (specialist tasks using CE skills):
  - Core set (always): architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle
  - Language-specific (by file type): kieran-python, kieran-typescript, julik-frontend-races
- [ ] Git-based discovery: `git diff` with BASE_SHA/HEAD_SHA scoping
- [ ] Feedback triage: Critical / Important / Minor
- [ ] Report findings — user decides what to fix
- [ ] Anti-sycophancy: forbidden phrases, adversarial framing
- [ ] Max 7 iterations default

### `/ak:finish` (Ship)
- [ ] Verify all tests pass (fresh run)
- [ ] Present 4 options via `ask_user_question`: merge locally, create PR, keep as-is, discard
- [ ] Execute chosen option, clean up worktree if applicable

### `/ak:compound` (Capture solutions)
- [ ] 5 parallel subagents via `scouts`: Context Analyzer, Solution Extractor, Related Docs Finder, Prevention Strategist, Category Classifier
- [ ] Subagents return text only — orchestrator assembles and writes to `docs/solutions/{category}/`
- [ ] Auto-offer on trigger phrases ("that worked", "it's fixed")
- [ ] Context budget check; compact-safe single-pass fallback

### `/ak:triage` (Classify findings)
- [ ] After `/ak:review`, interactively classify findings one-by-one
- [ ] Three options per finding: approve (create todo), skip, customize
- [ ] Standalone prompt — usable independently

### Deferred
- `/ak:handoff` and `/ak:resume` — `/handoff` extension works for now

## Phase 4: Orchestration

### Prompt templates
- [ ] `/lfg` — full sequence: brainstorm → research → design → outline → plan → work → review → finish
- [ ] `/slfg` — same with parallelism where possible
- [ ] `/setup` — project setup workflow

### Overview skill
- [ ] `compound-engineering/SKILL.md` — explains the whole system
- [ ] Maps phases to prompts, describes agent taxonomy, context strategies
- [ ] Cross-cutting patterns: gates, verification, TDD, debugging, anti-sycophancy
- [ ] Replaces what would otherwise go in AGENTS.md

### Utility skills (direct copy)
- [ ] `resolve-pr-parallel`, `changelog`, `git-worktree`, `file-todos`, `document-review`
