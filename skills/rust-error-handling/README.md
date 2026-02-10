# rust-error-handling

Error strategy and design for Rust. Covers the library-vs-application decision, structured error enums with thiserror, ergonomic propagation with anyhow, Result/Option combinators, when to panic, and error boundary rules.

## Scope

Use this skill when designing error types, choosing between thiserror and anyhow, writing error propagation code, or deciding how errors should cross abstraction boundaries. The central axis is **library vs application** — different contexts demand different strategies.

## References in this skill

Deep dives live in `references/`:
- `thiserror-patterns.md` — Full attribute reference, struct+kind pattern, layered errors, opaque wrappers
- `anyhow-patterns.md` — Context API, display formats, downcasting, backtrace support
- `combinators.md` — Result/Option combinator quick-reference, iterator error patterns, `?` vs combinators

## Attribution & license notes

This skill synthesizes guidance from:

- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale — Item 4: Prefer idiomatic error types (CC BY 4.0)
- [Error Handling Survey](https://blog.yoshuawuyts.com/error-handling-survey/) by Yoshua Wuyts — Ecosystem evolution and consensus
- [Error Handling in Rust](https://blog.burntsushi.net/rust-error-handling/) by Andrew Gallant (BurntSushi) — Canonical error handling guide
- [Error Handling in Rust](https://www.lpalmieri.com/posts/error-handling-rust/) by Luca Palmieri — 2×2 framework (control flow × reporting × location)
- [Modular Errors in Rust](https://sabrinajewson.org/blog/errors) by Sabrina Jewson — One error per unit of fallibility, the case against crate-wide enums
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — MIT OR Apache-2.0
- [anyhow](https://github.com/dtolnay/anyhow) by David Tolnay — MIT OR Apache-2.0
- [thiserror](https://github.com/dtolnay/thiserror) by David Tolnay — MIT OR Apache-2.0
- [unwrap is not that bad](https://blog.burntsushi.net/unwrap/) by Andrew Gallant (BurntSushi) — When panics are appropriate
