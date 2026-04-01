# Phase 3: Workflow Prompts — Design

Each prompt template is a markdown file at `~/.pi/agent/prompts/ak:<name>.md`. Prompt templates use YAML frontmatter for description and `$ARGUMENTS` / `$@` for argument interpolation. They're user messages the LLM interprets using available tools (ask_user_question, scouts, specialist, review_loop, read, bash, write, edit).

## Design Principles

**Instruction budget.** Each prompt targets <40 instructions. Cross-cutting patterns (gates, verification, anti-sycophancy, debugging) live in skills loaded on demand, not inlined.

**No magic words.** Interactive steps are structural, not optional. If a phase requires back-and-forth with the user, the entire phase IS the back-and-forth — the model can't skip it because there's nothing else in the prompt to jump to.

**Separate facts from opinions.** Research documents what exists (facts). Design introduces what to build (intent). Mixing them corrupts both.

**Phases feed forward.** Each phase reads the previous phase's disk artifact. The sequence is linear:

```
brainstorm → research → design → outline → plan → [plan review] → work → review → finish
```

## Influences

| Source | What we take |
|--------|-------------|
| Compound Engineering | Brainstorm dialogue, review agent personas, compound solution docs, lfg orchestration |
| HumanLayer FIC | Research as disk artifacts, parallel agents by role, documentarian framing |
| Superpowers | Verification gates, anti-sycophancy, persuasion guardrails (one question at a time, structured choices, incremental validation) |
| Branch-driven development | Role isolation, "Do Not Trust the Summary," independent verification |
| Pi Review Loop | Iterative review until clean, exit detection, plan vs code review (already in ralph) |
| Horthy/CRISPY | Split plan into design → structure → plan. Design as human checkpoint. <40 instructions. Vertical slicing. Plans as disposable scaffolding. Questions feed research, not goals. |

## Prompt Specifications

### 1. `/ak:brainstorm`

**Job:** Generate research questions through interactive Q&A with the user.

**Inputs:** `$ARGUMENTS` (feature idea or problem area), optionally an existing brainstorm doc.

**Flow:**
1. Check `docs/brainstorms/` for existing docs on this topic, offer to resume
2. Lightweight repo scan via `finder` — documentarian framing, understand what exists
3. Product pressure test — challenge the framing ("Is this the right problem?")
4. Interactive Q&A via `ask_user_question` — one question at a time, prefer structured choices, validate incrementally
5. Match depth to complexity (single instruction, not routing trees)
6. Write output to `docs/brainstorms/YYYY-MM-DD-<topic>.md`

**Output:** Questions + problem framing. Not a full requirements doc. Minimum contract: problem statement, research questions, initial non-goals.

**Points to:** `/ak:research`

**Draws from:** Horthy (questions step), CE (scope assessment, pressure test), Superpowers (persuasion guardrails)

**What we drop from CE:** Elaborate phase routing (0.2/0.3/0.4), visual aid instructions, Proof sharing, document-review subagent, platform-specific tool detection, requirements doc template with stable IDs (that moves to design).

### 2. `/ak:research`

**Job:** Answer the brainstorm questions. Document what exists factually. No opinions, no suggestions.

**Inputs:** `$ARGUMENTS` (path to brainstorm doc or topic area).

**Flow:**
1. Read brainstorm questions (from `docs/brainstorms/` or arguments)
2. Present proposed research scope to user, confirm before dispatching
3. Dispatch agents in parallel via `scouts`:
   - **Locator** → `finder` scout (finds WHERE code lives)
   - **Analyzer** → `oracle` scout (understands HOW code works)
   - **Pattern finder** → `specialist` with `repo-research-analyst` skill
   - **Web researcher** → `librarian` scout (external docs)
   - Additional CE specialist skills when domain-specific research is needed
4. All agents are documentarians: "YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY." No suggestions, no critique.
5. Each agent writes findings to `docs/research/YYYY-MM-DD-<topic>/`
6. YAML frontmatter on artifacts: date, researcher role, branch, git commit

**Output:** Research artifacts on disk. Facts about the codebase organized by the questions from brainstorm.

**Points to:** `/ak:design`

**Draws from:** HumanLayer FIC (documentarian framing, parallel agents, disk artifacts, YAML frontmatter), Horthy ("hide ticket from researcher," questions feed research not goals).

### 3. `/ak:design`

**Job:** Where are we going? ~200 lines of condensed human↔agent alignment. The human checkpoint.

**Inputs:** `$ARGUMENTS` (path to research dir or description).

**Flow:**
1. Read research artifacts from `docs/research/`
2. Present understanding of current state back to user
3. Interactive back-and-forth: "Where are we going? What should the end state look like?"
4. Iterate with user until mental alignment is achieved — the entire phase IS this conversation
5. Write design doc to `docs/design/YYYY-MM-DD-<description>.md`

**Output:** Design doc containing: current state, desired end state, patterns to follow, requirements, non-goals, resolved design questions. Absorbs what CE's requirements doc was doing, but comes after research (grounded in facts, not opinions).

**Rules:**
- Product questions must resolve here. No "TBD" for product decisions.
- Technical questions can defer to plan.
- No implementation details, no task breakdown — that's outline and plan.
- This is the human checkpoint — if the agent's design concept is wrong, everything downstream is waste.

**Points to:** `/ak:outline`

**Draws from:** Horthy (design discussion, mental alignment, Matt Pocock quote), CE (requirements structure adapted).

### 4. `/ak:outline`

**Job:** How do we get there? Phases AND the shape of the solution at each phase.

**Inputs:** `$ARGUMENTS` (path to design doc).

**Flow:**
1. Read design doc from `docs/design/`
2. Propose: phases, what each delivers, how you'd test it, shape of the solution at each phase
3. Lighter interaction than design — propose, user approves or adjusts, done
4. Write outline to `docs/outline/YYYY-MM-DD-<description>.md`

**Output:** High-level overview. Like a C header file — signatures and types, not implementation. Testing checkpoints at each phase.

**Points to:** `/ak:plan`

**Draws from:** Horthy (structure outline, "design == where, structure == how").

### 5. `/ak:plan`

**Job:** Task checklist with enough context to execute. Disposable scaffolding.

**Inputs:** `$ARGUMENTS` (path to outline doc).

**Flow:**
1. Read outline from `docs/outline/`
2. If no design/outline exists, suggest `/ak:design` but don't block
3. Break work into vertical slices — each end-to-end through all layers, producing a testable increment
4. Write plan with checkable tasks (`- [ ]` syntax)
5. Include "What We're NOT Doing" section (anti-scope)
6. Success criteria: automated verification (commands) + manual verification (human checks)
7. After writing, ralph runs plan review: tree mode, max 3 passes

**Output:** Plan doc with checkbox tasks. Mutable — check off items as work progresses. Short and structural, closer to a sprint backlog than a specification.

**The outline already has the structure.** Plan is literally a task checklist. Don't repeat the outline's architecture decisions.

**Plan review heuristics:** "What decision is being avoided? What assumptions are unstated? Are tasks vertical slices?"

**Points to:** `/ak:work`

**Draws from:** Horthy (disposable scaffolding, vertical slicing), Pi Review Loop (plan review via ralph).

### 6. `/ak:work`

**Job:** Implement each plan task with self-review. Check off plan items as work progresses.

**Inputs:** `$ARGUMENTS` (path to plan doc).

**Flow:**
1. Read plan, identify next unchecked task
2. Implement the task
3. Self-review: does it work? Does it match what the plan said?
4. Check off the task in the plan doc
5. Repeat for each task
6. After all tasks: one final single-pass review of the full implementation

**Plan as mutable state.** The plan tracks progress with checkmarks. The agent updates it as work progresses.

**Mismatch protocol.** When reality differs from plan: Expected / Found / Why this matters.

**Points to:** `/ak:review`

**Draws from:** CE (plan as mutable state), Superpowers (verification gates, TDD), Branch-driven dev (self-review).

### 7. `/ak:review`

**Job:** Parallel review agents, ralph loop, report findings. User decides what to fix.

**Inputs:** `$ARGUMENTS` (optional: BASE_SHA or scope).

**Flow:**
1. Git-based discovery: `git diff` scoping with BASE_SHA/HEAD_SHA
2. Dispatch parallel review agents via `scouts` (specialist tasks using CE skills):
   - **Core set (always):** architecture-strategist, code-simplicity-reviewer, security-sentinel, performance-oracle
   - **Language-specific (based on file types):** kieran-python-reviewer, kieran-typescript-reviewer, julik-frontend-races-reviewer
3. Synthesize findings with triage: Critical / Important / Minor
4. Report findings to user — user decides what to fix
5. Ralph loop, tree mode: each iteration carries summary of prior findings
6. Max 7 iterations default

**Anti-sycophancy:** Forbidden phrases in review output. Actions over words.

**Adversarial framing:** "The implementer's report may be incomplete. Verify independently."

**Points to:** `/ak:finish` or `/ak:triage`

**Draws from:** CE (review agent personas), Superpowers (anti-sycophancy, verification), Branch-driven dev ("Do Not Trust the Summary"), Pi Review Loop (iterative until clean).

### 8. `/ak:finish`

**Job:** Verify tests pass, present options, execute chosen option.

**Inputs:** None required.

**Flow:**
1. Verify all tests pass (fresh run)
2. Present 4 options via `ask_user_question`: merge locally, create PR, keep as-is, discard
3. Execute chosen option
4. Clean up worktree if applicable

**Draws from:** CE (finish workflow).

### 9. `/ak:compound`

**Job:** Capture solution while context is fresh. 5 parallel subagents.

**Inputs:** `$ARGUMENTS` (description of what was solved).

**Flow:**
1. 5 parallel subagents via `scouts`: Context Analyzer, Solution Extractor, Related Docs Finder, Prevention Strategist, Category Classifier
2. Subagents return text only — orchestrator assembles
3. Write to `docs/solutions/{category}/`
4. Auto-offer on trigger phrases ("that worked", "it's fixed")
5. Context budget check before launching agents
6. Compact-safe single-pass fallback when context is tight

**Draws from:** CE (compound skill, unchanged approach).

### 10. `/ak:triage`

**Job:** After `/ak:review`, interactively classify findings one-by-one.

**Inputs:** `$ARGUMENTS` (path to review findings or review output).

**Flow:**
1. Read review findings
2. Present each finding one at a time
3. Three options per finding: approve (create todo), skip, customize
4. Standalone prompt — can be used independently of the full workflow

**Draws from:** CE (triage workflow).

## Deferred

- `/ak:handoff` and `/ak:resume` — `/handoff` extension works fine for now
- Phase 4 orchestration (`/lfg`, `/slfg`, `/setup`) — depends on all Phase 3 prompts existing
- Overview skill — depends on all Phase 3 prompts existing

## Implementation Order

Dependency-sorted. Each prompt can be tested standalone before the next is built.

1. **ak:brainstorm** — no dependencies, establishes the pattern
2. **ak:research** — depends on brainstorm output format
3. **ak:design** — depends on research output format
4. **ak:outline** — depends on design output format
5. **ak:plan** — depends on outline output format + ralph (already built)
6. **ak:work** — depends on plan output format
7. **ak:review** — depends on CE review skills (already converted) + ralph
8. **ak:finish** — depends on nothing specific, can be built anytime
9. **ak:compound** — standalone, can be built anytime
10. **ak:triage** — depends on review output format

**Parallel track:** ak:finish, ak:compound, and ak:triage have no upstream dependencies and can be built alongside the main sequence.

## Cross-Cutting Concerns

These live in skills, not in prompt templates:

- **Gate functions** — "BEFORE claiming X: run command, read output, verify, THEN claim"
- **Verification discipline** — evidence before completion claims
- **Anti-sycophancy** — forbidden phrases list
- **Systematic debugging** — 4-phase methodology, 3-fix threshold
- **Rationalization prevention** — red flag phrases: "should", "probably", "seems to"
- **Partner signal detection** — map frustration to process corrections

These are already partially covered by existing skills and AGENTS.md. Phase 4's overview skill will formalize them.
