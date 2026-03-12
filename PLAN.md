# Agentic Engineering Workflow for Pi

A 6-phase engineering workflow for Pi, drawing from [compound engineering](https://github.com/EveryInc/compound-engineering-plugin), [HumanLayer's Frequent Intentional Compaction](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents), and [Superpowers](https://github.com/obra/superpowers).

## Context

The compound engineering plugin is a Claude Code plugin with 28 agents, 20+ skills, and structured workflows. Rather than using their Pi compat converter (which duplicates functionality we already have), we're building a native workflow that cherry-picks the best ideas from multiple approaches:

- **Compound engineering** — the brainstorm → plan → work → review → compound loop structure, parallel review agents, incremental compounding
- **HumanLayer (FIC)** — research as an explicit phase that produces artifacts to disk, context clearing between phases, parallel research agents
- **Superpowers** — design gates, test-first enforcement (optional)

Our workflow: **brainstorm → research → plan → work → review → compound**

The key difference from compound engineering is separating **research** into its own phase. In compound's `ak:plan`, research and planning are tangled — 4 parallel research agents fire, results land in context, then planning happens in the same loaded session. By splitting them:
- Research artifacts save to disk (like HumanLayer's `thoughts/`)
- Plan reads those artifacts with fresh context
- Research can be re-run without re-planning
- Each phase is a clean dispatch, not a bloated mega-prompt

Additional influences:
- **[pi-review-loop](https://github.com/nicobailon/pi-review-loop)** — iterative review loop (review until "no issues found"), fresh context mode that strips prior iterations for genuinely independent passes, plan review vs. code review distinction. Has rough edges (module-level mutable state, silent pattern failures, stale state between sessions). Pull the best ideas rather than depending on the extension.
- **[branch-driven-development](https://github.com/noahsaso/my-pi/tree/main/skills/superpowers/branch-driven-development)** (from Superpowers/noahsaso) — context branching per role (implementer → spec reviewer → code quality reviewer) for isolation without subagent overhead. Two-stage review: spec compliance first, then code quality.
- **[Superpowers](https://github.com/obra/superpowers)** (obra) — 13 skills covering the full SDLC. Key additions beyond what noahsaso's fork provides: branch completion workflow (4 options: merge/PR/keep/discard), systematic debugging methodology ("3+ failed fixes = question architecture"), anti-sycophancy in review (forbidden phrases list), feedback triage taxonomy (Critical/Important/Minor), "instructions ≠ permission to skip workflows", CSO (Claude Search Optimization) for skill discoverability, partner signal detection (mapping human frustration to process corrections).

**Ralph as the execution engine.** Our ralph extension already provides the core primitives these other tools are building toward: fresh context per iteration (`session.newSession()`), task file re-read each loop (artifacts persist on disk), user steering mid-iteration (`nudge()`), and follow-up queuing. Rather than depending on pi-review-loop or ACM's `context_checkout()`, ralph is the unified engine for iterative work:

| What we want | Where it comes from | How ralph does it |
|---|---|---|
| Fresh context each pass | pi-review-loop, branch-driven-dev | `session.newSession()` per iteration |
| Role isolation (implement → review) | branch-driven-dev | Change `task.md` between iterations to switch roles |
| Exit detection ("no issues found") | pi-review-loop | Add exit condition parsing to ralph's loop |
| Iterative review until clean | pi-review-loop | Ralph loop with review task, exits when clean |
| Artifacts persist across iterations | HumanLayer FIC | Ralph reads/writes to disk, context is fresh but files remain |
| User can redirect mid-work | ralph (unique) | `nudge()` for immediate steering, follow-up queue for next iteration |

What ralph needs to support this:
- **Dual-signal exit detection** — two pattern sets working together: exit patterns ("no issues found", "looks good") and issues-fixed patterns ("Fixed N issues", "Ready for another review"). Exit only when `exitPhrase && !issuesFixed`. Prevents premature exit when the agent says "looks good" after fixing things. Patterns should be configurable per loop.
- **Bifurcated response format in prompts** — review task files must explicitly instruct the agent on the exact phrases to use for both outcomes (issues found → "Fixed [N] issue(s). Ready for another review." / clean → "No issues found."). The prompts are designed *for* the exit detection, not an afterthought.
- **Role sequences** — optional list of task files to cycle through (e.g., implement.md → spec-review.md → quality-review.md) instead of re-reading the same task.md
- **Cost limits** — ralph tracks cost per iteration but has no `maxCost` exit condition. Add a cost ceiling that stops the loop if cumulative cost exceeds a threshold.
- **Post-loop summary** — when ralph finishes, produce a synthetic summary of what happened across iterations (N passes, what was fixed, final status) that the parent session can consume without inheriting all the review context
- **Parallel dispatch within iterations** — ralph is single-agent; the review phase also needs scouts for parallel specialist agents. Ralph handles the iterative loop, scouts handle the fan-out within each iteration.
- **Auto-trigger (future)** — detect patterns in user input ("implement the plan") and auto-activate a review loop. Useful for `/lfg` orchestration. Not needed for initial implementation.
- **Agent-callable tool API (future)** — let the agent programmatically start/stop/configure ralph loops via a registered tool, using a deferred-prompt pattern (set flag in tool, act on it after the turn completes)

Infrastructure built for this:
- Specialist scout for agent dispatch (replacing their `subagent` tool)
- `ask_user_question` tool for structured questions (replacing their tool)
- Librarian scout for library/docs lookup (replacing their context7 MCP server)
- Scouts tool for parallel agent dispatch

## 1. Specialist scout ✅

- [x] `specialist-prompts.md.ts` — preamble + skill content as system prompt, turn budget guidance
- [x] `skill-resolver.ts` — resolves skill names from `~/.agents/skills/`, `~/.pi/agent/skills/`, `.pi/skills/` (walking up). Discriminated union returns, input validation, no silent failures
- [x] `specialist-config.ts` — shared config builder used by standalone tool and parallel dispatch
- [x] Standalone `specialist` tool — single skill dispatch through `executeScout`
- [x] Parallel dispatch — specialist added to `scouts` tool, dynamic config per skill
- [x] Declarative tool access — defaults to `["read", "bash"]`, caller passes `tools` array to opt in to `write`/`edit`
- [ ] **Replace `skill-resolver.ts` with Pi's native skill resolver** — our custom resolver should never have existed. Pi's `skills.ts` already recursively discovers `SKILL.md` files at any depth, respects `.gitignore`, handles symlinks, and deduplicates. Use Pi's resolver directly instead of maintaining a separate one

## 2. MCPorter skill ✅

- [x] `skills/mcporter/SKILL.md` — workflow-agnostic CLI reference for MCPorter
- [x] Covers config (project `./config/mcporter.json`, system `~/.mcporter/mcporter.json`, editor auto-imports)
- [x] Discover (`list`, `--schema`, `--json`), call (`key=value`, `--args`, function-call syntax, ad-hoc servers), manage (`config add/remove/import/doctor`), auth
- [x] Troubleshooting section (`--log-level debug`, `config doctor`, common failure modes)
- [x] Reviewed against writing-cli-skills checklist

## 3. ask_user_question tool ✅

- [x] `pi.registerTool("ask_user_question")` in `pi-extensions/answer/ask-user.ts`
- [x] Multi-question support: `questions: [{ question, context?, options?, allowCustom? }, ...]`
- [x] Uses same `QnAComponent` as `/answer` command — free-text editor, selectable options, inline "Other" editor
- [x] Confirmation screen shows full Q&A summary before submitting
- [x] Shared `renderQAPairs` in `components.ts` used by both confirmation and `renderResult`
- [x] `renderCall` shows tool name, `renderResult` shows Q&A pairs with italic options
- [x] User cancels or no UI → returns `"User cancelled."`
- [x] Extension split into directory: `index.ts`, `extract.ts`, `components.ts`, `ask-user.ts`

**Used by:** `ak:brainstorm` (5 uses), `ak:plan` (4), `setup` (3), skill creation workflows, `test-browser`, `test-xcode`, `report-bug`, `deepen-plan`

## 4. Conversion script

Write `scripts/convert-compound-engineering.sh` (or `.ts`) that takes the compound engineering plugin source and installs it into `~/.pi/agent/` using our infrastructure.

Conversion is **workflow-driven** — one subphase per workflow step, converting only what each workflow needs. This lets us test incrementally rather than converting 47 skills and 28 agents blind.

### Key decisions

**Nested skill directory.** All compound engineering skills install under `~/.agents/skills/compound-engineering/`. Pi's native skill resolver (`skills.ts`) recursively discovers `SKILL.md` files in subdirectories at any depth — no depth limit, no character restrictions on parent directory names. Our specialist extension's custom `skill-resolver.ts` should be replaced with Pi's native resolver — it should have used Pi's resolver from the start.

**Colons in prompt names.** Pi supports colons in prompt filenames. `ak:plan.md` → `/ak:plan`. The name is derived by stripping `.md` from the filename with no character filtering. Use `/ak:` prefix (agentkit) — this is our own workflow, not a compound engineering port.

**Argument interpolation.** Pi uses `$ARGUMENTS` (or `$@`, `$1`, `$2`, `${@:N}`, `${@:N:L}`) — same syntax as Claude Code's `#$ARGUMENTS`. No conversion needed for argument placeholders.

**No context7.** The `.mcp.json` ships a single MCP server (context7 for library docs). Skip it entirely — the librarian scout handles library doc lookup better by going to repo source. No MCPorter config generated.

**No AGENTS.md block.** AGENTS.md is precious real estate. Instead, create a `compound-engineering` overview skill that explains the 6-phase workflow and how the pieces map. The model loads it when working with any `/ak:` workflow.

**Drop Rails/Ruby agents.** 7 of 28 agents are Rails/Ruby-specific (dhh-rails-reviewer, kieran-rails-reviewer, data-integrity-guardian, data-migration-expert, schema-drift-detector, deployment-verification-agent, lint). Drop them.

**Drop Every Inc-specific content.** agent-native-reviewer (agent parity for Every's product), learnings-researcher (searches `docs/solutions/` specific to Every), ankane-readme-writer (Ankane gem style), Proof sharing integration — strip or skip these.

**Drop design agents.** design-iterator, design-implementation-reviewer, figma-design-sync require browser screenshots and Figma access. Skip for now.

### Agent inventory after cuts

| Category | Agent | Lines | Keep? |
|----------|-------|-------|-------|
| research | repo-research-analyst | 136 | ✅ |
| research | best-practices-researcher | 127 | ✅ |
| research | framework-docs-researcher | 107 | ✅ |
| research | git-history-analyzer | 60 | ✅ |
| research | learnings-researcher | 265 | ❌ Every-specific |
| review | architecture-strategist | 68 | ✅ |
| review | code-simplicity-reviewer | 102 | ✅ |
| review | security-sentinel | 115 | ✅ |
| review | performance-oracle | 138 | ✅ |
| review | pattern-recognition-specialist | 73 | ✅ |
| review | kieran-python-reviewer | 134 | ✅ |
| review | kieran-typescript-reviewer | 125 | ✅ |
| review | julik-frontend-races-reviewer | 222 | ✅ |
| review | agent-native-reviewer | 262 | ❌ Every-specific |
| review | dhh-rails-reviewer | 67 | ❌ Rails |
| review | kieran-rails-reviewer | 116 | ❌ Rails |
| review | data-integrity-guardian | 86 | ❌ Rails |
| review | data-migration-expert | 113 | ❌ Rails |
| review | schema-drift-detector | 155 | ❌ Rails |
| review | deployment-verification-agent | 175 | ❌ Rails |
| design | design-iterator | 225 | ❌ Screenshots |
| design | design-implementation-reviewer | 110 | ❌ Figma |
| design | figma-design-sync | 191 | ❌ Figma |
| workflow | bug-reproduction-validator | 83 | ✅ |
| workflow | spec-flow-analyzer | 135 | ✅ |
| workflow | pr-comment-resolver | 85 | ✅ |
| workflow | lint | 17 | ❌ Ruby |
| docs | ankane-readme-writer | 66 | ❌ Every-specific |

**Keeping 14 of 28 agents.**

### Subphase 4a: brainstorm

Simplest entry point — interactive Q&A, no parallel agents.

**Source material:** compound's `ce-brainstorm` + `brainstorming` skill

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:brainstorm.md`
- Knowledge skill: `compound-engineering/brainstorming/SKILL.md` (direct copy)

**What changes from compound's version:**
- `AskUserQuestion tool` → `ask_user_question`
- `Task repo-research-analyst(...)` → specialist tool with `skill="repo-research-analyst"` (lightweight, not the full research phase)
- Proof sharing → strip
- `document-review` skill reference → keep (dependency, converts later)
- References to `/ak:plan` → change to `/ak:research` (research is now the next step, not plan)
- **"Go backward when needed"** (from Superpowers) — explicit permission to revisit earlier phases. If new information surfaces during approach exploration, go back to understanding. Anti-pattern against rigid linear progression

**Agent dependency:** `repo-research-analyst` — convert to skill under `compound-engineering/`

### Subphase 4b: research (NEW — not in compound)

The key addition from HumanLayer. Parallel research agents produce artifacts to disk, then context clears before planning.

**Source material:** The research portion of compound's `ce-plan` (phases that dispatch repo-research-analyst, best-practices-researcher, framework-docs-researcher) + HumanLayer's Frequent Intentional Compaction pattern + HumanLayer's agent role taxonomy.

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:research.md`
- Research artifacts written to `docs/research/YYYY-MM-DD-<topic>/` (not in context)

**Design:**
- Dispatch research agents in parallel via scouts tool (specialist tasks)
- Each agent writes findings to a file in the research directory
- `learnings-researcher` → drop (Every-specific). Replace with a generalized "search project docs/ADRs" approach if the project has them
- `mcp__context7__*` → librarian scout
- `ask_user_question` to confirm research scope before dispatching
- Output: summary of what was researched and where artifacts live

**Agent role taxonomy (from HumanLayer):**

HumanLayer decomposes research into specialized roles with strict boundaries. More principled than compound's domain-named agents (repo-research-analyst, best-practices-researcher). Consider adopting this taxonomy for our specialist skills:

- **Locator** — finds WHERE code lives. Grep/Glob/LS only, never reads file content. Tool restriction enforces the role: gets `["bash"]` not `["read", "bash"]`
- **Analyzer** — understands HOW code works. Reads code, traces data flow, explains architecture. Gets `["read", "bash"]`
- **Pattern finder** — finds similar implementations with code examples. Gets `["read", "bash"]`
- **Web researcher** — external docs, best practices. Gets librarian scout

**Documentarian framing** — research agents document without judging. "YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY." Do not suggest improvements, do not critique. Save that for the review phase. Flip to adversarial "critic" framing for review agents.

**Tool restrictions enforce roles** — stronger than asking nicely. A locator skill declared with `tools: ["bash"]` literally cannot read file contents even if prompted to. Apply this to specialist skill tool declarations.

**YAML frontmatter on research artifacts** — include git commit, branch, date, researcher name. Makes documents self-documenting about when/where they were created. Useful when revisiting old research.

**Agent dependencies:** compound's research agents converted to skills under `compound-engineering/`, potentially restructured around the locator/analyzer/pattern-finder taxonomy

### Subphase 4c: plan

Planning with research already done. Consumes research artifacts from disk, no research of its own.

**Source material:** compound's `ce-plan` minus the research phases + `deepen-plan` + pi-review-loop's plan review

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:plan.md`
- Prompt template: `~/.pi/agent/prompts/deepen-plan.md`

**What changes from compound's version:**
- Remove all research agent dispatch (that's `/ak:research` now)
- Plan reads research artifacts from `docs/research/` directory
- If no research artifacts exist, suggest running `/ak:research` first (but don't block — user might know what they want)
- `AskUserQuestion tool` → `ask_user_question`
- Detail level selection (MINIMAL/MORE/A LOT) → keep, it's useful
- Keep plan output format and file structure

**From HumanLayer's planning approach:**
- **"What We're NOT Doing" section** — explicit anti-scope in every plan prevents scope creep. List what's deliberately excluded and why
- **"No Open Questions" rule** — plans cannot have unresolved questions. If you hit an open question during planning, STOP and resolve it before continuing. Never write placeholders like "TBD" or "to be determined"
- **Bifurcated success criteria** — every plan phase has separate "Automated Verification" (commands the agent can run) and "Manual Verification" (things the human needs to check). Critical for autonomous agents — they can run automated checks but must STOP for manual ones
- **Interactive multi-step planning** — outline first, confirm with user, then flesh out details. Prevents massive wasted generation on the wrong structure
- **Plan resumability** — the plan document itself tracks progress with checkmarks. Future sessions resume from the first unchecked item. The plan is mutable state, not a read-only spec
- **Mismatch protocol** — structured format for when reality differs from plan during implementation: Expected / Found / Why this matters. Referenced in the work phase

**Plan review before implementation (from pi-review-loop):**
- After the plan is written, ralph runs a plan review loop: fresh-context iterations that review the plan document only (not code)
- Each iteration considers the plan from a different angle — feasibility, edge cases, missing requirements, YAGNI violations, ordering issues
- **Document-review assessment heuristics** (from compound's `document-review` skill): "What decision is being avoided? What assumptions are unstated? Where could scope accidentally expand?" — excellent questions for plan review task files
- Critical rule from pi-review-loop's `double-check-plan.md`: review and edit the PLAN DOCUMENT ONLY, do NOT write any code
- Exits when a pass finds no issues, or user approves
- This catches plan problems before any implementation starts — cheaper to fix a plan than to fix code built on a bad plan
- After 2 refinement passes, recommend stopping (diminishing returns)

**Deepen-plan is enrichment, not review (from compound's `deepen-plan`):**

`deepen-plan` and plan review are separate operations:
- **Plan review** (ralph loop) checks plan *quality* — feasibility, edge cases, YAGNI
- **Deepen-plan** enriches the plan with *research* — it's a parallel enrichment pass, not a review loop

How deepen-plan works:
- Parse plan into sections
- Dynamically discover ALL available skills, match relevant ones to plan sections
- Spawn parallel subagents: one per matched skill, one per relevant past learning from `docs/solutions/`
- Search `docs/solutions/` YAML frontmatter for past solved problems relevant to the current plan (learnings-as-context)
- Synthesize all subagent results back into the plan

This is the project-agnostic replacement for the dropped `learnings-researcher`. The compound phase creates docs in `docs/solutions/`, the plan phase (via deepen-plan) consumes them. It's a feedback loop — knowledge compounds across projects.

`/deepen-plan` is a manual trigger to run this enrichment on an existing plan.

### Subphase 4d: work

Implementation phase. Build what the plan says.

**Source material:** compound's `ce-work` + branch-driven-development (Superpowers)

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:work.md`
- Knowledge skill: `compound-engineering/branch-driven-development/SKILL.md`

**What changes from compound's version:**
- `Teammate(...)` swarm mode → strip with note: `(Swarm mode deferred — see ralph extension)`
- `Task` calls for non-swarm work → specialist tool
- Incremental commit guidance → keep
- Test execution and system-wide checks → keep

**From HumanLayer's implementation approach:**
- **Plan as mutable state** — check off items in the plan document as work progresses. If a ralph loop restarts or a new session resumes, pick up from the first unchecked item
- **Mismatch protocol** — when reality differs from plan, document it: Expected / Found / Why this matters. Don't silently deviate — the mismatch record feeds back into the review and compound phases
- **Bifurcated verification per phase** — after completing a plan phase, run automated checks, then STOP for manual verification before proceeding. Multi-phase shortcut: if running consecutively, skip the pause until the last phase
- **"Plans are carefully designed, but reality can be messy"** — give the agent judgment to adapt, but require mismatch documentation when it does

**Execution strategy (from branch-driven-development + subagent-driven-development, powered by ralph):**

Use subagent-driven-development's prompt content (the three role prompts) delivered through ralph's mechanism (role sequences via task file rotation). Best of both: explicit adversarial prompts + structural fresh-context isolation.

- For each task in the plan, ralph runs a role sequence: implement (with self-review) → spec compliance review → code quality review
- **Three-stage review, not two** — self-review is built into the implementer task file (cheap catch before external reviews), then spec compliance, then code quality. Ordering is strict: spec before quality (quality review without spec compliance is wasted work)
- Fresh context per role via ralph's `session.newSession()` — same isolation as `context_checkout()` without ACM dependency. Also solves TDD's "delete means delete" problem structurally — next iteration literally doesn't have old code in context
- **"Do not trust the report"** — review task files use adversarial framing: "The implementer's report may be incomplete, inaccurate, or optimistic. Verify everything independently by reading actual code." More effective than neutral review instructions
- **Full task text inlined** — ralph's task.md must be self-contained with project context, requirements, where the task fits. Fresh-context agents can't efficiently find referenced files
- **Re-review loops are mandatory** — reviewer finds issues → implementer fixes → reviewer reviews again. Ralph's dual-signal exit detection handles this: `exitPhrase && !issuesFixed`
- **Questions written to file** — ralph agents can't ask the user interactively mid-iteration. If unclear, agent writes questions to `questions.md` and stops. User reads, answers, next iteration picks up via follow-up queue
- **TDD enforcement** — implementer task file includes TDD iron law: no production code without failing test first. Spec reviewer checks git history for test-then-implementation commit ordering
- **Final full-implementation review** — after all per-task role sequences complete, one more ralph iteration reviewing the entire implementation together (not just individual tasks)
- Task completion tracked via markdown checklist file (not Claude Code's TodoWrite)

**Gate functions and rationalization prevention (from test-driven-development + verification-before-completion):**

These are cross-cutting prompt patterns included in every task file:

- **Gate functions**: `BEFORE claiming X: IDENTIFY what command proves the claim → RUN it → READ output → VERIFY → THEN claim`. Prevents premature completion claims.
- **Rationalization prevention tables**: Preempt specific LLM excuses ("too simple to test", "should work now", "I'm confident"). These work because they're specific to the exact rationalizations LLMs generate.
- **Red flag phrases**: "should", "probably", "seems to", premature "Great!" / "Done!" — trigger self-correction before claiming completion
- **Verification at every phase exit** — not just the review phase. Plan, work, and review all require evidence before claiming done

### Subphase 4e: review

Parallel review agents verify the work, with iterative loop until clean.

**Source material:** compound's `ce-review` + `file-todos` skill + pi-review-loop ideas

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:review.md`
- Knowledge skill: `compound-engineering/file-todos/SKILL.md` (direct copy)

**What changes from compound's version:**
- Parallel `Task` calls → scouts tool with specialist tasks
- Drop Rails-specific conditional agents
- Agent list trimmed to 14 kept agents (7 review + 3 workflow + 4 research)
- Review agents dispatched in parallel: architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle, pattern-recognition-specialist, kieran-python-reviewer, kieran-typescript-reviewer, julik-frontend-races-reviewer
- `file-todos` skill references → keep as-is
- Ultra-thinking synthesis → keep (the model reads all agent outputs and synthesizes)

**Iterative review powered by ralph (from pi-review-loop ideas):**
- Ralph runs the review loop: task is "review this code," iterates with fresh context until the agent reports clean
- Exit detection added to ralph: parse "no issues found" (without "fixed N issues" in the same response) → stop loop
- Each iteration: dispatch parallel review agents via scouts, synthesize findings, fix issues, next iteration re-reviews
- Review task files use adversarial framing: "Do not trust previous reports. Read actual code. Verify independently."
- Plan review variant: `/ak:review-plan` reviews the plan document before implementation (different task file, same ralph loop)
- Max iterations safety limit (default 7, configurable)
- No dependency on pi-review-loop extension — ralph is the engine, the prompt template defines the review task

**From HumanLayer's validation approach:**
- **Git-based discovery** — when review happens in fresh context, use `git log` + `git diff` to understand what changed. Ralph's fresh-context iterations need this — the reviewer doesn't know what was modified
- **Git SHA-based review scoping** — `BASE_SHA`/`HEAD_SHA` as required parameters in review dispatch, not optional discovery. Review agents know exactly what commit range to examine
- **Structured validation report** — ✓/✗/⚠️ status per plan phase, deviations documented, manual testing items listed
- **"Matches Plan" vs "Deviations from Plan"** — explicitly compare what was done vs what was planned. Catches drift

**From Superpowers' review skills:**
- **Anti-sycophancy** — review task files include a forbidden phrases list: no "You're absolutely right!", "Great point!", "Excellent suggestion!", or gratitude expressions. Actions over words. When processing feedback, READ → UNDERSTAND → VERIFY → EVALUATE → RESPOND → IMPLEMENT
- **Feedback triage taxonomy** — all review findings categorized as Critical (fix immediately, blocks shipping), Important (fix before proceeding), Minor (note for later, don't block). Review synthesis uses this taxonomy to prioritize fixes
- **"Instructions ≠ Permission to Skip Workflows"** — user saying "just ship it" doesn't mean skip review. This goes in the overview skill and is reinforced in review task files

**Relationship to work-phase per-task reviews:**
- The work phase does per-task three-stage review (self → spec → quality) as part of implementing each task
- The review phase is the full-implementation review after ALL tasks are complete — reviewing the whole thing together, not individual pieces
- This catches integration issues, cross-cutting concerns, and things that look fine per-task but don't work together
- Both use ralph as the engine with the same exit detection and fresh-context mechanics

### Subphase 4f: finish

Branch completion after review passes. How does the code land?

**Source material:** Superpowers' `finishing-a-development-branch`

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:finish.md`

**Design:**
- Verify all tests pass (fresh run, not cached results)
- Present 4 options via `ask_user_question`:
  1. **Merge locally** — merge branch to target, delete branch
  2. **Create PR** — push branch, create PR with description
  3. **Keep as-is** — leave branch for manual handling
  4. **Discard** — delete branch and all work (requires typed "discard" confirmation)
- Execute chosen option
- Clean up worktree if applicable

This sits between review and compound — review confirms the code is good, finish lands it.

### Subphase 4h: compound + orchestration

The knowledge documentation phase, orchestration prompts, and handoff system.

**Source material:** compound's `ce-compound` + `compound-docs` + `triage`, `lfg`, `slfg`, `setup`, utility skills + HumanLayer's handoff system

**Produces:**
- Prompt template: `~/.pi/agent/prompts/ak:compound.md`
- Prompt template: `~/.pi/agent/prompts/ak:triage.md`
- Prompt template: `~/.pi/agent/prompts/lfg.md` (adapted to 7-phase flow)
- Prompt template: `~/.pi/agent/prompts/slfg.md` (adapted)
- Prompt template: `~/.pi/agent/prompts/setup.md`
- Prompt template: `~/.pi/agent/prompts/ak:handoff.md` (NEW)
- Prompt template: `~/.pi/agent/prompts/ak:resume.md` (NEW)
- Knowledge skill: `compound-engineering/compound-docs/SKILL.md` (documentation format reference)
- Knowledge skill: `compound-engineering/document-review/SKILL.md` (document refinement)
- Direct-copy remaining utility skills: resolve-pr-parallel, changelog, git-worktree, file-todos

**ak:compound — the knowledge documentation pipeline:**

Not just a "loop back" — it's a 5-parallel-subagent documentation pipeline that fires after a problem is solved:
1. Context Analyzer → YAML frontmatter skeleton
2. Solution Extractor → root cause + code examples
3. Related Docs Finder → cross-references in `docs/solutions/`
4. Prevention Strategist → how to avoid recurrence + test cases
5. Category Classifier → determines `docs/solutions/{category}/{filename}.md`

Subagents return TEXT ONLY — no file writes. Orchestrator assembles and writes one file. This creates the knowledge base that `deepen-plan` consumes — the compounding feedback loop.

- **Auto-invoke on trigger phrases** — "that worked", "it's fixed", "problem solved" → offer to document the solution. Not forced, just offered.
- **Context budget check before launch** — assess remaining context, warn user if low, offer compact-safe mode (single-pass, ~2k tokens). Generalizable: any parallel-dispatch skill should check context first.
- **Compact-safe fallback** — degraded but complete single-pass mode when context is tight. Applicable across all multi-agent dispatch operations.

**ak:triage — post-review interactive classification (from compound's `triage`):**

After `/ak:review` produces findings, `/ak:triage` lets the user interactively classify them:
- Presents findings one-by-one with severity/category/effort metadata
- Three options per finding: approve (create todo), skip, customize
- Creates file-based todos with the file-todos naming convention
- **Model downgrade** — use Haiku for triage. Classification doesn't need Opus. Generalizable: use cheaper models for structured classification/routing tasks.

**Orchestration adapted for 7-phase flow:**
```
/lfg → brainstorm → research → plan → deepen-plan → work → review → finish → resolve-todos
/slfg → same but with parallelism where possible
```

**Handoff system (from HumanLayer):**

Structured context transfer between sessions. Essential for long-running work that exceeds context, or when stopping and resuming later.

`/ak:handoff` produces a handoff document with:
- Task status (completed / WIP / planned)
- Critical references (2-3 most important file paths)
- Recent changes (file:line refs)
- Learnings (patterns discovered, root causes, important knowledge)
- Artifacts (exhaustive list of produced/updated files)
- Action items and next steps

`/ak:resume` consumes a handoff document:
- Reads the handoff fully
- Reads all linked plans/research in main context (NOT via sub-agents — the orchestrator needs full understanding)
- Verifies current state matches handoff claims (code may have changed since handoff was created)
- Handles scenarios: clean continuation, diverged codebase, incomplete work, stale handoff
- Presents synthesis and gets confirmation before acting

Handoffs stored at `docs/handoffs/YYYY-MM-DD-<description>.md`. This is better than ralph's "post-loop summary" because it's bidirectional (create + resume) and has a verification step on resume.

Ralph integration: when a ralph loop hits max iterations or cost ceiling, auto-create a handoff. Next `/ak:resume` picks up from where it left off.

### Cross-cutting skills and patterns

These apply across all phases, not just one. Knowledge skills under `compound-engineering/` referenced by task files.

- **verification-before-completion** — gate function requiring evidence before any completion claim. Include in every task file footer. Prevents the most common LLM failure mode (claiming success without running verification commands).
- **test-driven-development** — TDD iron law for the work phase. Rationalization prevention tables are reusable across all task files. The "delete means delete" rule is structurally solved by ralph's fresh context.
- **systematic-debugging** — orthogonal to the 6-phase workflow but essential when things go wrong during work or review. Four-phase framework: Root Cause Investigation → Pattern Analysis → Hypothesis Testing → Implementation. Key heuristic: **"3+ failed fixes = stop and question architecture."** Prevents infinite fix-attempt loops. Include in every task file as a circuit-breaker.
- **anti-sycophancy** — forbidden phrases list for all review and feedback contexts. No "You're absolutely right!", no gratitude expressions, no "Great point!". Actions over words.
- **partner signal detection** — table mapping human frustration signals to process corrections ("Stop guessing" → return to root cause investigation, "This is wrong" → re-read requirements, "I already told you" → search conversation history). Include in overview skill.
- **"Instructions ≠ Permission to Skip Workflows"** — user saying "just add X" or "just fix it" doesn't mean skip brainstorm/TDD/review. Process exists for a reason. Include in overview skill.
- **CSO (Claude Search Optimization)** — treat skill discoverability like SEO. Rich `description` fields with trigger keywords, token budgets by skill type (getting-started < 150 words, frequent < 200, other < 500). Apply when creating/converting all compound-engineering skills.
- **Context budget check before parallel dispatch** — before any multi-agent operation (research, review, compound), assess context usage and offer a degraded single-pass mode if tight. Prevents compaction mid-workflow, the most common failure mode.
- **Model downgrade for classification** — triage, routing, and structured classification tasks don't need expensive models. Use Haiku where generation quality doesn't matter, only structured decision-making.

### Subphase 4i: overview skill

Create `compound-engineering/SKILL.md` — the overview skill explaining the whole system.

**Contents:**
- The workflow: brainstorm → research → plan → work → review → finish → compound
- How each phase maps to a prompt template (`/ak:brainstorm`, `/ak:research`, `/ak:plan`, `/ak:work`, `/ak:review`, `/ak:finish`, `/ak:compound`)
- How specialist/scouts dispatch works (for the model reading converted skills that reference agents)
- Research agent taxonomy: locator (bash only) → analyzer (read+bash) → pattern-finder (read+bash) → web researcher (librarian)
- Documentarian framing for research, adversarial framing for review
- Which agents are available and what they do
- Ralph as the execution engine: fresh context per iteration, role sequences, exit detection
- Handoff system: `/ak:handoff` and `/ak:resume` for multi-session work
- Artifact conventions: `docs/research/`, `docs/handoffs/`, plan files with checkmarks
- Cross-cutting patterns: gate functions, verification-before-completion, TDD iron law, systematic debugging ("3+ fixes = question architecture"), anti-sycophancy, feedback triage (Critical/Important/Minor)
- "Instructions ≠ Permission to Skip Workflows"
- Partner signal detection table
- CSO guidelines for skill naming and description
- That swarm mode is deferred

This replaces the AGENTS.md block. The model loads it when it needs context about the workflow system.

### What the conversion does NOT do
- Install the compat extension (`compound-engineering-compat.ts`)
- Create any new extension files
- Modify existing Pi extensions
- Install MCPorter/context7 config
- Touch AGENTS.md

## 5. Uninstall/update support

The conversion script should be re-runnable:
- Skills and prompts are overwritten on re-run
- A `--clean` flag removes everything it installed

## 6. Integration into install.sh

Add compound engineering to `install.sh` so it runs as part of the normal agentkit install flow.

**Source repo:** Clone or fetch `EveryInc/compound-engineering-plugin` to `$XDG_CACHE_HOME/agentkit/compound-engineering-plugin` (typically `~/.cache/agentkit/compound-engineering-plugin`). On subsequent runs, `git pull` to update.

**Flow:**
1. `install.sh` checks if the repo exists in the cache dir
2. If not, `git clone https://github.com/EveryInc/compound-engineering-plugin.git`
3. If yes, `git -C <path> pull`
4. Run the conversion script pointing at the cached repo

## 7. Agent model mapping

Some compound engineering agents specify `model: haiku` or `model: inherit` in their frontmatter. The specialist scout already supports a `model` parameter, and the scouts parallel tool passes it through.

**Approach:**
- The conversion script reads each agent's `model` frontmatter field
- Maps Claude Code model names to Pi model IDs (e.g., `haiku` → `claude-haiku-4-5`, `inherit` → omit/use default)
- Embeds the model hint in the converted prompt text so the main agent passes it through when calling the specialist

## 8. Orchestration commands as prompt templates

Commands with `disable-model-invocation: true` (like `/lfg`, `/slfg`) are step-by-step orchestration sequences, not interactive prompts. They tell the model to run a series of other commands in order.

**Approach:** Convert these to Pi prompt templates that list the steps, adapted for the 6-phase flow. The model reads the template and executes each step sequentially. Example for `/lfg`:

```markdown
<!-- ~/.pi/agent/prompts/lfg.md -->
---
description: Full autonomous engineering workflow
argument-hint: "[feature description]"
---
1. Run /ak:brainstorm $ARGUMENTS
2. Run /ak:research on the brainstorm output
3. Run /ak:plan using the research artifacts
4. Run /deepen-plan on the plan file
5. Run /ak:work on the plan file
6. Run /ak:review
7. Run /ak:finish
8. Run /resolve-todo-parallel
...
```

The model already knows how to follow numbered steps. No special machinery needed.

## 9. Teammate/swarm mode (DEFERRED)

`Teammate` is Claude Code's built-in multi-agent swarm primitive. It provides:
- `spawnTeam` — create a named team
- Spawn teammates as background agents with names, inboxes, and colors
- `write` / `broadcast` — message one or all teammates
- `requestShutdown` / `approveShutdown` — graceful teardown
- `approvePlan` — leader approves teammate work
- `cleanup` — tear down the team

Used in `ak:work` swarm mode and the `orchestrating-swarms` skill (1600+ lines).

**Approach:** Map to ralph. Ralph is our in-session iterative loop engine. The mapping isn't 1:1 — ralph doesn't have team messaging or named agents — but the core pattern (spawn background work, coordinate, shut down) overlaps. This is a separate project. For now:
- The conversion script strips `Teammate(...)` calls with a note: `(Swarm mode: see ralph extension for Pi equivalent)`
- The `orchestrating-swarms` skill gets a Pi-specific preamble noting the differences
- Revisit after the basic workflow (`brainstorm → research → plan → work → review → compound`) is working

## Ralph ↔ Teammate Analysis (DEFERRED)

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

This is a separate project. The conversion script strips Teammate calls with a note. Revisit after the 6-phase workflow works.
