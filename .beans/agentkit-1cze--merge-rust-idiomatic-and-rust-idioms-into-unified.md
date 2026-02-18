---
# agentkit-1cze
title: Merge rust-idiomatic and rust-idioms into unified skill
status: completed
type: task
priority: high
created_at: 2026-02-16T07:44:44Z
updated_at: 2026-02-16T08:08:26Z
---

## Plan: Merge rust-idiomatic + rust-idioms → rust-idiomatic-v2

### Philosophy

Create `skills/rust-idiomatic-v2/` as a new skill. Keep both originals untouched.

The SKILL.md stays **lean** — philosophy, concise rule statements (no big inline code blocks), a quick-reference table, review checklist, and cross-references. Every rule links to a reference file one hop away. The reference files carry all the depth: examples, exceptions, migration strategies, "Common Source Languages" sections.

This follows the rust-idioms approach (table → reference files) but with rust-idiomatic's opinionated framing and philosophy at the top.

### SKILL.md Structure (~200-250 lines)

```
Frontmatter (name, description — precise trigger description like rust-idiomatic's)

# Think in Rust
  Philosophy intro (~15 lines, from rust-idiomatic)
  Add the "Common Source Languages" insight from rust-idioms — WHY agents default wrong

## The Rules
  For each rule: 1-2 sentence statement + link to reference file
  NO inline code examples (those live in references)

  Group A — Type Design Defaults (from rust-idiomatic):
   1. Every string with domain meaning is a newtype
   2. Every boolean parameter is a lie — use an enum
   3. Every "I don't know" is explicit (no Option<bool>)
   4. Every match is exhaustive — no wildcard _ => arms
   5. Every error variant is a domain fact — no Error(String)
   6. Parse, don't validate
   7. Enums are the primary modeling tool
   8. Enums for closed sets, trait objects for open sets
   9. Borrow by default — own when intentional

  Group B — Everyday Patterns (new from rust-idioms):
  10. Iterators over index loops
  11. Option over sentinel values
  12. One struct per entity, not parallel collections
  13. Transform over mutate (consuming self chains)
  14. Restructure ownership before Rc<RefCell>
  15. Modules are namespaces, not impl blocks
  16. Right-size your pattern matching (if-let / let-else / matches!)
  17. Public fields over trivial getters

## Quick Reference Table
  All 17 rules: Code Smell | Idiomatic Alternative | Reference File
  (merged from both sources)

## Common Mistakes (Agent Failure Modes)
  Merged from both, ~10-12 bullet points

## Cross-References
  Links to: rust-type-design, rust-error-handling, rust-ownership,
  rust-traits, rust-project-structure

## Review Checklist
  17 items, one per rule (expanded from rust-idiomatic's 10)
```

### Reference Files (in references/)

**Kept from rust-idiomatic** — enhanced with "Common Source Languages" sections and any missing content from rust-idioms:

1. `newtypes-and-domain-types.md`
   - Source: rust-idiomatic reference + stringly-typed.md content
   - Add: CSL section from stringly-typed.md, absorb the "structured strings: parsing at boundary" examples

2. `enums-as-modeling-tool.md`
   - Source: rust-idiomatic reference + bool-to-enum.md extras
   - Add: CSL section, the "independent vs correlated booleans" test, migration strategy from bool-to-enum.md

3. `parse-dont-validate.md`
   - Source: rust-idiomatic reference (already excellent)
   - Add: CSL section

**New from rust-idioms** — adapted, keeping their structure (Smell → Alternative → Exceptions → CSL):

4. `bool-to-enum.md` — from rust-idioms (state machines, correlated booleans, migration strategy)
5. `option-bool-to-enum.md` — from rust-idioms option-bool.md (boundary conversion pattern)
6. `iterators-over-indexing.md` — from rust-idioms index-loops.md
7. `option-over-sentinels.md` — from rust-idioms sentinel-values.md
8. `struct-collections.md` — from rust-idioms parallel-maps.md
9. `transform-over-mutate.md` — from rust-idioms mut-vs-transform.md
10. `ownership-before-refcell.md` — MERGED from rc-refcell.md + clone-escape.md (related smell: both about fighting the borrow checker with runtime costs)
11. `pattern-matching-tools.md` — from rust-idioms match-if-let.md
12. `getter-setter.md` — from rust-idioms (Rust naming conventions, when to pub fields)
13. `impl-namespace.md` — from rust-idioms (modules vs associated functions, extension traits)

### Content from rust-idioms NOT ported (covered by other skills)

These get cross-referenced from the SKILL.md, not duplicated:

- `typestate-builder.md` → covered by **rust-type-design** (builder-patterns.md, typestate-patterns.md)
- `module-structure.md` → covered by **rust-project-structure** (modules, visibility, API surfaces)
- `error-types.md` → covered by **rust-error-handling** (Rule 5 states the principle, skill has the details)
- `unwrap-propagate.md` → covered by **rust-error-handling**
- `trait-objects.md` → covered by **rust-traits** (Rule 8 states the principle)

Nothing valuable is lost — every piece of content is either ported, absorbed into an enhanced reference, or already covered by a dedicated skill.

### What comes from where (source tracking)

| Merged Skill Element | Primary Source | Secondary Source |
|---|---|---|
| Philosophy / framing | rust-idiomatic | — |
| Rules 1-9 statements | rust-idiomatic | — |
| Rules 10-17 statements | rust-idioms | — |
| Quick reference table | rust-idioms (format) | rust-idiomatic (content) |
| Review checklist | rust-idiomatic (format) | rust-idioms (new items) |
| "Common Source Languages" insight | rust-idioms | — |
| Authority citations | rust-idiomatic | — |
| Reference file structure | rust-idioms (Smell/Alt/Exceptions/CSL) | — |
| Deep references (newtypes, enums, parse) | rust-idiomatic | rust-idioms additions |
| New references (iterators, sentinels, etc.) | rust-idioms | — |
| Cross-references to other skills | rust-idiomatic | — |

### Key decisions

1. **SKILL.md is a dispatch document, not a textbook.** Rules are stated in 1-2 sentences. All examples, exceptions, migration strategies live in reference files.
2. **Every rule gets a reference file.** Some are deep (newtypes, enums, parse-dont-validate), some are focused (getter-setter, impl-namespace). But the agent always has one hop to get depth.
3. **No duplication with other skills.** Typestate builders, module structure, error type design, trait object design — these get cross-references, not copies.
4. **"Common Source Languages" goes in reference files**, not SKILL.md. Keeps the SKILL.md lean; the context is available when the agent digs into a specific pattern.
5. **Consistent reference file format.** All references follow: The Smell → The Idiomatic Alternative → When The Smell Is Fine → Common Source Languages. The existing rust-idiomatic references get enhanced to match this structure.

## Checklist

- [x] Create `skills/rust-idiomatic-v2/` directory
- [x] Write lean SKILL.md with all 17 rules, table, checklist, cross-refs
- [x] Port + enhance `references/newtypes-and-domain-types.md` (add stringly-typed content + CSL)
- [x] Port + enhance `references/enums-as-modeling-tool.md` (add bool migration + CSL)
- [x] Port + enhance `references/parse-dont-validate.md` (add CSL)
- [x] Create `references/bool-to-enum.md`
- [x] Create `references/option-bool-to-enum.md`
- [x] Create `references/iterators-over-indexing.md`
- [x] Create `references/option-over-sentinels.md`
- [x] Create `references/struct-collections.md`
- [x] Create `references/transform-over-mutate.md`
- [x] Create `references/ownership-before-refcell.md` (merged clone-escape + rc-refcell)
- [x] Create `references/pattern-matching-tools.md`
- [x] Create `references/getter-setter.md`
- [x] Create `references/impl-namespace.md`
- [x] Verify no content lost from either source
- [ ] Delete `skills/rust-idioms/` (superseded)