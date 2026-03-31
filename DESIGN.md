# Design: Agentic Engineering Workflow

Rationale and decisions behind the `/ak:*` workflow. The implementation plan is in [PLAN.md](PLAN.md).

## Influences

This workflow draws from several sources:

- **[Compound engineering](https://github.com/EveryInc/compound-engineering-plugin)** — brainstorm → plan → work → review → compound loop structure, parallel review agents, knowledge compounding
- **[HumanLayer FIC](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents)** — research as an explicit phase producing disk artifacts, parallel research agents with role taxonomy (locator/analyzer/pattern-finder/web-researcher)
- **[Superpowers](https://github.com/obra/superpowers)** — design gates, branch completion workflow, anti-sycophancy, feedback triage, systematic debugging
- **[Branch-driven development](https://github.com/noahsaso/my-pi/tree/main/skills/superpowers/branch-driven-development)** (noahsaso/Superpowers fork) — role isolation per context branch (implementer → spec reviewer → quality reviewer)
- **[pi-review-loop](https://github.com/nicobailon/pi-review-loop)** — iterative review until clean, plan review vs code review distinction
- **[Everything We Got Wrong About RPI](reference/everything-we-got-wrong-about-rpi-dex-horthy.md)** (Dexter Horthy, 2026) — instruction budget limits (~150-200 per session), design discussion as the human checkpoint before planning, vertical slicing over horizontal, plans as disposable scaffolding not reviewed artifacts

## Key Decision: Context Tree Over Fresh Context

The original plan committed to ralph's `session.newSession()` for fresh context on every iteration. This was wrong for review loops.

**The problem with fresh context for review:** each iteration starts blind. The reviewer doesn't know what previous iterations found or fixed. It re-discovers the same issues, misses the progression of fixes, and can't build on prior understanding.

**Pi's context tree is the better primitive.** Pi sessions are trees, not linear chats. Each message has an `id` and `parentId`. The programmatic API provides:

- `ctx.navigateTree(targetId, { summarize: true })` — jump back to an earlier point, compressing the abandoned branch into a summary. The next iteration starts from that point with institutional knowledge of what happened.
- `ctx.fork(entryId)` — create a new session file from a branch point. True isolation when you need it.

**How this maps to workflow phases:**

| Phase | Context strategy | Why |
|-------|-----------------|-----|
| Research | Fork (new session) | Artifacts go to disk. Agent doesn't need prior context |
| Plan review | Tree with summary | Reviewer needs to know what prior passes found |
| Work (per-task) | Fork (new session) | Fresh start prevents implementation debris from accumulating |
| Code review | Tree with summary | Reviewer builds on prior findings, tracks fix progression |
| Compound | Fork (new session) | Documentation is self-contained, reads artifacts from disk |

**Ralph's role changes:** Ralph stays as the loop engine (iteration tracking, stats, steering, exit detection). But instead of always creating fresh sessions, it uses `ctx.navigateTree()` for review loops — tree back to the loop start with a summary, so the next iteration has context.

## Workflow: brainstorm → research → design → structure → plan → work → review → finish → compound

Two key structural differences from compound engineering:

**Research as its own phase.** In compound's `ak:plan`, research and planning are tangled — 4 parallel research agents fire, results land in context, then planning happens in the same loaded session. By splitting:
- Research artifacts save to disk (like HumanLayer's `thoughts/`)
- Plan reads those artifacts with fresh context
- Research can be re-run without re-planning

**Design as the human checkpoint.** From Horthy's revised RPI methodology: planning should split into a design discussion (where are we going?), a structural outline (how do we get there?), and task-level detail. The design discussion — a short artifact covering current state, desired end state, and patterns to follow — is where the human reviews and corrects the agent's understanding before any code or detailed plan exists. Everything downstream gets cheaper because the mental model is right.

**Structure as the bridge between design and plan.** If design is "where are we going," structure is "how do we get there." It's sprint planning — a high-level overview of phases, testing checkpoints, and the shape of the work. Like a C header file: signatures and types, not implementation. The human confirms the structure before detailed planning begins.

The plan then becomes lightweight scaffolding: vertical slices filling in the structure, not a reviewed artifact. No plan enrichment — the review investment happens at the design and structure stages.

## Research Agent Taxonomy

From HumanLayer, adapted for pi's scout system:

| Role | Tools | Purpose |
|------|-------|---------|
| Locator | `["bash"]` only | Finds WHERE code lives. Grep/glob/ls, never reads content |
| Analyzer | `["read", "bash"]` | Understands HOW code works. Traces data flow, explains architecture |
| Pattern finder | `["read", "bash"]` | Finds similar implementations with code examples |
| Web researcher | librarian scout | External docs, best practices |

Tool restrictions enforce roles — a locator skill with `tools: ["bash"]` literally cannot read files even if prompted to.

**Documentarian framing** for research: "YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY." No suggestions, no critique. Save that for review.

**Adversarial framing** for review: "Do not trust previous reports. Read actual code. Verify independently."

## Cross-Cutting Patterns

These apply across all phases:

**Instruction budget.** Frontier LLMs follow ~150-200 instructions with good consistency. Each prompt template targets <40 instructions. Cross-cutting patterns live in skills loaded on demand, not inlined into every prompt.

**Vertical slicing.** Models default to horizontal plans (all DB → all services → API → frontend), producing large batches of untestable code. Each plan task must be a vertical slice — end-to-end through all layers, producing a testable increment.

**Gate functions.** `BEFORE claiming X: IDENTIFY what command proves the claim → RUN it → READ output → VERIFY → THEN claim`. Prevents premature completion.

**Systematic debugging.** Four phases: Root Cause Investigation → Pattern Analysis → Hypothesis Testing → Implementation. "3+ failed fixes = stop and question architecture."

**Anti-sycophancy.** Forbidden phrases in review: "You're absolutely right!", "Great point!", "Excellent suggestion!". Actions over words.

**Feedback triage.** All findings categorized: Critical (fix immediately), Important (fix before proceeding), Minor (note for later).

**Verification at every exit.** Not just review — plan, work, and review all require evidence before claiming done.

**Rationalization prevention.** Preempt specific LLM excuses: "too simple to test", "should work now", "I'm confident". Red flag phrases: "should", "probably", "seems to", premature "Done!".

**Partner signal detection.** Map frustration to process corrections: "Stop guessing" → return to root cause investigation. "This is wrong" → re-read requirements. "I already told you" → search conversation history.

**"Instructions ≠ Permission to Skip Workflows."** User saying "just ship it" doesn't mean skip review.

## Agent Inventory

Compound engineering has 28 agents. We keep 14 after dropping Rails-specific (7), Every Inc-specific (3), and design/Figma agents (3), and the linter (1).

**Research agents:** repo-research-analyst, best-practices-researcher, framework-docs-researcher, git-history-analyzer

**Review agents:** architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle, pattern-recognition-specialist, kieran-python-reviewer, kieran-typescript-reviewer, julik-frontend-races-reviewer

**Workflow agents:** bug-reproduction-validator, spec-flow-analyzer, pr-comment-resolver

## Conversion Approach

**Nested skill directory.** All compound skills install under `~/.agents/skills/compound-engineering/`. Pi's skill resolver discovers `SKILL.md` files recursively at any depth.

**Colons in prompt names.** Pi supports them. `ak:plan.md` → `/ak:plan`.

**No context7.** Librarian scout replaces it.

**No AGENTS.md block.** An overview skill explains the system instead.

**Argument interpolation.** Pi uses `$ARGUMENTS` — same syntax as Claude Code's `#$ARGUMENTS`.

## Deferred: Teammate/Swarm Mode

Ralph is a single-agent loop. Teammate is a multi-agent coordination system (N parallel workers, inbox messaging, task DAGs). The mapping isn't 1:1. Revisit after the basic workflow works.
