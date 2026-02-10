# rust-traits

Trait design and dispatch defaults for Rust.

This skill prevents the common agent failure mode of reaching for `dyn Trait` by default. Enforce this order:

1. **Closed set** → use an `enum`.
2. **Open set, concrete type known at the call site** → use generics / `impl Trait`.
3. **True type erasure** (plugins, heterogeneous collections) → use `dyn Trait`.

It also encodes object-safety rules, associated-types vs generic-parameters defaults, a standard-trait checklist, and the core pattern catalog (sealed, extension, marker, blanket, conditional impls).

## Attribution & License

This skill synthesizes guidance from:

- Rust for Rustaceans (Jon Gjengset) — referenced for conceptual guidance; no text reproduced.
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale — CC BY 4.0.
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — MIT OR Apache-2.0.
- [Rust Design Patterns](https://github.com/rust-unofficial/patterns) — MPL-2.0.
- [Rust Reference](https://doc.rust-lang.org/reference/) — MIT OR Apache-2.0.
- [The Rust Programming Language](https://doc.rust-lang.org/book/) — MIT OR Apache-2.0.
- [pretzelhammer rust-blog](https://github.com/pretzelhammer/rust-blog) — CC BY-SA 4.0.
