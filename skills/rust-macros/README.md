# rust-macros

Macros by example (`macro_rules!`) and procedural macros (`proc_macro`) for Rust. Covers the “don’t write a macro unless you must” default, choosing between macro kinds, macro_rules input grammar and hygiene defaults, proc-macro crate structure, syn/quote/darling conventions, diagnostics, and expansion debugging.

## Scope

Use this skill when writing or reviewing any macro, when deciding whether a proc macro is appropriate, when hitting confusing macro errors (“local ambiguity”, hygiene/name resolution issues), or when debugging macro expansions.

## References in this skill

Deep dives live in `references/`:
- `macro_rules-patterns.md` — single-evaluation building blocks, trailing comma patterns, matcher design defaults
- `proc-macro-patterns.md` — proc-macro crate layout, parsing/quoting, error reporting, name resolution robustness
- `testing-and-debugging-macros.md` — cargo-expand workflow, trybuild compile-fail tests, debugging checklist

## Attribution & License

This skill synthesizes guidance from the following sources:

- [Rust Reference](https://github.com/rust-lang/reference) — Macros by example + procedural macros chapters. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [The Little Book of Rust Macros (TLBORM)](https://github.com/veykril/tlborm) — Declarative macro patterns. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [proc-macro-workshop](https://github.com/dtolnay/proc-macro-workshop) — Practical derive/attribute macro exercises and pitfalls. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [syn](https://github.com/dtolnay/syn) and [quote](https://github.com/dtolnay/quote) — The default parsing/codegen stack for proc macros. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [darling](https://github.com/TedDriggs/darling) — Structured attribute parsing for proc macros. Licensed under [MIT](https://opensource.org/licenses/MIT).
- [cargo-expand](https://github.com/dtolnay/cargo-expand) — Expansion debugging workflow. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
