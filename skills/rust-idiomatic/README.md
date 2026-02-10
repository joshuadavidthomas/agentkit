# rust-idiomatic

The paradigm shift skill for Rust. Encodes the core "think in Rust" defaults that AI agents consistently get wrong: newtypes for domain strings, enums over booleans, exhaustive matching, structured errors, parse-don't-validate, enums as the primary modeling tool, and borrow-by-default.

The `SKILL.md` provides 9 hard rules with code examples, ecosystem citations, and a 10-point review checklist. The `references/` directory contains deep-dive content on specific patterns: newtypes, enums-as-modeling-tool, and boundary parsing.

## Attribution & License

This skill synthesizes guidance from the following sources:

- [Aiming for Correctness with Types](https://fasterthanli.me/articles/aiming-for-correctness-with-types) by fasterthanlime — Extended treatment of type-driven design.
- [Effective Rust](https://www.lurklurk.org/effective-rust/) by David Drysdale — Practical Rust guidance. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Making Illegal States Unrepresentable](https://corrode.dev/blog/illegal-states/) by corrode.dev — Practical examples of type-level invariants.
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) by Alexis King — The foundational blog post on type-driven parsing.
- [Rust API Guidelines](https://github.com/rust-lang/api-guidelines) — Official API design checklist. Licensed under [MIT](https://opensource.org/licenses/MIT) OR [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [Rust Design Patterns](https://github.com/rust-unofficial/patterns) — Community patterns catalog. Licensed under [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/).
- [The Typestate Pattern in Rust](https://cliffle.com/blog/rust-typestate/) by Cliff L. Biffle — Typestate pattern deep-dive.
