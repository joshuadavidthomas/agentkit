# Rust Skills for AI Agents — Master Plan

**Milestone**: `agentkit-jghk` — Create curated Rust skill set for AI agents

## The Problem

AI agents write Rust that compiles and works but doesn't *think in Rust*. They default to patterns from Python/TypeScript/Java — bare Strings for domain types, booleans for states, trait objects for closed sets, runtime validation instead of type-level guarantees, wildcard match arms, `clone()` to silence the borrow checker.

The Rust ecosystem has clear, well-documented preferences for how code should be written. These skills encode those preferences so agents follow them by default, without the user repeating "use enums" and "no bare Strings" every session.

## Design Principles

1. **Prescriptive, not descriptive.** "Do this" not "here's how this works." The agent already knows Rust. The skills encode *judgment and defaults*.
2. **Ecosystem-backed, not opinion.** Every rule cites authority — std library design, Rust API Guidelines, clippy lints, Effective Rust, community consensus. These aren't personal preferences, they're what the ecosystem recommends.
3. **Different shapes for different skills.** Decision-framework skills (ownership, traits), rulebook skills (performance), ecosystem-survey skills (testing, serde), correctness-checklist skills (unsafe). The topic dictates the structure.
4. **Error-code entry points.** Some skills activate when the user pastes a compiler error, not just when they're making a design decision. E0382 → ownership skill.
5. **Multi-modal sections within skills.** A single skill serves different moments: stuck on an error → error table. Making a design choice → decision tree. Reviewing code → checklist. Not one narrative flow.

## The 8 Skills

### 1. `rust-idiomatic` — The Paradigm Shift Skill

**Status**: DONE (REVIEWED)

**The most important skill.** Loaded for any Rust work. Encodes the core "think in Rust" principles that agents consistently fail to apply:

- Every string with domain meaning is a newtype
- Every boolean is a lie — use an enum
- Every "I don't know" is explicit — `Knowledge::Known(vec![])` vs `Knowledge::Unknown`
- Every match is exhaustive — no `_ =>`
- Every error variant is a domain fact — no `Error(String)`
- Parse, don't validate — convert at boundaries, use typed representations internally
- Enums are the primary modeling tool, not structs with kind fields
- Trait objects only for open sets — use enums for closed sets
- Borrow by default — own when intentional

**Shape:** Hard rules with std library evidence + ecosystem citations. Review checklist at the end. Not a tutorial.

**Key references:**
- Rust API Guidelines (C-NEWTYPE, C-CUSTOM-TYPE, C-ENUM)
- Effective Rust (Drysdale) — items on types, enums, newtypes
- Rust Design Patterns — newtype, type-state, strategy-via-enum
- std library examples (IpAddr, Cow, NonZero*, PathBuf)
- Ecosystem evidence (url::Url, http::Method, semver::Version)
- Parse, Don't Validate (Alexis King)
- Make Illegal States Unrepresentable (corrode)
- clippy lints (wildcard_enum_match_arm, etc.)

### 2. `rust-ownership` — Ownership, Borrowing, Lifetimes

**Status**: DONE (REVIEWED)

**Triggers:** E0382, E0505, E0597, E0106, E0507, E0716, choosing smart pointers, function signature design, fighting the borrow checker.

**Shape:** Error-code-to-design-question table at top. Pointer type decision tree. Function signature rules with quantified impact. "When clone is fine" section. Review checklist.

**Key references:**
- The Rust Book ch 4, 10, 15
- Common Rust Lifetime Misconceptions (pretzelhammer)
- Tour of Rust's Standard Library Traits (pretzelhammer)
- Rust Reference — lifetime elision rules
- Effective Rust — items on references, lifetimes, smart pointers
- dot-skills `own-*` rules (quantified impact)

### 3. `rust-traits` — Trait Design and Dispatch

**Status**: DONE (REVIEWED)

**Triggers:** Designing trait hierarchies, static vs dynamic dispatch, object safety errors, E0277, trait coherence/orphan issues, when to use generics vs trait objects vs enums.

**Shape:** Decision framework (enum vs generic vs trait object). Object safety quick reference. Pattern catalog (sealed, extension, GATs, marker traits). Common mistakes.

**Key references:**
- The Rust Book ch 10, 17
- Rust Reference — trait objects, object safety
- Rust API Guidelines — trait interop guidelines
- Effective Rust — items on traits, generics
- Rust Design Patterns — strategy pattern
- Rust for Rustaceans (reference, not clonable)

### 4. `rust-error-handling` — Error Strategy and Design

**Status**: DONE (REVIEWED)

**Triggers:** Designing error types, choosing thiserror vs anyhow, error propagation, Result/Option patterns, "how should I handle errors in this project."

**Shape:** Library vs application as the central axis. Error-type-as-domain-model philosophy. Combinator quick reference. Boundary rules (where to log vs return).

**Key references:**
- Error Handling in Rust (BurntSushi) — the canonical post
- Modular Errors in Rust (Jewson) — newer, more structured approach
- Error Handling Survey (Wuyts) — landscape overview
- Error Handling in Rust - Deep Dive (Palmieri)
- Effective Rust — error handling items
- thiserror / anyhow / error-stack crate docs

### 5. `rust-type-design` — Type-Driven Domain Modeling

**Status**: DONE (REVIEWED)

**Triggers:** Newtype pattern, type-state, phantom types, builder pattern, "make invalid states unrepresentable," domain modeling, encoding invariants.

**Shape:** Principles + pattern catalog. Each pattern with motivation (what problem it solves), std/ecosystem evidence, and concrete before/after examples. Domain constraint examples woven in (fintech: Money newtype, embedded: type-state for hardware).

**Key references:**
- The Typestate Pattern in Rust (Cliffle)
- Make Illegal States Unrepresentable (corrode)
- Aiming for Correctness with Types (fasterthanlime)
- Parse, Don't Validate (Alexis King)
- Rust Design Patterns — newtype, builder, type-state
- Effective Rust — type system items
- Rust API Guidelines — C-NEWTYPE, C-CUSTOM-TYPE

### 6. `rust-async` — Async Patterns and Tokio

**Status**: DONE (REVIEWED)

**Triggers:** async/await, tokio, channels, spawning, Send/Sync errors, blocking in async context, graceful shutdown, cancellation.

**Shape:** "CPU-bound or I/O-bound?" entry question. Channel type selection table. Core rules (don't block, don't hold locks across .await). Production patterns (graceful shutdown, backpressure, timeouts). Threading/rayon as reference for CPU-bound.

**Key references:**
- Tokio tutorial (tokio-rs/website)
- Async Book (rust-lang/async-book)
- Alice Ryhl's posts — actors, blocking, shared state (Darksonn/ryhl.io)
- Rust Atomics and Locks (Mara Bos) — for threading/sync primitives
- Effective Rust — async items

### 7. `rust-testing` — Testing Ecosystem and Strategies

**Status**: DONE (REVIEWED)

**Triggers:** Writing tests, test organization, property testing, benchmarking, mocking, snapshot testing, fuzzing, CI test setup.

**Shape:** Ecosystem survey — what tools exist, when to use each, how to set up. Testing pyramid for Rust. Organization conventions. Quick-start for each tool.

**Key references:**
- The Rust Book ch 11
- proptest book (proptest-rs/proptest)
- criterion user guide (bheisler/criterion.rs)
- insta docs (mitsuhiko/insta-website)
- nextest docs (nextest-rs/nextest)
- mockall crate docs
- Rust Fuzz Book (rust-fuzz/book)
- rstest crate docs

### 8. `rust-performance` — Performance Optimization Rulebook

**Status**: DONE (REVIEWED)

**Triggers:** Optimizing Rust code, profiling, code review for performance, allocation reduction, choosing data structures.

**Shape:** Impact-ranked rulebook (CRITICAL → LOW). Incorrect → correct contrast format. Quantified claims. Scannable, not narrative. Profiling tool setup in references.

**Key references:**
- Rust Performance Book (nnethercote)
- dot-skills 42 quantified rules (reference/dot-skills)
- Effective Rust — performance items
- The Rust Book ch 13 (iterators)
- clippy perf lints

### 9. `rust-unsafe` — Unsafe Code and FFI

**Status**: DONE (REVIEWED)

**Triggers:** Writing unsafe code, FFI, raw pointers, transmute, reviewing unsafe blocks, `// SAFETY:` documentation, bindgen/cbindgen.

**Shape:** "When is unsafe actually necessary?" decision list. Safety invariant documentation requirements. Review checklist. FFI patterns reference. Common UB catalog.

**Key references:**
- The Rustonomicon (rust-lang/nomicon) — primary source
- Rust Reference — undefined behavior catalog
- Bindgen User Guide (rust-lang/rust-bindgen)
- cbindgen docs (mozilla/cbindgen)
- miri documentation (rust-lang/miri)

### 10. `rust-macros` — Declarative and Procedural Macros

**Status**: TODO

**Triggers:** Writing macros, macro_rules!, proc macros, derive macros, syn/quote, debugging macros, macro hygiene.

**Shape:** Reference manual. Declarative macro patterns (fragment specifiers, repetitions, push-down accumulation). Proc macro guide (derive, attribute, function-like). Error reporting. Debugging with cargo-expand.

**Key references:**
- The Little Book of Rust Macros (veykril/tlborm)
- proc-macro-workshop (dtolnay)
- syn / quote / darling crate docs
- Rust Reference — macros chapters
- Rust by Example — macros

### 11. `rust-project-structure` — Workspace and API Design

**Status**: TODO

**Triggers:** Starting a new project, organizing crates, workspace setup, feature flags, public API design, documentation, conditional compilation.

**Shape:** Structural guide. Workspace patterns. Feature flag conventions. Public API checklist (what to expose, what traits to implement, naming). Documentation conventions.

**Key references:**
- The Cargo Book (rust-lang/cargo)
- Rust API Guidelines — full checklist
- Effective Rust — API design items
- Edition Guide (rust-lang/edition-guide)

**Notes from real agent failures:**
- Agents add feature flags inside workspace crates to "separate concerns" without realizing Cargo unifies features across the workspace. If any crate enables the feature, it's compiled for all — the gate is pure ceremony. Needs a clear rule: "Feature flags in workspace crates are for external consumers, not internal organization. For internal separation, use separate crates, not feature gates."
- Real case: 25 `cfg(feature = "parser")` annotations gating a lightweight dep (`ruff_python_parser`) while the heavy dep (`ruff_python_ast`) was unconditional. The gate was on the wrong thing *and* workspace unification made it moot. Agent only realized this after user pushed back and it actually checked `cargo tree`.
- The skill should cover: when feature flags help (published crates, truly optional heavy deps like TLS backends), when they don't (workspace-internal organization), and the alternative (crate boundaries for real separation).

### 12. `rust-interop` — Cross-Language Integration

**Status**: TODO

**Triggers:** PyO3, pyo3, napi-rs, wasm-bindgen, wasm-pack, cxx, extern "C", FFI, bindgen, cbindgen, uniffi, calling Rust from Python/JS/C/C++, embedding Rust, WASM.

**Shape:** Entry question is "what language are you bridging to?" then routes to the right reference. SKILL.md covers universal principles: ownership at the boundary, type mapping, error translation across languages, when to copy vs borrow, GIL/runtime considerations. References go deep per ecosystem.

Note: C-level FFI (extern "C", CString/CStr, bindgen/cbindgen) moves HERE from rust-unsafe. rust-unsafe stays focused on raw unsafe Rust (pointers, transmute, safety invariants, UB).

**Key references:**
- PyO3 guide (PyO3/pyo3 — `guide/`)
- napi-rs docs (napi-rs/napi-rs — `cli/docs/`)
- cxx book (dtolnay/cxx — `book/`)
- wasm-bindgen guide (wasm-bindgen/wasm-bindgen — `guide/`, 186 .md files)
- UniFFI docs (mozilla/uniffi-rs — `docs/`)
- Rust and WebAssembly book (rustwasm/book)
- Bindgen User Guide (rust-lang/rust-bindgen — `book/`)
- cbindgen (mozilla/cbindgen)

### 13. `rust-serde` — Serialization Patterns

**Status**: TODO

**Triggers:** serde attributes, custom serialization, enum representation (#[serde(tag)], untagged, adjacently tagged), #[serde(default)], #[serde(flatten)], custom Serialize/Deserialize impls, format-specific issues.

**Shape:** Attribute quick-reference (container/variant/field). Enum representation decision table. Custom impl patterns. Common mistakes. Before/after examples.

**Key references:**
- serde.rs docs (serde-rs/serde-rs.github.io)
- serde_with crate docs
- Effective Rust — serialization items

## Reference Material

### Already collected (reference/)

**Three cloned skill repos (structural inspiration):**
- `reference/claude-skills/` — jeffallan/claude-skills
- `reference/dot-skills/` — pproenca/dot-skills
- `reference/rust-skills/` — ZhangHanDong/rust-skills

**Scraped Tier 3 web-only content:**
- `reference/effective-rust.md` — Full book (541KB)
- `reference/aiming-for-correctness-with-types-fasterthanlime.md`
- `reference/working-with-strings-fasterthanlime.md`
- `reference/curse-of-strong-typing-fasterthanlime.md`
- `reference/error-handling-in-rust-palmieri.md`
- `reference/modular-errors-in-rust-jewson.md`
- `reference/error-handling-survey-wuyts.md`
- `reference/typestate-pattern-in-rust-cliffle.md`
- `reference/illegal-states-unrepresentable-corrode.md`

### To clone (Tier 1 — markdown books/docs)

```bash
# Official Rust documentation
git clone --depth 1 https://github.com/rust-lang/book.git reference/rust-book
git clone --depth 1 https://github.com/rust-lang/reference.git reference/rust-reference
git clone --depth 1 https://github.com/rust-lang/nomicon.git reference/rust-nomicon
git clone --depth 1 https://github.com/rust-lang/api-guidelines.git reference/rust-api-guidelines
git clone --depth 1 https://github.com/rust-lang/rust-by-example.git reference/rust-by-example
git clone --depth 1 https://github.com/rust-lang/async-book.git reference/rust-async-book
git clone --depth 1 https://github.com/rust-lang/cargo.git reference/rust-cargo
git clone --depth 1 https://github.com/rust-lang/edition-guide.git reference/rust-edition-guide
git clone --depth 1 https://github.com/rust-lang/rust-clippy.git reference/rust-clippy
git clone --depth 1 https://github.com/rust-lang/rust-bindgen.git reference/rust-bindgen

# Community references
git clone --depth 1 https://github.com/rust-unofficial/patterns.git reference/rust-design-patterns
git clone --depth 1 https://github.com/nnethercote/perf-book.git reference/rust-perf-book
git clone --depth 1 https://github.com/veykril/tlborm.git reference/rust-macros-book
git clone --depth 1 https://github.com/pretzelhammer/rust-blog.git reference/pretzelhammer-blog
git clone --depth 1 https://github.com/m-ou-se/rust-atomics-and-locks.git reference/rust-atomics-and-locks
git clone --depth 1 https://github.com/rust-fuzz/book.git reference/rust-fuzz-book

# Key blog source repos
git clone --depth 1 https://github.com/BurntSushi/blog.git reference/burntsushi-blog
git clone --depth 1 https://github.com/Darksonn/ryhl.io.git reference/ryhl-blog
git clone --depth 1 https://github.com/lexi-lambda/lexi-lambda.github.io.git reference/parse-dont-validate

# Crate docs with books/tutorials
git clone --depth 1 https://github.com/serde-rs/serde-rs.github.io.git reference/serde-docs
git clone --depth 1 https://github.com/tokio-rs/website.git reference/tokio-website
git clone --depth 1 https://github.com/bheisler/criterion.rs.git reference/criterion
git clone --depth 1 https://github.com/proptest-rs/proptest.git reference/proptest
git clone --depth 1 https://github.com/mitsuhiko/insta-website.git reference/insta-docs
git clone --depth 1 https://github.com/nextest-rs/nextest.git reference/nextest
git clone --depth 1 https://github.com/dtolnay/proc-macro-workshop.git reference/proc-macro-workshop

# Interop/FFI
git clone --depth 1 https://github.com/PyO3/pyo3.git reference/pyo3
git clone --depth 1 https://github.com/napi-rs/napi-rs.git reference/napi-rs
git clone --depth 1 https://github.com/dtolnay/cxx.git reference/cxx
git clone --depth 1 https://github.com/wasm-bindgen/wasm-bindgen.git reference/wasm-bindgen
git clone --depth 1 https://github.com/mozilla/uniffi-rs.git reference/uniffi-rs
git clone --depth 1 https://github.com/rustwasm/book.git reference/rustwasm-book
```

### To clone (Tier 2 — crate repos for examples/READMEs)

```bash
git clone --depth 1 https://github.com/dtolnay/thiserror.git reference/thiserror
git clone --depth 1 https://github.com/dtolnay/anyhow.git reference/anyhow
git clone --depth 1 https://github.com/dtolnay/syn.git reference/syn
git clone --depth 1 https://github.com/dtolnay/quote.git reference/quote
git clone --depth 1 https://github.com/dtolnay/cargo-expand.git reference/cargo-expand
git clone --depth 1 https://github.com/asomers/mockall.git reference/mockall
git clone --depth 1 https://github.com/la10736/rstest.git reference/rstest
git clone --depth 1 https://github.com/TedDriggs/darling.git reference/darling
git clone --depth 1 https://github.com/mozilla/cbindgen.git reference/cbindgen
git clone --depth 1 https://github.com/tokio-rs/axum.git reference/axum
git clone --depth 1 https://github.com/tower-rs/tower.git reference/tower
git clone --depth 1 https://github.com/tokio-rs/tokio.git reference/tokio
git clone --depth 1 https://github.com/rust-lang/miri.git reference/miri
git clone --depth 1 https://github.com/rust-lang/rust-bindgen.git reference/bindgen
```

## Build Order

**Phase 1: The Foundation**
1. `rust-idiomatic` — The paradigm shift skill. Build first because it's the highest impact and establishes the tone/approach for everything else.
2. `rust-type-design` — Closely related, the "how" to the idiomatic skill's "what."

**Phase 2: Core Language**
3. `rust-error-handling` — High agent failure rate, good source material.
4. `rust-ownership` — Core topic, error-code entry points.
5. `rust-traits` — Dispatch decisions, object safety.

**Phase 3: Ecosystem**
6. `rust-async` — Tokio patterns, production concerns.
7. `rust-testing` — Ecosystem survey, tool setup.
8. `rust-unsafe` — Correctness-critical, Rustonomicon-sourced.

**Phase 4: Specialized**
9. `rust-performance` — Rulebook, different shape than others.
10. `rust-macros` — Biggest knowledge gap, needs most original synthesis.
11. `rust-project-structure` — Workspace/API design.
12. `rust-interop` — Cross-language integration (PyO3, wasm-bindgen, cxx, etc.).
13. `rust-serde` — Attribute combinatorics.

## Skill Authoring Conventions

Following the salsa-* skill pattern established in this repo:

```
skills/rust-{name}/
├── SKILL.md          # Under 500 lines. Rules + decision frameworks + checklist.
├── README.md         # Short catalog entry + attribution/licenses.
└── references/       # Deep-dive content loaded on demand.
    ├── {topic}.md    # 150-250 lines each, concrete examples.
    └── ...
```

**SKILL.md conventions:**
- Frontmatter: `name` (matches directory), `description` (trigger keywords + when-to-use)
- Tone: prescriptive, imperative. "Do this" not "consider doing this."
- Rules cite authority: std library, API Guidelines, clippy lints, Effective Rust
- Sections serve different entry points (error table, decision tree, checklist)
- End with numbered review checklist
- Cross-reference other skills via bold: **rust-ownership**

**Reference file conventions:**
- Incorrect → correct code contrast where applicable (from dot-skills pattern)
- Quantified impact where measurable (from dot-skills pattern)
- Production examples from real codebases where available
- No orphaned code blocks — every example has explanatory context

## Notes for Continuation

- The three reference skill repos (claude-skills, dot-skills, rust-skills) are structural inspiration only — content comes from primary sources
- rust-skills' meta-cognitive framework is over-engineered for frontier models — strip to pure knowledge, discard the scaffolding
- dot-skills' quantified impact format is valuable — use for performance skill and anywhere measurable claims apply
- The key insight driving everything: agents don't lack Rust knowledge, they lack Rust *defaults*. The skills change what the agent reaches for first.
