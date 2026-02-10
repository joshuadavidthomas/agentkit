# Rust Skills — Review Prompt

Read `PLAN.md` for the full context and design principles. Read `PROMPT.md` for
what we're building and why.

## What you're doing

Quality review of completed Rust skills. You're checking that each skill actually
accomplishes what the plan intended — not just that it exists.

## How to work

1. Load the **skill-authoring** skill — it is the authority on skill format,
   frontmatter, description writing, progressive disclosure, and structure.
   Defer to it on all questions of how a skill should be laid out.
2. Read `PLAN.md` to understand the goals and conventions.
3. Find skills marked as done (check **Status** fields in the plan).
4. For each completed skill, review against the checklist below AND the
   skill-authoring skill's guidelines.
5. Fix issues directly.
7. Mark the skill as REVIEWED in the plan.

## Review checklist

### Tone and purpose
- [ ] Prescriptive, not descriptive. "Do this" not "here's how this works."
- [ ] Rules cite authority (std library, API Guidelines, clippy, Effective Rust) —
      not just assertions.
- [ ] Not teaching Rust. The agent already knows Rust. The skill changes *defaults*.
- [ ] Every paragraph earns its token cost. Cut anything Claude already knows.

### The core message
- [ ] Would this skill actually prevent the agent from writing `name: String` when
      it should be a newtype?
- [ ] Would it prevent `is_active: bool` when it should be an enum?
- [ ] Would it prevent `_ =>` wildcard matches?
- [ ] Does it push enum-first thinking, not struct-first?
- [ ] Does it encode "parse, don't validate" and "make illegal states unrepresentable"?

### Structure
- [ ] Skill conforms to the guidelines set in **skill-authoring**.
- [ ] References are in `references/` and linked from SKILL.md.
- [ ] README.md exists with attribution for source material.
- [ ] Cross-references to other rust-* skills use **bold name** format.

### Content quality
- [ ] Code examples are correct, idiomatic Rust that compiles.
- [ ] Incorrect → correct contrast where applicable (show the bad thing first).
- [ ] No orphaned code blocks — every example has context.
- [ ] Common mistakes section exists and covers real agent failure modes.
- [ ] Review checklist at the end of SKILL.md (numbered, actionable).

### References match
- [ ] Every reference file linked from SKILL.md actually exists.
- [ ] Reference content matches what SKILL.md says it contains.
- [ ] Source material from `reference/` was actually used, not hallucinated.
- [ ] Key references listed in PLAN.md for this skill were consulted.

### Cross-cutting
- [ ] `rust-idiomatic` principles aren't contradicted by this skill.
- [ ] Routing to related skills is present and correct.
- [ ] No overlap/duplication with other completed skills.
