---
name: rust-error-handling
description: "Use when designing error types, choosing thiserror vs anyhow, propagating errors with ?, writing Result/Option combinators, or asking how to handle errors in a Rust project. Covers library vs application strategy, structured error enums, error context/chaining, when to panic, and bail!/ensure! macros."
---

# Error Strategy and Design

Errors are **domain facts**, not formatting exercises. An error type tells callers what
went wrong, whether they can recover, and what information is available. Design them
with the same care as your success types.

The central axis: **library or application?** Everything flows from that.

## The Central Rule: Library vs Application

| Context | Crate | Error type | Why |
|---------|-------|-----------|-----|
| **Library** (reusable crate) | `thiserror` | Structured `enum` | Callers need variants to match on for control flow |
| **Application** (binary, server) | `anyhow` | `anyhow::Error` | You control the error boundary; you need context, not types |
| **Boundary** (lib consumed by your app) | Both | thiserror at the edge, anyhow inside | Structured where callers need it, ergonomic where they don't |

This is the ecosystem consensus. BurntSushi, Palmieri, Effective Rust Item 4, and
the crate authors themselves all converge on it.

## Library Errors: thiserror

Libraries expose structured error types. Callers match on variants for control flow
and recovery. Every variant is a **fact** about what failed.

### Rule 1: One error enum per unit of fallibility

Don't build one `Error` enum for an entire crate. Each public function (or tightly
related group) gets its own error type scoped to *its* failure modes.

```rust
// WRONG — crate-wide "ball of mud"
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("connection failed")]
    Connection(#[from] std::io::Error),
    #[error("parse failed")]
    Parse(#[from] serde_json::Error),
    #[error("auth failed")]
    Auth,
    #[error("rate limited")]
    RateLimit { retry_after: Duration },
    // 15 more variants from unrelated subsystems...
}
```

```rust
// RIGHT — scoped to the operation
#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    #[error("DNS resolution failed for {host}")]
    DnsFailure { host: String, source: std::io::Error },
    #[error("TLS handshake failed")]
    TlsHandshake(#[source] native_tls::Error),
    #[error("connection timed out after {timeout:?}")]
    Timeout { timeout: Duration },
}

#[derive(Debug, thiserror::Error)]
pub enum QueryError {
    #[error("query syntax error at position {position}")]
    Syntax { position: usize },
    #[error("query execution failed")]
    Execution(#[source] sqlx::Error),
}
```

**Why:** Scoped errors let callers know exactly which failures a function can produce.
A crate-wide enum forces callers to handle variants that can't actually occur. It
also leaks internal structure — adding a dependency's error type to your public enum
exposes that dependency.

**Authority:** Jewson, "Modular Errors in Rust." Effective Rust Item 4.

### Rule 2: Variants carry structured data, not strings

Each variant is a data structure. Callers extract fields for logging, retry logic,
or user messages. `Error(String)` forces them to parse your prose.

```rust
// WRONG
#[error("invalid config: {0}")]
InvalidConfig(String),

// RIGHT
#[error("config key {key:?} must be a positive integer, got {value:?}")]
InvalidConfigValue { key: String, value: String },
```

**Authority:** std: `io::Error` has `ErrorKind` + optional inner error. `serde_json::Error`
has `line()`, `column()`, `classify()`. **rust-idiomatic** Rule 5.

### Rule 3: Preserve the error chain with `#[source]`

Every variant wrapping an underlying error must expose it via `source()`. This
enables error chain traversal for logging and diagnostics.

```rust
// WRONG — chain broken, cause is lost
#[error("database query failed: {0}")]
Database(String),  // .source() returns None

// RIGHT — chain preserved
#[error("database query failed")]
Database {
    #[source]
    source: sqlx::Error,
    query: String,
},
```

`#[from]` implies `#[source]` and generates a `From` impl. Use `#[from]` when the
conversion is unambiguous (one variant per source type). Use `#[source]` when you
need additional context fields alongside the cause.

**Authority:** `std::error::Error::source` + thiserror docs (source chaining).

### Rule 4: Don't auto-derive `From` for everything

`#[from]` generates `From<SourceError> for YourError`. This is convenient but
dangerous — it silently wraps errors without context and prevents having multiple
variants from the same source type.

```rust
// CAREFUL — auto-conversion loses context about WHICH io operation failed
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error")]
    Io(#[from] std::io::Error),  // Which file? Which operation? Lost.
}

// BETTER — explicit conversion adds context
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("failed to read config from {path}")]
    ReadConfig { source: std::io::Error, path: PathBuf },
    #[error("failed to write output to {path}")]
    WriteOutput { source: std::io::Error, path: PathBuf },
}
```

Use `#[from]` when the source type is unambiguous (e.g., one JSON error variant).
Use manual construction when you need to distinguish multiple operations with the
same underlying error type.

**Authority:** thiserror docs (`#[from]` constraints) + Jewson (contextful, scoped errors).

### Rule 5: Mark variants `#[non_exhaustive]` for public crates

If you publish a crate, adding a variant is a breaking change unless the enum is
`#[non_exhaustive]`. Apply it to public error enums that may grow.

```rust
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ParseError {
    #[error("unexpected token {token:?} at line {line}")]
    UnexpectedToken { token: String, line: usize },
    #[error("unterminated string literal")]
    UnterminatedString,
}
```

Callers will need a `_ =>` arm — but this is the correct exception to
**rust-idiomatic** Rule 4 (foreign `#[non_exhaustive]` types).

**Authority:** Rust Reference: `#[non_exhaustive]` + Rust semver expectations for public enums.

### Rule 6: Define a `Result` type alias

Reduce repetition. Follow the std convention (`io::Result`, `fmt::Result`).

```rust
pub type Result<T> = std::result::Result<T, Error>;
```

For full thiserror attribute reference (all derive attributes, `#[error(transparent)]`,
backtrace support), see [references/thiserror-patterns.md](references/thiserror-patterns.md).

## Application Errors: anyhow

Application code doesn't export error types — it **handles** them. Use `anyhow` for
ergonomic propagation with context.

### Rule 7: Use `anyhow::Result` as your return type

```rust
use anyhow::{Context, Result};
use std::path::Path;

fn load_config(path: &Path) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config from {}", path.display()))?;
    let config: Config = toml::from_str(&content)
        .context("failed to parse config as TOML")?;
    Ok(config)
}
```

Every `?` propagates with the full error chain intact. `context()` and
`with_context()` add layers of "what was happening when this failed."

### Rule 8: Add context at every abstraction boundary

Bare `?` propagates the error but loses *what you were trying to do*. Add context
so the error chain reads like a stack trace of intent.

```rust
use anyhow::{Context, Result};
use std::path::Path;

// WRONG — bare propagation (no context)
fn setup_wrong(config_path: &Path) -> Result<()> {
    let config = load_config(config_path)?;     // "file not found" — which file?
    let _db = connect_db(&config)?;             // "connection refused" — to what?
    Ok(())
}

// RIGHT — context at each boundary
fn setup(config_path: &Path) -> Result<()> {
    let config = load_config(config_path)
        .context("failed to load application config")?;
    let _db = connect_db(&config)
        .context("failed to connect to database")?;
    Ok(())
}
```

**Output with `{:#}`:**
```
failed to connect to database: connection refused: Connection refused (os error 111)
```

Use `.context("static string")` for fixed messages. Use
`.with_context(|| format!(...))` when you need runtime values — the closure is only
evaluated on error.

### Rule 9: Use `bail!` and `ensure!` for early returns

```rust
use anyhow::{bail, ensure, Result};

fn validate_port(port: u16) -> Result<()> {
    ensure!(port != 0, "port must be non-zero");
    Ok(())
}

fn process_command(cmd: &str) -> Result<()> {
    if cmd.is_empty() {
        bail!("empty command");
    }
    // ...
    Ok(())
}
```

`bail!(...)` is `return Err(anyhow!(...))`. `ensure!(cond, ...)` is
`if !cond { bail!(...) }`. Both accept format strings.

For the full anyhow API reference (display formats, chain iteration, downcasting),
see [references/anyhow-patterns.md](references/anyhow-patterns.md).

## Result and Option Combinators

The `?` operator handles the common case. Combinators handle the rest. Don't write
`match` when a combinator expresses intent more clearly.

### The essential combinators

| Combinator | On | Does | Use when |
|---|---|---|---|
| `map` | `Result`/`Option` | Transform the success/some value | Adapting the inner type |
| `map_err` | `Result` | Transform the error | Adding context or converting error types |
| `and_then` | `Result`/`Option` | Chain a fallible operation | Next step can also fail |
| `unwrap_or` | `Result`/`Option` | Provide a default | Fallback value is cheap |
| `unwrap_or_else` | `Result`/`Option` | Provide a lazy default | Fallback is expensive to compute |
| `unwrap_or_default` | `Result`/`Option` | Use `Default::default()` | Type has a sensible default |
| `ok_or` / `ok_or_else` | `Option` | Convert to `Result` | `None` is an error condition |
| `transpose` | `Option<Result>` | Flip to `Result<Option>` | Working with optional fallible ops |

```rust
// map_err: convert between error types at boundaries
let id = input.parse::<u64>()
    .map_err(|e| ApiError::InvalidId { raw: input.into(), source: e })?;

// ok_or_else: Option → Result when absence is an error
let user = users.get(&id)
    .ok_or_else(|| ApiError::NotFound { id })?;

// and_then: chain fallible operations
let config = std::env::var("CONFIG_PATH")
    .ok()
    .and_then(|p| std::fs::read_to_string(p).ok());
```

For the full combinator quick-reference with more examples, see
[references/combinators.md](references/combinators.md).

## When to Panic

Panics are for **bugs**, not errors. A panic means "this is a programmer mistake
and the program cannot continue." User input failures, network errors, file-not-found
— these are expected conditions, not panics.

### `panic!` is correct for:

- **Internal invariant violations** — a state your code guarantees can't happen
- **Unrecoverable system failures** — `mmap` failed, allocator OOM
- **Unreachable code paths** — `unreachable!()` after exhaustive checks

### `expect()` over `unwrap()`

When you know a value is `Some`/`Ok` due to prior logic, use `expect()` with a
message explaining **why** it's safe:

```rust
// After validation that guarantees non-empty
let first = validated_items.first()
    .expect("validated_items is non-empty after validation");

// Static regex that is known valid at compile time
let re = Regex::new(r"^\d{4}-\d{2}-\d{2}$")
    .expect("date regex is valid");
```

`unwrap()` is acceptable in tests and when the safety is obvious from the
immediately surrounding code. In production code, prefer `expect()` with a
message or propagate with `?`.

### Never panic for:

- User input (parse it, return `Result`)
- File/network I/O (always `Result`)
- Configuration errors (return `Result`, let the caller decide)
- Missing optional data (use `Option`)

**Authority:** BurntSushi, "unwrap is not that bad." Effective Rust Item 3.

## Error Boundary Rules

Errors cross abstraction boundaries. Handle the translation deliberately.

### Log once, at the edge

Don't log errors at every layer. Each layer **propagates** (via `?` or context).
The outermost handler — `main()`, the HTTP middleware, the CLI runner — logs once
with the full chain.

```rust
// WRONG — logging at every layer
fn read_config() -> Result<Config> {
    let content = std::fs::read_to_string("config.toml")
        .map_err(|e| {
            log::error!("Failed to read config: {}", e);  // logged here
            AppError::Config(e)
        })?;
    Ok(parse(content)?)
}

// RIGHT — propagate, log at the edge
fn read_config() -> Result<Config> {
    let content = std::fs::read_to_string("config.toml")
        .context("failed to read config.toml")?;
    Ok(parse(content).context("failed to parse config")?)
}

fn main() {
    if let Err(err) = run() {
        // Log ONCE with full chain
        eprintln!("Error: {:#}", err);
        std::process::exit(1);
    }
}
```

### Translate at layer boundaries

When crossing from one abstraction to another (e.g., database → domain → HTTP),
translate the error into the vocabulary of the outer layer. Don't leak
`sqlx::Error` through your API boundary.

```rust
// Domain layer — speaks domain language
#[derive(Debug, thiserror::Error)]
pub enum UserError {
    #[error("user {id} not found")]
    NotFound { id: UserId },
    #[error("email {email} already registered")]
    DuplicateEmail { email: String },
    #[error("internal database error")]
    Internal(#[source] sqlx::Error),
}

// Repository translates database errors into domain errors
impl UserRepo {
    pub fn find(&self, id: UserId) -> Result<User, UserError> {
        self.db.query(/* ... */)
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => UserError::NotFound { id },
                other => UserError::Internal(other),
            })
    }
}
```

### Retryability as a method

If callers need to decide whether to retry, expose it as a method — don't make
them match on variant names they can't rely on.

```rust
impl ApiError {
    pub fn is_retryable(&self) -> bool {
        matches!(self,
            Self::RateLimit { .. } |
            Self::ServiceUnavailable { .. } |
            Self::Timeout { .. }
        )
    }
}
```

## Common Mistakes (Agent Failure Modes)

- **`Error(String)` in a library** → Callers can't match. Define structured variants.
  Use **rust-idiomatic** Rule 5.
- **One giant error enum for the whole crate** → Scope errors to operations.
  Callers handle only what a function can actually produce.
- **`#[from]` on every variant** → Silent conversions lose context. Use `#[from]`
  only when conversion is unambiguous.
- **`anyhow` in a library's public API** → Callers lose the ability to match.
  Use `thiserror` for public errors; `anyhow` is for your binary.
- **Bare `?` without context in application code** → The error chain says *what*
  failed but not *what you were doing*. Add `.context()`.
- **Logging errors at every layer** → Log once at the outermost handler.
  Inner layers propagate.
- **`unwrap()` on user input or I/O** → These are expected failure modes.
  Use `?` or combinators.
- **`Box<dyn Error>` as the public error type** → Callers can't match without
  downcasting. Use a concrete enum.

## Cross-References

- **rust-idiomatic** — Rule 5 (error variants as domain facts), the foundational defaults
- **rust-type-design** — Newtype errors, parse-don't-validate at boundaries
- **rust-ownership** — Owned vs borrowed data in error types, `Send + Sync` bounds
- **rust-traits** — `Error` trait, `From` implementations, trait objects for error erasure
- **rust-async** — `?` in async functions, `JoinError` handling, error propagation across tasks

## Review Checklist

1. **Library or application?** Libraries use `thiserror` enums. Applications use
   `anyhow`. At the boundary, use both.

2. **Is the error type scoped to its operation?** One crate-wide `Error` enum is a
   code smell. Each public function (or related group) should have its own error type.

3. **Does every variant carry structured data?** No `Error(String)`. Callers must be
   able to extract fields, not parse messages.

4. **Is the error chain preserved?** Every variant wrapping a cause uses `#[source]`
   or `#[from]`. Calling `.source()` walks the full chain.

5. **Is `#[from]` used only where unambiguous?** Multiple variants from the same
   source type? Use manual construction with context fields instead.

6. **Does application code add context at every `?`?** Bare propagation loses intent.
   Add `.context()` or `.with_context()`.

7. **Are panics reserved for bugs?** User input, I/O, and network errors use `Result`.
   `panic!` is for invariant violations and unreachable code.

8. **Are errors logged once, at the edge?** Inner layers propagate. The outermost
   handler logs with `{:#}` for the full chain.

9. **Are error types translated at layer boundaries?** Database errors don't leak
   through the domain API. Each layer speaks its own vocabulary.

10. **Is there a `Result` type alias?** `pub type Result<T> = std::result::Result<T, Error>;`
    reduces boilerplate within each module.
