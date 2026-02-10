# rust-type-design

Type-driven domain modeling patterns for Rust: newtypes, typestate, builders,
phantom types, and sealed traits.

## Scope

This skill covers *implementation patterns* for encoding domain constraints in
Rust's type system. It complements **rust-idiomatic**, which covers *when* to
use these patterns.

| Pattern | Purpose |
|---------|---------|
| Newtype | Distinguish primitives, enforce invariants, hide representation |
| Typestate | State machine encoded in types — invalid transitions don't compile |
| Builder | Incremental construction of complex values |
| Phantom types | Type-level tags without runtime representation |
| Sealed traits | Prevent external trait implementations |

## References

Deeper implementation guides in `references/`:

- `newtype-patterns.md` — Trait impls, serde, derive_more, accessor patterns
- `typestate-patterns.md` — State with data, fallible transitions, sealed bounds
- `builder-patterns.md` — Derive macros, validation, consuming vs non-consuming

## Attribution

This skill synthesizes patterns from:

- **Rust API Guidelines** — [C-NEWTYPE], [C-CUSTOM-TYPE], [C-BUILDER], [C-SEALED]
  (MIT/Apache-2.0, rust-lang)
- **Rust Design Patterns** — Newtype, Builder chapters
  (MPL-2.0, rust-unofficial)
- **The Typestate Pattern in Rust** — Cliff L. Biffle (cliffle.com)
- **Make Illegal States Unrepresentable** — corrode.dev
- **Effective Rust** — David Drysdale, Chapter 1 (Types)
- **Parse, Don't Validate** — Alexis King (lexi-lambda.github.io)
- **Aiming for Correctness with Types** — Amos/fasterthanlime

Standard library evidence: `PathBuf`, `String`, `NonZero<T>`, `PhantomData`,
`std::process::Command`, `thread::Builder`.

Ecosystem evidence: `serde::Serializer` (typestate), `url::Url` (newtype),
`reqwest::ClientBuilder` (builder), typed ID crates (phantom types).
