# Build Instructions

## Your Task

1. Read `AGENTS.md` for build commands and code style rules
2. Read `IMPLEMENTATION_PLAN.md` to understand current progress
3. If `IMPLEMENTATION_PLAN.md` does not exist, create it (see Planning below) and stop
4. Check `.agents/ROADMAP.md` and `ls .agents/plans/` for milestones not yet in `IMPLEMENTATION_PLAN.md` — if any are missing, add stub entries (this is a planning iteration — commit and stop)
5. Pick the next unchecked task from the plan
6. Read the plan for the current milestone only (e.g., `.agents/plans/2026-02-05-m1-payload-library-name-fix.md`)
7. Before making changes, search the codebase — don't assume something isn't implemented
8. Implement that single task completely
9. Run quality checks: `cargo build`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`
10. If checks pass, mark the task complete in `IMPLEMENTATION_PLAN.md` and note any discoveries
11. `git add -A && git commit` with a descriptive message

## Planning

When there are no unchecked tasks available (either the plan doesn't exist or the current milestone is complete), this is a planning iteration:

1. If `IMPLEMENTATION_PLAN.md` doesn't exist, read `.agents/ROADMAP.md` and the charter at `.agents/charter/2026-02-05-template-validation-port-charter.md`, then create it with stub entries for all milestones
2. Read the next milestone's plan from `.agents/plans/` (the first incomplete one)
3. Expand that milestone's section in `IMPLEMENTATION_PLAN.md` with detailed tasks
4. `git add -A && git commit`

Only read one milestone plan at a time — never load all of them upfront. Some milestones are split across multiple phase files (e.g., `m3.1-load-scoping.md`, `m3.2-load-scoping.md`). Read the overview file (e.g., `m3-load-scoping.md`) to understand the milestone structure, then read individual phase files only as you work on them.

Each phase should end with a validation task (`cargo build`, `cargo clippy`, `cargo test`) so every phase is independently green.

Do NOT implement anything during a planning iteration.

## Quality Requirements

- ALL commits must pass quality checks. Use `-q` to minimize context noise:
  - `cargo build -q`
  - `cargo clippy -q --all-targets --all-features -- -D warnings`
  - `cargo test -q`
- Do NOT commit broken code
- Keep changes focused to the current task
- Follow existing code patterns in the codebase

## Project-Specific Rules

- This is a Rust project using `tower-lsp-server` NOT `tower-lsp`. Imports are `tower_lsp_server::*`.
- Use `insta` for snapshot tests in the template parser. Never create standalone test files.
- Salsa must maintain exactly 2 inputs (`File` + `Project`). Do NOT add new `#[salsa::input]` types.
- For extraction (M5), use `ruff_python_parser` NOT `rustpython-parser`. Pin to a specific git SHA.
- The Python prototype in `template_linter/` is the behavioral reference for what the Rust code should do.

## Update AGENTS.md

If you discover something operational that future iterations should know, add it to `AGENTS.md`. Good additions:

- "After editing `queries.py`, `cargo build` triggers pyz rebuild via `build.rs`"
- "Return `&str` not `&String` from accessors — clippy flags this"
- "`TemplateTags` does not implement `Deref` — use `.iter()`, `.tags()`, `.len()`"

Do NOT add progress notes or status updates — those belong in `IMPLEMENTATION_PLAN.md`. A bloated `AGENTS.md` pollutes every future iteration's context.

## Stop Condition

After completing your work — creating the plan, expanding a milestone, or implementing a task — commit and stop. Do not start the next piece of work.

Before declaring completion, check `.agents/ROADMAP.md` and list `.agents/plans/` for milestones not yet tracked in `IMPLEMENTATION_PLAN.md`. If new milestones exist, add stub entries for them (this is a planning iteration — commit and stop). Only when `IMPLEMENTATION_PLAN.md` accounts for every milestone in the roadmap/plans AND every task is checked off, reply with exactly `PLAN_COMPLETE` and stop.
