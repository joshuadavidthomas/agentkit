# Rust Skills — Working Prompt

Read `PLAN.md` for the full context, skill list, design principles, and reference material inventory.

## What we're doing

Building a set of Rust skills for AI agents. The skills don't teach Rust — the agent already knows Rust. They encode the ecosystem's preferred patterns and practices as the agent's *defaults*, so it writes idiomatic Rust without the user having to repeatedly correct it.

The core problem: agents write Rust that compiles but thinks like Python/TypeScript. Bare Strings for domain types, booleans for states, trait objects for closed sets, runtime validation instead of type-level guarantees. These skills fix that.

## How to work

1. Load the **skill-authoring** skill — it is the authority on skill format, frontmatter, description writing, progressive disclosure, and structure. Defer to it on all questions of how a skill should be written.
2. Read `PLAN.md` to understand the full skill set and build order.
3. Find the next skill to build — each skill section has a **Status** field. Follow the build order in the plan.
4. Read the relevant reference material listed in the plan for that skill.
5. Study the following skills as examples: 
    - `skills/salsa-*` skills in this repo 
    - `reference/dot-skills/skills/.curated/rust/`
    - `reference/dot-skills/skills/.experimental/rust-*`
    - `reference/rust-skills/skills/*` (meta-framework is a bit overkill, but the rest is good)
    - `reference/claude-skills/skills/rust-engineer`
6. Build the skill following the conventions in `PLAN.md`, the skill-authoring skill's guidelines, and the patterns established by salsa-*.
7. Mark the skill as DONE in the plan.

## Tone

Prescriptive, not descriptive. "Do this" not "here's how this works." Rules cite ecosystem authority — std library, API Guidelines, clippy lints, Effective Rust. Every rule earns its token cost.

## Formatting

Do not cap lines at a restrictive line length, write paragraphs all on one line.
