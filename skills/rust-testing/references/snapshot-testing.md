# Snapshot Testing with insta

Snapshot tests assert that output matches a stored reference. Instead of
writing manual assertions for complex output, you capture the output once,
review it, and then future runs detect any changes. Think of it as "golden
file" testing with excellent tooling.

## Setup

```toml
[dev-dependencies]
insta = { version = "1", features = ["yaml", "redactions"] }
```

Enable features for the serialization formats you need:
- `yaml` — `assert_yaml_snapshot!` (recommended default — line-based, clean diffs)
- `json` — `assert_json_snapshot!`, `assert_compact_json_snapshot!`
- `toml` — `assert_toml_snapshot!`
- `ron` — `assert_ron_snapshot!`
- `csv` — `assert_csv_snapshot!`
- `redactions` — dynamic content masking

Install the CLI tool: `cargo install cargo-insta`

Optional: speed up snapshot processing in dev builds:
```toml
[profile.dev.package]
insta.opt-level = 3
similar.opt-level = 3
```

## Snapshot Assertion Macros

### Serialized snapshots (serde-based, support redactions)

```rust
use insta::assert_yaml_snapshot;

#[test]
fn config_defaults() {
    let config = Config::default();
    assert_yaml_snapshot!(config);
}
```

The value must implement `serde::Serialize`. The snapshot is stored as YAML
(or JSON, TOML, etc. depending on the macro).

### Debug snapshots (no serde required)

```rust
use insta::assert_debug_snapshot;

#[test]
fn parsed_ast() {
    let ast = parse("1 + 2 * 3");
    assert_debug_snapshot!(ast);
}
```

Uses `std::fmt::Debug`. No redaction support. Use when the type doesn't
implement `Serialize` or when Debug output is more readable.

### String snapshots

```rust
use insta::assert_snapshot;

#[test]
fn error_message() {
    let msg = format_error(Error::NotFound { id: 42 });
    assert_snapshot!(msg);
}
```

For any `impl Into<String>`. Use for CLI output, rendered templates, error
messages — anything that produces text.

## File vs Inline Snapshots

### File snapshots (default)

Stored in `snapshots/` directory next to the test file:

```text
src/
├── parser.rs
└── snapshots/
    └── my_crate__parser__tests__parsed_ast.snap
```

The `.snap` file contains a YAML header (metadata) and the snapshot body:

```
---
source: src/parser.rs
expression: ast
---
BinaryOp(
    Add,
    Literal(1),
    BinaryOp(Mul, Literal(2), Literal(3)),
)
```

### Inline snapshots (embedded in source)

Write the snapshot directly in the test file:

```rust
#[test]
fn inline_example() {
    let output = process("hello");
    // Start with an empty snapshot:
    assert_snapshot!(output, @"");
}
```

After running `cargo insta review` and accepting, insta fills in the value:

```rust
assert_snapshot!(output, @"HELLO");
```

Multi-line inline snapshots use raw strings:

```rust
assert_snapshot!(output, @r###"
line one
line two
"###);
```

**When to use inline:** Short output (1-5 lines) where seeing the expected
value inline with the test improves readability.

**When to use file:** Complex output, multi-line structures, anything where
inline would clutter the test.

## The Review Workflow

### Step 1: Run tests

```bash
cargo test                    # Creates .snap.new files for new/changed snapshots
cargo insta test              # Same, but integrated with insta CLI
cargo insta test --review     # Run tests then immediately review
```

### Step 2: Review changes

```bash
cargo insta review
```

Interactive TUI:
- `a` — accept the new snapshot
- `r` — reject (keep the old snapshot)
- `s` — skip (leave `.snap.new` for later)
- `d` — toggle diff view

### Step 3: Commit

Accepted snapshots update the `.snap` files (or inline source). Commit both
the test changes and the updated snapshots.

### Non-interactive alternatives

```bash
cargo insta accept             # Accept all pending snapshots
cargo insta reject             # Reject all pending snapshots
cargo insta pending-snapshots  # List what needs review
```

### Environment variable control

| Variable | Effect |
|----------|--------|
| `INSTA_UPDATE=auto` | Default — writes `.snap.new`, no update in CI |
| `INSTA_UPDATE=no` | Only compares, never writes (CI mode) |
| `INSTA_UPDATE=always` | Overwrites snapshots immediately |
| `INSTA_UPDATE=new` | Always creates `.snap.new` files |

Set `CI=true` in CI pipelines — this makes `auto` behave like `no`, so
snapshot mismatches fail the build.

## Redactions

Mask dynamic content (timestamps, UUIDs, random IDs) so snapshots are
deterministic. Requires the `redactions` feature.

### Static redactions

```rust
use insta::assert_yaml_snapshot;

#[test]
fn user_snapshot() {
    let user = create_user();
    assert_yaml_snapshot!(user, {
        ".id" => "[uuid]",
        ".created_at" => "[timestamp]",
        ".sessions[].token" => "[token]",
    });
}
```

The snapshot stores the placeholder instead of the actual value:

```yaml
---
id: "[uuid]"
name: Alice
created_at: "[timestamp]"
sessions:
  - token: "[token]"
    active: true
```

### Selector syntax

| Selector | Matches |
|----------|---------|
| `.key` | Specific key |
| `["key"]` | Alternative key syntax |
| `[0]` | Array index |
| `[]` | All array items |
| `[0:3]` | Array slice |
| `.*` | All keys at one level |
| `.**` | Deep match (zero or more levels) |

### Dynamic redactions

Validate content while redacting:

```rust
assert_yaml_snapshot!(user, {
    ".id" => insta::dynamic_redaction(|value, _path| {
        // Validate it's a UUID format
        let s = value.as_str().unwrap();
        assert_eq!(s.len(), 36, "expected UUID format");
        "[uuid]"
    }),
});
```

### Sorted redactions

For non-deterministic ordering (HashSet, HashMap):

```rust
assert_yaml_snapshot!(data, {
    ".tags" => insta::sorted_redaction(),
});
```

## Annotating Snapshots

Add context for reviewers using `with_settings!`:

```rust
insta::with_settings!({
    description => "Rendered email template for password reset",
    info => &context_data,    // Serializable metadata shown during review
    omit_expression => true,  // Hide the default expression line
}, {
    assert_snapshot!(rendered_email);
});
```

## Naming Snapshots

By default, insta names snapshots from the test function. Override with an
explicit name:

```rust
assert_yaml_snapshot!("custom-name", value);
```

Useful when one test produces multiple snapshots or when the auto-generated
name is too long.

## Glob Testing

Test all files matching a pattern:

```rust
use insta::glob;

#[test]
fn test_all_fixtures() {
    glob!("fixtures/*.txt", |path| {
        let input = std::fs::read_to_string(path).unwrap();
        let output = process(&input);
        assert_snapshot!(output);
    });
}
```

Each file gets its own snapshot. New fixture files automatically create new
test cases.

**Authority:** insta docs (mitsuhiko/insta); snapshot testing pattern from
Jest (JavaScript) adapted for Rust's compile-time guarantees.
