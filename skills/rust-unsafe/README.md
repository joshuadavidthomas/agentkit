# rust-unsafe

Unsafe Rust skill focused on soundness, safety invariants, and undefined behavior avoidance. Activated when writing or reviewing `unsafe` blocks/functions/traits, raw pointer code, `MaybeUninit`/`ManuallyDrop`, `transmute`, `repr(C)`/`repr(packed)` layout concerns, `Send`/`Sync` impls, or when investigating UB reports.

The `SKILL.md` is a prescriptive rulebook: when unsafe is justified, how to contain it behind safe APIs, mandatory `# Safety` and `// SAFETY:` documentation requirements, the UB categories you must prevent, and a review checklist. The `references/` directory contains deeper guidance on documenting unsafe contracts, UB/validity obligations, and validating unsafe code with Miri and complementary tooling.

## Attribution & License

This skill synthesizes guidance from the following sources:

- [The Rust Reference — Behavior considered undefined](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) — The canonical (though non-exhaustive) UB list. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/) — Primary unsafe Rust guidance: aliasing, initialization, casts, and soundness hazards. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Miri](https://github.com/rust-lang/miri) — UB detection tool and workflow patterns. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Rust Clippy](https://github.com/rust-lang/rust-clippy) — Lints that enforce unsafe documentation (`undocumented_unsafe_blocks`, `missing_safety_doc`). Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
