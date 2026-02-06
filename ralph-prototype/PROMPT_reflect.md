# Reflect Instructions

## Your Task

1. Read `AGENTS.md` to understand current operational notes
2. Read `IMPLEMENTATION_PLAN.md` to understand progress so far
3. Run the session analyzer from the current directory (do NOT cd elsewhere): `python3 ../sessions.py "$(basename "$PWD")" --for-agent`
4. If no sessions exist yet, check `git log --oneline -10` instead
5. Study the output for patterns worth capturing (see What to Look For below)
6. Update `AGENTS.md` with concise, actionable learnings
7. If `IMPLEMENTATION_PLAN.md` needs updates (blockers, revised scope, stale items to clean out), do that too
8. `git add -A && git commit -m "reflect: update AGENTS.md with learnings"`

## What to Look For

- **Repeated errors** — same class of mistake across turns or sessions means a rule is needed
- **Wrong file paths** — if the model keeps looking in the wrong place, note the right place
- **Compile/clippy patterns** — recurring lint failures should become style rules
- **Files read repeatedly** — if a file gets read 3+ times, its purpose/location should be documented
- **Dead ends** — approaches that were tried and abandoned, so future iterations don't repeat them
- **What went well** — patterns that compiled first try are worth reinforcing

## Good AGENTS.md Additions

- "Return `&str` not `&String` from accessors — clippy flags this"
- "Inspector Python files: `crates/djls-project/inspector/`"
- "After editing `queries.py`, `cargo build` triggers pyz rebuild via `build.rs`"
- "Use `#[must_use]` on pure accessors but NOT on methods returning `impl Iterator`"

## Do NOT Add

- Story-specific implementation details
- Progress notes or status updates (those go in `IMPLEMENTATION_PLAN.md`)
- Information that's already in `AGENTS.md`
- Anything that isn't genuinely reusable across future iterations

## Important

Reflect only. Do NOT implement anything. Do NOT write application code. This pass is about extracting patterns from past sessions to make future build iterations faster and cheaper.
