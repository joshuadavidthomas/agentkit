# rust-macros

Macros by example (`macro_rules!`) and procedural macros (`proc_macro`) for Rust. Covers the “don’t write a macro unless you must” default, choosing between macro kinds, macro_rules input grammar and hygiene defaults, proc-macro crate structure, syn/quote/darling conventions, diagnostics, and expansion debugging.

## Scope

Use this skill when writing or reviewing any macro, when deciding whether a proc macro is appropriate, when hitting confusing macro errors (“local ambiguity”, hygiene/name resolution issues), or when debugging macro expansions.

## References in this skill

Deep dives live in `references/`:
- `macro_rules-patterns.md` — single-evaluation building blocks, trailing comma patterns, matcher design defaults
- `proc-macro-patterns.md` — proc-macro crate layout, parsing/quoting, error reporting, name resolution robustness
- `testing-and-debugging-macros.md` — cargo-expand workflow, trybuild compile-fail tests, debugging checklist

## Attribution & license notes

This skill synthesizes guidance from:
- Rust Reference: macros, macros-by-example, procedural macros (rust-lang/reference)
- The Little Book of Rust Macros (veykril/tlborm)
- proc-macro-workshop (dtolnay/proc-macro-workshop)
- syn / quote / darling crate docs (dtolnay/syn, dtolnay/quote, TedDriggs/darling)
- cargo-expand docs (dtolnay/cargo-expand)
