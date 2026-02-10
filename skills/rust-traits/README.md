# rust-traits

Trait design, dispatch decisions, and object safety for AI agents writing Rust.

Teaches the agent to choose the right dispatch mechanism (enum vs generic vs trait
object), design object-safe traits, implement standard traits correctly, and apply
patterns like sealed traits, extension traits, and marker traits.

## Contents

- `SKILL.md` — Decision framework, object safety rules, trait design rules, pattern
  catalog, review checklist
- `references/dispatch-patterns.md` — Static vs dynamic dispatch, monomorphization,
  `impl Trait`, performance comparison
- `references/trait-patterns.md` — Sealed, marker, blanket, GATs,
  closure-based strategies, newtype delegation
- `references/extension-traits.md` — The Ext pattern (blanket Ext and sealed Ext),
  implementation guide, combinator return types, ecosystem examples
- `references/standard-traits.md` — Which std traits to implement, derive vs manual,
  conversion hierarchy, `Deref` rules

## Attribution

Content synthesized from:

- [The Rust Programming Language](https://doc.rust-lang.org/book/) (MIT/Apache-2.0)
- [The Rust Reference](https://doc.rust-lang.org/reference/) (MIT/Apache-2.0)
- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) (MIT/Apache-2.0)
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale (CC BY 4.0)
- [Tour of Rust's Standard Library Traits](https://github.com/pretzelhammer/rust-blog) by pretzelhammer (MIT)
- [Rust Design Patterns](https://rust-unofficial.github.io/patterns/) (MPL-2.0)
