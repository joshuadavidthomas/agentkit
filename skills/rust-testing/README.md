# rust-testing

Testing ecosystem and strategies for Rust. Covers the testing pyramid, test
organization (unit/integration/doc), and the ecosystem of tools: property
testing (proptest), snapshot testing (insta), fixtures and parameterization
(rstest), mocking (mockall), benchmarking (criterion/divan), fuzzing
(cargo-fuzz), and the nextest test runner.

## Scope

Use this skill when writing tests, choosing between testing tools, setting up
property-based or snapshot testing, benchmarking performance, fuzzing untrusted
input boundaries, organizing test modules and shared helpers, or asking how to
structure tests in a Rust project. The entry question is **what kind of
confidence do you need?** — the answer determines the tool.

## References in this skill

Deep dives live in `references/`:
- `property-testing.md` — proptest strategies, `prop_compose!`, the `Arbitrary` trait, shrinking, common property patterns (roundtrip, idempotency, oracle, invariant preservation), configuration
- `snapshot-testing.md` — insta assertion macros, file vs inline snapshots, the review workflow (`cargo insta review`), redactions (static, dynamic, sorted), selectors, glob testing, CI setup
- `benchmarking-and-fuzzing.md` — criterion setup and usage (inputs, comparisons, async, configuration), divan as lightweight alternative, cargo-fuzz setup, structure-aware fuzzing with `Arbitrary`, corpus management, coverage analysis, CI integration

## Attribution & license notes

This skill synthesizes guidance from:

- [The Rust Book, Chapter 11](https://doc.rust-lang.org/book/ch11-00-testing.html) — test organization, `#[test]`, `#[cfg(test)]`, unit vs integration tests (MIT OR Apache-2.0)
- [Rust by Example — Testing](https://doc.rust-lang.org/rust-by-example/testing.html) — unit, integration, and doc test examples (MIT OR Apache-2.0)
- [proptest book](https://proptest-rs.github.io/proptest/proptest/index.html) — property-based testing, strategies, shrinking, `Arbitrary` (MIT OR Apache-2.0)
- [insta documentation](https://insta.rs/docs/) — snapshot testing workflow, redactions, CLI (Apache-2.0)
- [rstest documentation](https://docs.rs/rstest/) — fixtures, parameterized tests, value lists (MIT OR Apache-2.0)
- [mockall documentation](https://docs.rs/mockall/) — trait mocking, expectations, argument matchers (MIT OR Apache-2.0)
- [criterion.rs user guide](https://bheisler.github.io/criterion.rs/book/) — statistical benchmarking, regression detection (MIT OR Apache-2.0)
- [divan documentation](https://docs.rs/divan/) — lightweight benchmarking (MIT OR Apache-2.0)
- [Rust Fuzz Book](https://rust-fuzz.github.io/book/) — cargo-fuzz, structure-aware fuzzing, trophy case (MIT OR Apache-2.0)
- [nextest documentation](https://nexte.st/) — test runner, per-process isolation, flaky test retries (MIT OR Apache-2.0)
- [ruff/ty mdtest framework](https://github.com/astral-sh/ruff/tree/main/crates/ty_test) — literate Markdown-as-test-suite pattern for compiler/analyzer testing (MIT)

Standard library and ecosystem items referenced: `#[test]`, `#[cfg(test)]`,
`assert!`, `assert_eq!`, `assert_ne!`, `#[should_panic]`, `#[ignore]`,
`std::hint::black_box`, `proptest::prelude::*`, `insta::assert_yaml_snapshot!`,
`rstest::rstest`, `rstest::fixture`, `mockall::automock`, `criterion::Criterion`,
`libfuzzer_sys::fuzz_target!`, `datatest_stable::harness!`.
