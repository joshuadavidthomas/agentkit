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

## Phase 2: Conversion Script

Convert compound engineering agents and skills into pi-native prompt templates and skills.

### Setup
- [ ] Write `scripts/convert-compound-engineering.sh` — takes compound engineering source, installs into `~/.pi/agent/`
- [ ] Source repo cloned/updated to `$XDG_CACHE_HOME/agentkit/compound-engineering-plugin`
- [ ] Re-runnable (overwrites on re-run), `--clean` flag to remove everything
- [ ] Integrate into `install.sh`

### Agent conversion
- [ ] Convert 14 kept agents to skills under `~/.agents/skills/compound-engineering/`
- [ ] Map `model` frontmatter (e.g., `haiku` → `claude-haiku-4-5`, `inherit` → omit)
- [ ] Replace `Task(...)` calls → specialist tool, `mcp__context7__*` → librarian scout

### Skill resolver cleanup
- [x] Replace custom `skill-resolver.ts` with pi's native skill resolver — pi's `skills.ts` already discovers `SKILL.md` files recursively, respects `.gitignore`, handles symlinks, deduplicates

## Phase 3: Workflow Prompts

Each phase is a prompt template under `~/.pi/agent/prompts/`. Listed in workflow order.

### `/ak:brainstorm`
- [ ] Interactive Q&A using `ask_user_question`
- [ ] Lightweight repo research via specialist (not the full research phase)
- [ ] Permission to revisit earlier phases when new information surfaces
- [ ] Points to `/ak:research` as the next step

### `/ak:research`
- [ ] Dispatch research agents in parallel via scouts (specialist tasks)
- [ ] Each agent writes findings to `docs/research/YYYY-MM-DD-<topic>/`
- [ ] Confirm research scope with user before dispatching
- [ ] YAML frontmatter on artifacts (git commit, branch, date, researcher)
- [ ] `mcp__context7__*` calls → librarian scout

### `/ak:plan`
- [ ] Reads research artifacts from `docs/research/`
- [ ] If no artifacts exist, suggest `/ak:research` but don't block
- [ ] Detail level selection (MINIMAL/MORE/A LOT)
- [ ] "What We're NOT Doing" section — explicit anti-scope
- [ ] "No Open Questions" rule — resolve before continuing, never write "TBD"
- [ ] Bifurcated success criteria: automated verification (commands) vs manual verification (human checks)
- [ ] Plan tracks progress with checkmarks — mutable state, not read-only spec
- [ ] Interactive: outline first, confirm with user, then detail

### Plan review (ralph loop, tree mode)
- [ ] After plan is written, ralph runs review iterations using tree navigation
- [ ] Each pass reviews the plan document only — no code writing
- [ ] Assessment heuristics: "What decision is being avoided? What assumptions are unstated?"
- [ ] Exits when clean or after 2 refinement passes (diminishing returns)

### `/deepen-plan`
- [ ] Parse plan into sections
- [ ] Discover all available skills, match relevant ones to plan sections
- [ ] Spawn parallel subagents (one per matched skill)
- [ ] Search `docs/solutions/` for relevant past learnings
- [ ] Synthesize results back into the plan
- [ ] Manual trigger — enrichment, not review

### `/ak:work`
- [ ] For each plan task, ralph runs a role sequence (fresh context per role):
  1. Implement (with self-review)
  2. Spec compliance review
  3. Code quality review
- [ ] Three-stage review: self-review → spec → quality. Spec before quality (quality without spec compliance is waste)
- [ ] Review task files use adversarial framing: "The implementer's report may be incomplete. Verify independently."
- [ ] Plan as mutable state — check off items as work progresses
- [ ] Mismatch protocol: Expected / Found / Why this matters — when reality differs from plan
- [ ] Gate functions and rationalization prevention in every task file
- [ ] After all per-task sequences: one final full-implementation review

### `/ak:review`
- [ ] Ralph review loop using tree mode — each iteration carries summary of prior findings
- [ ] Dispatch parallel review agents via scouts: architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle, pattern-recognition-specialist, language-specific reviewers
- [ ] Synthesize findings, fix issues, next iteration re-reviews
- [ ] Git-based discovery: `git log` + `git diff` with `BASE_SHA`/`HEAD_SHA` scoping
- [ ] Feedback triage: Critical / Important / Minor
- [ ] Anti-sycophancy: forbidden phrases list
- [ ] Max iterations safety (default 7)

### `/ak:finish`
- [ ] Verify all tests pass (fresh run)
- [ ] Present 4 options via `ask_user_question`: merge locally, create PR, keep as-is, discard
- [ ] Execute chosen option, clean up worktree if applicable

### `/ak:compound`
- [ ] 5 parallel subagents: Context Analyzer, Solution Extractor, Related Docs Finder, Prevention Strategist, Category Classifier
- [ ] Subagents return text only — orchestrator assembles and writes to `docs/solutions/{category}/`
- [ ] Auto-offer on trigger phrases ("that worked", "it's fixed")
- [ ] Context budget check before launching parallel agents
- [ ] Compact-safe single-pass fallback when context is tight

### `/ak:triage`
- [ ] After `/ak:review`, interactively classify findings one-by-one
- [ ] Three options per finding: approve (create todo), skip, customize
- [ ] Use cheaper model for classification (Haiku)

### `/ak:handoff` and `/ak:resume`
- [ ] `/ak:handoff` produces structured document: status, references, changes, learnings, artifacts, next steps
- [ ] `/ak:resume` reads handoff, verifies current state matches claims, handles divergence
- [ ] Stored at `docs/handoffs/YYYY-MM-DD-<description>.md`
- [ ] Ralph auto-creates handoff when hitting max iterations or cost ceiling

## Phase 4: Orchestration

### Prompt templates
- [ ] `/lfg` — full sequence: brainstorm → research → plan → deepen → work → review → finish
- [ ] `/slfg` — same with parallelism where possible
- [ ] `/setup` — project setup workflow

### Overview skill
- [ ] `compound-engineering/SKILL.md` — explains the whole system
- [ ] Maps phases to prompts, describes agent taxonomy, context strategies
- [ ] Cross-cutting patterns: gates, verification, TDD, debugging, anti-sycophancy
- [ ] Replaces what would otherwise go in AGENTS.md

### Utility skills (direct copy)
- [ ] `resolve-pr-parallel`, `changelog`, `git-worktree`, `file-todos`, `document-review`
