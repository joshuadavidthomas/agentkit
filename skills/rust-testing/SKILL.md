---
name: rust-testing
description: "Use when writing tests, organizing test modules, choosing between proptest/insta/rstest/mockall/criterion/cargo-fuzz, setting up property-based or snapshot testing, benchmarking, fuzzing, running tests with nextest, or asking how to structure tests in a Rust project. Covers the testing pyramid, test organization (unit/integration/doc), fixture patterns, parameterized tests, and when to use each tool."
---

# Testing Ecosystem and Strategies

Rust has first-class testing built into the language. `#[test]`, `#[cfg(test)]`,
and `cargo test` are not afterthoughts — they're part of the toolchain. The
ecosystem layers on property testing, snapshot testing, benchmarking, mocking,
and fuzzing. Know when to use each.

**The central principle:** Tests are code. They deserve the same design attention
as production code — typed, structured, deterministic, and fast. A test that's
hard to read is a test that's hard to trust.

## The Testing Pyramid for Rust

| Level | What | Tools | Speed | Coverage |
|-------|------|-------|-------|----------|
| **Unit** | Single function/type in isolation | `#[test]`, rstest, mockall | Milliseconds | Narrow, deep |
| **Integration** | Public API of a crate, multiple modules together | `tests/` directory, rstest | Milliseconds–seconds | Wide, shallow |
| **Property** | Invariants hold across random inputs | proptest | Seconds | Wide, deep |
| **Snapshot** | Output stability (serialization, rendering, CLI) | insta | Milliseconds | Output shape |
| **Benchmark** | Performance characteristics | criterion, divan | Seconds–minutes | Performance |
| **Fuzz** | Crash/panic/UB discovery with adversarial inputs | cargo-fuzz, afl.rs | Minutes–hours | Security |
| **Doc** | Examples in documentation compile and run | `///` + `cargo test` | Milliseconds | API surface |

Write mostly unit and integration tests. Add property tests for parsers,
serializers, and anything with invariants. Use snapshot tests for output
stability. Benchmark hot paths. Fuzz untrusted input boundaries.

## Tool Selection

Pick the right tool for the job. Don't reach for a framework when `#[test]`
suffices.

| Need | Tool | Add when |
|------|------|----------|
| Basic assertions, unit/integration tests | `#[test]` + `assert!` | Always — built in |
| Parameterized test cases, fixtures, DI | `rstest` | 3+ test cases with shared setup |
| Mocking trait dependencies | `mockall` | Isolating a unit from its dependencies |
| Invariants across random inputs | `proptest` | Parsers, serializers, encode/decode roundtrips, numeric |
| Output stability (JSON, CLI, rendered) | `insta` | Asserting on complex output that changes with refactors |
| Performance regression detection | `criterion` or `divan` | Hot paths, algorithmic comparisons |
| Crash/UB discovery on untrusted input | `cargo-fuzz` | Parsers, deserializers, protocol handlers |
| Faster test runner, better output | `cargo-nextest` | Any project (drop-in replacement for `cargo test`) |

## Test Organization

### Unit tests: same file, `#[cfg(test)]` module

```rust
pub fn validate_email(input: &str) -> bool {
    input.contains('@') && input.contains('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_email() {
        assert!(validate_email("user@example.com"));
    }

    #[test]
    fn missing_at_sign() {
        assert!(!validate_email("userexample.com"));
    }
}
```

**Rules:**
- `#[cfg(test)]` on the module — compiles only during `cargo test`
- `use super::*` to access the parent module's items (including private ones)
- Test private functions freely — unit tests are child modules with full access
- One `mod tests` per file, at the bottom

### Integration tests: `tests/` directory

```text
my-crate/
├── src/
│   └── lib.rs
└── tests/
    ├── api_tests.rs         # Each file is a separate test binary
    ├── parsing_tests.rs
    └── common/
        └── mod.rs           # Shared helpers — NOT a test file
```

**Rules:**
- Each `.rs` file in `tests/` compiles as a **separate crate** — only tests
  the public API
- No `#[cfg(test)]` needed — Cargo treats `tests/` specially
- Shared helpers go in `tests/common/mod.rs`, not `tests/common.rs` (the
  latter shows up as a test suite with 0 tests)
- Run a specific file: `cargo test --test api_tests`

### Doc tests: examples that compile

````rust
/// Parses a hex color string into RGB components.
///
/// ```
/// # use my_crate::parse_hex_color;
/// let (r, g, b) = parse_hex_color("#FF8000").unwrap();
/// assert_eq!((r, g, b), (255, 128, 0));
/// ```
pub fn parse_hex_color(s: &str) -> Result<(u8, u8, u8), ParseError> {
    // ...
}
````

**Rules:**
- Doc tests verify examples stay correct as code evolves
- Hide setup with `# ` prefix (still compiled, not shown in docs)
- Use `/// ```no_run` for examples that compile but shouldn't execute (e.g.,
  network calls)
- Use `/// ```ignore` only as a last resort — it skips compilation entirely

### Binary crates: extract logic to `lib.rs`

Binary-only crates (`src/main.rs` with no `src/lib.rs`) cannot have integration
tests. Split logic into `src/lib.rs`, keep `main.rs` thin. Integration tests
import the library crate.

## Writing Good Tests

### Name tests for what they assert, not what they call

```rust
// WRONG — names the function
fn test_parse() { ... }

// RIGHT — names the assertion
fn parse_rejects_empty_input() { ... }
fn parse_extracts_all_fields_from_valid_json() { ... }
```

### Use `expect()` over `unwrap()`, `Result` returns for `?`

```rust
// Prefer expect() with a reason
let user = repo.find(id).expect("user should exist after insert");

// Or return Result to use ? — cleaner than chained unwrap()
#[test]
fn roundtrip() -> Result<(), Box<dyn std::error::Error>> {
    let json = serde_json::to_string(&Config::default())?;
    let restored: Config = serde_json::from_str(&json)?;
    assert_eq!(Config::default(), restored);
    Ok(())
}
```

`unwrap()` is fine when intent is obvious from context. `Result`-returning
tests cannot combine with `#[should_panic]`.

### Derive `Debug + PartialEq` on types under test

`assert_eq!` requires both. Missing derives produce compiler errors or
useless failure output. Add them early.

### Test one thing per test

Each test asserts one logical property. Parameterized tests (rstest) handle
"same assertion, many inputs."

## rstest: Fixtures and Parameterized Tests

Use rstest when you have shared setup (fixtures) or the same assertion with
multiple inputs (parameterized cases).

### Fixtures: dependency injection for tests

```rust
use rstest::*;

#[fixture]
fn db() -> TestDb {
    TestDb::new_in_memory()
}

#[fixture]
fn user(db: TestDb) -> User {
    db.insert_user("alice", "alice@example.com")
}

#[rstest]
fn user_has_email(user: User) {
    assert_eq!(user.email, "alice@example.com");
}
```

Fixtures compose — `user` depends on `db`, rstest resolves the chain
automatically.

### Parameterized tests: same logic, many inputs

```rust
#[rstest]
#[case("", false)]
#[case("user@", false)]
#[case("user@example.com", true)]
#[case("a@b.c", true)]
fn email_validation(#[case] input: &str, #[case] expected: bool) {
    assert_eq!(validate_email(input), expected);
}
// Generates 4 independent tests
```

### Value lists: combinatorial testing

```rust
#[rstest]
fn multiplication_is_commutative(
    #[values(0, 1, -1, 42, i32::MAX)] a: i32,
    #[values(0, 1, -1, 42, i32::MAX)] b: i32,
) {
    assert_eq!(a.wrapping_mul(b), b.wrapping_mul(a));
}
// Generates 25 tests (5 × 5)
```

## mockall: Trait-Based Mocking

Use mockall to isolate a unit from its dependencies by mocking trait
implementations. Don't mock when you can use a real implementation (e.g.,
in-memory database, test double struct).

```rust
use mockall::{automock, predicate::*};

#[cfg_attr(test, automock)]
pub trait UserRepo {
    fn find(&self, id: u64) -> Option<User>;
    fn save(&self, user: &User) -> Result<(), RepoError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_returns_error_for_missing_user() {
        let mut repo = MockUserRepo::new();
        repo.expect_find()
            .with(eq(42))
            .times(1)
            .returning(|_| None);

        let service = UserService::new(repo);
        let result = service.get_user(42);
        assert!(result.is_err());
    }
}
```

**Rules:**
- `#[cfg_attr(test, automock)]` — mock type only exists during testing
- `mockall` in `[dev-dependencies]` only
- Prefer real implementations over mocks when feasible — mocks test wiring,
  not behavior
- Each `.expect_*()` call sets one expectation: argument matchers, call count,
  return value

## proptest: Property-Based Testing (Summary)

Test invariants across randomly generated inputs. The framework generates
hundreds of cases, and when one fails, it **shrinks** to the minimal
reproducing input.

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn roundtrip_encode_decode(input in "\\PC*") {
        let encoded = encode(&input);
        let decoded = decode(&encoded).unwrap();
        prop_assert_eq!(input, decoded);
    }

    #[test]
    fn sort_preserves_length(ref v in prop::collection::vec(any::<i32>(), 0..100)) {
        let mut sorted = v.clone();
        sorted.sort();
        prop_assert_eq!(v.len(), sorted.len());
    }
}
```

**When to use proptest:**
- Encode/decode, serialize/deserialize roundtrips
- Parser accepts everything it produces
- Algebraic properties (commutativity, associativity, idempotency)
- Numeric invariants (e.g., `a + b >= a` for unsigned)
- Data structure invariants after mutation

For strategies, `prop_compose!`, the `Arbitrary` trait, shrinking, and
advanced patterns, see
[references/property-testing.md](references/property-testing.md).

## insta: Snapshot Testing (Summary)

Assert that output matches a stored reference. When output changes, review
the diff and accept or reject it.

```rust
use insta::assert_yaml_snapshot;

#[test]
fn serialize_config() {
    let config = Config::default();
    assert_yaml_snapshot!(config);
}
```

First run creates a `.snap` file. Subsequent runs compare output against it.
On mismatch, `cargo insta review` shows a diff for interactive accept/reject.

**When to use insta:**
- Serialization output (JSON, YAML, TOML)
- CLI output, rendered templates, error messages
- AST/IR representations
- Any complex output where manual assertions are fragile

For inline snapshots, redactions, the review workflow, and CI setup, see
[references/snapshot-testing.md](references/snapshot-testing.md).

## Benchmarking and Fuzzing (Summary)

### criterion / divan: Statistical benchmarking

```rust
use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;

fn bench_sort(c: &mut Criterion) {
    c.bench_function("sort 1000", |b| {
        b.iter(|| {
            let mut v: Vec<i32> = (0..1000).rev().collect();
            v.sort();
            black_box(v);
        })
    });
}

criterion_group!(benches, bench_sort);
criterion_main!(benches);
```

- `black_box()` prevents compiler from optimizing away the computation
- Benchmarks live in `benches/` with `harness = false` in `Cargo.toml`
- criterion gives statistical analysis: mean, std dev, regression detection

### cargo-fuzz: Crash discovery

```rust
// fuzz/fuzz_targets/parse_input.rs
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = my_crate::parse(s);
    }
});
```

- Fuzz parsers, deserializers, protocol handlers — anything taking untrusted input
- Run: `cargo +nightly fuzz run parse_input`
- Finds panics, buffer overflows, infinite loops

For full benchmark setup, `divan` comparison, fuzz target patterns, and CI
integration, see
[references/benchmarking-and-fuzzing.md](references/benchmarking-and-fuzzing.md).

## Test Runner: nextest

Use `cargo-nextest` as a drop-in replacement for `cargo test`. It runs each
test as a separate process, provides better output, and is significantly faster
for large test suites.

```bash
cargo install cargo-nextest
cargo nextest run              # run all tests
cargo nextest run test_name    # run matching tests
cargo nextest run -j4          # limit parallelism
cargo nextest run --no-fail-fast  # run all even on failure
```

**Why nextest over `cargo test`:**
- Per-test process isolation — one panic doesn't affect other tests
- Better UI with per-test timing and status
- Faster execution through smarter parallelism
- Retries for flaky tests (`--retries N`)
- Slow test detection and timeout enforcement
- CI features: partitioning, archiving, machine-readable output

**Limitation:** nextest does not run doc tests. Run `cargo test --doc`
separately for those.

## `#[should_panic]` and `#[ignore]`

### `#[should_panic]` — test that code panics

```rust
#[test]
#[should_panic(expected = "index out of bounds")]
fn panics_on_out_of_bounds() {
    let v = vec![1, 2, 3];
    let _ = v[99];
}
```

Always include `expected = "substring"` — bare `#[should_panic]` passes on
*any* panic, including unrelated bugs.

### `#[ignore]` — skip slow or environment-dependent tests

```rust
#[test]
#[ignore]
fn slow_integration_test() {
    // Only run with: cargo test -- --ignored
}
```

Run ignored tests explicitly: `cargo test -- --ignored`. Run everything:
`cargo test -- --include-ignored`.

## Common Mistakes (Agent Failure Modes)

- **Shared mutable state between tests** → Tests run in parallel by default.
  Each test gets its own setup. Use fixtures (rstest) or thread-local state,
  not `static mut`.
- **`tests/common.rs` instead of `tests/common/mod.rs`** → The former shows
  up as a test suite with 0 tests. Put shared helpers in a subdirectory.
- **One giant test with 20 assertions** → Split into focused tests. When it
  fails, you should know which invariant broke without reading the whole test.
- **`unwrap()` chains in tests without context** → Use `expect("reason")` or
  return `Result` with `?`. Failure messages should explain what went wrong.
- **Mocking everything** → Mocks test wiring, not behavior. If a real
  implementation is available (in-memory DB, test struct), use it.
- **Property tests without shrinking-friendly strategies** → Let proptest
  pick the strategy (use `any::<T>()`) rather than manually constructing
  values. Shrinking finds the minimal failing case.
- **No `#[derive(Debug, PartialEq)]` on tested types** → `assert_eq!`
  requires both. Add them early to avoid compiler errors and useless failure
  output.
- **Snapshot tests in CI without `INSTA_UPDATE=no`** → In CI, set `CI=true`
  or `INSTA_UPDATE=no` so snapshot mismatches fail instead of silently
  updating.
- **Benchmarks without `black_box()`** → The compiler may optimize away the
  computation. Wrap inputs and outputs in `std::hint::black_box()`.
- **Missing `harness = false` for criterion benchmarks** → Without it, Cargo
  uses the default test harness and criterion won't run.

## Cross-References

- **rust-idiomatic** — Newtypes and enums in test assertions, exhaustive matching
- **rust-error-handling** — `Result` return types in tests, testing error variants
- **rust-type-design** — Property testing for newtype/type-state invariants
- **rust-async** — `#[tokio::test]` for async tests, rstest async support

## Review Checklist

1. **Are unit tests in `#[cfg(test)] mod tests`?** Same file as the code,
   `use super::*`, compiled only during testing.

2. **Are integration tests in `tests/` with shared helpers in `tests/common/mod.rs`?**
   Not `tests/common.rs`. Each file in `tests/` is a separate crate.

3. **Does every test name describe the assertion, not the function?**
   `parse_rejects_empty_input`, not `test_parse`.

4. **Are parameterized tests using rstest instead of copy-pasted tests?**
   Same assertion with 3+ inputs → `#[rstest]` with `#[case]`.

5. **Do types under test derive `Debug + PartialEq`?** Required for
   `assert_eq!` to compile and produce useful output.

6. **Are invariants tested with proptest, not just examples?**
   Roundtrips, algebraic properties, data structure invariants deserve
   property tests.

7. **Are snapshot tests using insta with `cargo insta review`?** Complex
   output assertions belong in snapshots, not hand-written `assert_eq!`.

8. **Is mocking a last resort?** Real implementations (in-memory DB, test
   doubles) over mockall. Mock only when the dependency is truly external.

9. **Do benchmarks use `black_box()` and `harness = false`?** Without both,
   criterion benchmarks either don't run or measure optimized-away code.

10. **Is the test runner configured?** Use nextest for better speed and output.
    Run `cargo test --doc` separately for doc tests.
