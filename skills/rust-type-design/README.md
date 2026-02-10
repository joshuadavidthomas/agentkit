# rust-type-design

Type-driven domain modeling patterns for Rust: newtypes, typestate, builders, phantom types, and sealing.

## Scope

Use this skill when you’re modeling a domain and want the compiler to enforce invariants:
- distinguish domain primitives via newtypes
- make invalid states unrepresentable (typestate / phantom types)
- stabilize construction with builders
- prevent external trait implementations (sealed traits)

This skill complements **rust-idiomatic** (which sets the defaults and “when”).

## References in this skill

Deep dives live in `references/`:
- `newtype-patterns.md` — trait impl/accessors, TryFrom/FromStr, serde + derive_more integration
- `typestate-patterns.md` — sealed state sets, state-with-data, fallible transitions, typestate-builders
- `builder-patterns.md` — consuming vs non-consuming, validation strategy, derive-macro pointers

## Attribution & license notes

This skill synthesizes guidance from:

- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — API design checklist (MIT OR Apache-2.0)
- [Rust Design Patterns](https://github.com/rust-unofficial/patterns) — newtype/builder/typestate patterns (MPL-2.0)
- [“The Typestate Pattern in Rust”](https://cliffle.com/blog/rust-typestate/) by Cliff L. Biffle
- [“Parse, Don’t Validate”](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) by Alexis King
- [“Making Illegal States Unrepresentable”](https://corrode.dev/blog/illegal-states/) by corrode.dev
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale (CC BY 4.0)
- [“Aiming for Correctness with Types”](https://fasterthanli.me/articles/aiming-for-correctness-with-types) by fasterthanlime

Standard library evidence examples referenced: `NonZero*`, `PathBuf`, `PhantomData`, `std::process::Command`, `std::thread::Builder`.
