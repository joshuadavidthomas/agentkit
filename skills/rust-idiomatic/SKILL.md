---
name: rust-idiomatic
description: "Use for any Rust implementation or review when you see non-domain primitives (bare String/bool), kind+Option structs, wildcard enum matches (_ =>), Error(String), runtime validation, or dyn Trait used for a closed set. Sets enum-first, newtype-heavy, parse-don't-validate defaults."
---

# Think in Rust

You already know Rust syntax. This skill changes your **defaults** — what you reach
for first when modeling a domain, handling errors, or designing an API.

The core failure mode: writing Rust that compiles but thinks like Python or TypeScript.
Bare `String` for domain types. `bool` for states. Trait objects for closed sets.
`Error(String)` for everything. `_ =>` in every match. These compile. They are wrong.

## The Rules

### 1. Every string with domain meaning is a newtype

Bare `String` erases domain knowledge. The compiler can't distinguish an email from a
username from a URL. Wrap it.

```rust
// WRONG
fn send_email(to: String, subject: String, body: String) { todo!() }
```

```rust
// RIGHT
struct EmailAddress(String);
struct Subject(String);

fn send_email(to: &EmailAddress, subject: &Subject, body: &str) { todo!() }
```

Newtypes are zero-cost. The compiler optimizes them away. Use them freely.

**Validate at construction, not at use:**
```rust
impl EmailAddress {
    pub fn new(raw: String) -> Result<Self, EmailError> {
        if !raw.contains('@') { return Err(EmailError::MissingAt); }
        Ok(Self(raw))
    }
}
// After construction, every EmailAddress is valid. No re-checking.
```

Make the inner field private. Expose access through methods. This preserves invariants
and lets you change the representation later.

**Authority:** Rust API Guidelines [C-NEWTYPE]. std: `PathBuf`, `OsString`,
`NonZero<u32>`. Ecosystem: `url::Url`, `semver::Version`, `http::Uri`.

For implementation patterns (privacy, trait impls, serde), see
[references/newtypes-and-domain-types.md](references/newtypes-and-domain-types.md).

### 2. Every boolean parameter is a lie — use an enum

`true` and `false` carry no meaning at the call site. Enums are self-documenting
and extensible.

```rust
// WRONG
fn print_page(double_sided: bool, color: bool) { todo!() }
print_page(true, false); // Which is which?
```

```rust
// RIGHT
enum Sides { Single, Double }
enum Output { Color, BlackAndWhite }

fn print_page(sides: Sides, output: Output) { todo!() }
print_page(Sides::Double, Output::BlackAndWhite); // Reads like prose
```

When a third option appears (`Sides::Booklet`), enums extend naturally. Booleans
require a breaking API change.

This applies to boolean **struct fields** too:
```rust
// WRONG
struct DisplayProps { monochrome: bool, fg_color: RgbColor }
// What's fg_color when monochrome is true? Who enforces that?

// RIGHT
enum Color { Monochrome, Foreground(RgbColor) }
struct DisplayProps { color: Color }
// Invalid state is unrepresentable.
```

**Authority:** Rust API Guidelines [C-CUSTOM-TYPE]. clippy: `fn_params_excessive_bools`.

### 3. Every "I don't know" is explicit

`vec![]` and `None` are ambiguous. An empty vec might mean "we checked and found
nothing" or "we haven't checked yet." Make the distinction a type.

```rust
// WRONG — conflates "unknown" with "known-empty"
struct User { roles: Vec<Role> }

// RIGHT — states are distinct
enum Knowledge<T> {
    Unknown,
    Known(T),
}
struct User { roles: Knowledge<Vec<Role>> }
```

Now `Knowledge::Known(vec![])` means "has no roles" and `Knowledge::Unknown` means
"roles haven't been loaded." The compiler forces callers to handle both.

A simpler variant when "not yet loaded" is the only unknown:
```rust
struct User { roles: Option<Vec<Role>> }  // None = not loaded yet
```

Use `Option` when the distinction is binary and obvious from context. Use a custom
enum when there are multiple "unknown" reasons or when `None` would be ambiguous.

### 4. Every match is exhaustive — no wildcard `_ =>` arms

Wildcard arms hide bugs. When you add a variant, the compiler should tell you every
place that needs updating. `_ =>` silences that.

```rust
// WRONG — adding a variant won't produce compile errors
match status {
    Status::Active => handle_active(),
    Status::Inactive => handle_inactive(),
    _ => handle_other(), // Swallows future variants silently
}

// RIGHT — compiler enforces completeness
match status {
    Status::Active => handle_active(),
    Status::Inactive => handle_inactive(),
    Status::Suspended => handle_suspended(),
}
```

**The only acceptable uses of `_ =>`:**
- Matching on foreign types marked `#[non_exhaustive]`
- Matching on primitives (`u32`, `char`) where exhaustive listing is impossible
- Matching on string literals where you've covered the domain

For enums you control: list every variant. Always.

**Authority:** clippy: `wildcard_enum_match_arm`, `match_wildcard_for_single_variants`.

### 5. Every error variant is a domain fact — no `Error(String)`

`Error(String)` throws away structure. Callers can't match on it, test it, or
recover from specific failures. Error types are part of your domain model.

```rust
// WRONG
#[derive(Debug)]
enum AppError {
    Database(String),
    Validation(String),
    Other(String),
}

// RIGHT
#[derive(Debug, thiserror::Error)]
enum DatabaseError {
    #[error("connection to {host} timed out after {timeout:?}")]
    ConnectionTimeout { host: String, timeout: Duration },
    #[error("query failed: {source}")]
    QueryFailed { source: sqlx::Error },
    #[error("migration {name} failed")]
    MigrationFailed { name: String },
}
```

Each variant is a **fact** about what went wrong. Callers can match, retry, log, or
translate them. For the full error strategy (library vs application, thiserror vs anyhow,
boundary rules), see **rust-error-handling**.

**Authority:** Effective Rust Item 4. std: `io::ErrorKind`, `num::ParseIntError`.

### 6. Parse, don't validate

Validation checks data and throws away the result. Parsing checks data and **encodes
the result in the type**. After parsing, the type guarantees validity — no re-checking.

```rust
// VALIDATION — checks but forgets
fn process_config(dirs: Vec<PathBuf>) -> Result<(), Error> {
    if dirs.is_empty() {
        return Err(Error::NoDirs);
    }

    let first = &dirs[0]; // Re-checking emptiness elsewhere
    let _ = first;
    Ok(())
}
```

```rust
// PARSING — checks and *keeps the proof in a binding*
fn process_config(dirs: Vec<PathBuf>) -> Result<(), Error> {
    let (first, _rest) = dirs.split_first().ok_or(Error::NoDirs)?;
    let _ = first; // Guaranteed to exist
    Ok(())
}
```

If the invariant must cross function boundaries, wrap it in a domain type (e.g.
`NonEmptyVec<T>`). See [references/parse-dont-validate.md](references/parse-dont-validate.md).

**The pattern:** Convert less-structured input to more-structured types at system
boundaries (CLI args, HTTP requests, config files, database rows). Once converted,
the types carry the proof of validity.

```rust
// At the boundary: raw input → domain types
let request: RawRequest = parse_http(stream)?;
let command: ValidatedCommand = Command::parse(request)?;
// Past the boundary: domain types only. No re-validation.
execute(command);
```

For deep-dive on boundary parsing patterns, see
[references/parse-dont-validate.md](references/parse-dont-validate.md).

**Authority:** Alexis King, "Parse, Don't Validate." Lexi Lambda blog.
std: `NonZero<T>`, `IpAddr`, `SocketAddr`. Ecosystem: `url::Url`, `http::Method`.

### 7. Enums are the primary modeling tool

Rust enums are sum types — they represent "one of these things." They are the correct
tool for closed sets: HTTP methods, AST nodes, config variants, command types, state
machines.

```rust
// WRONG — struct with a "kind" field
struct Shape {
    kind: ShapeKind,
    radius: Option<f64>,     // Only for circles
    width: Option<f64>,      // Only for rectangles
    height: Option<f64>,     // Only for rectangles
}

// RIGHT — enum with per-variant data
enum Shape {
    Circle { radius: f64 },
    Rectangle { width: f64, height: f64 },
    Triangle { base: f64, height: f64 },
}
// No invalid states. No Option fields. Pattern matching enforces handling.
```

Enums encode state machines:
```rust
enum Connection {
    Disconnected,
    Connecting { attempt: u32, started_at: Instant },
    Connected { session: Session },
    Disconnecting { reason: DisconnectReason },
}
// The type tells you exactly what data is available in each state.
```

**Authority:** std: `IpAddr`, `Cow`, `Option`, `Result`, `Ordering`.
Effective Rust Item 1.

For more enum modeling examples, see
[references/enums-as-modeling-tool.md](references/enums-as-modeling-tool.md).

### 8. Enums for closed sets, trait objects for open sets

**Closed set** — you know all the variants at compile time: HTTP methods, AST node
types, config file formats. Use an **enum**.

**Open set** — users or plugins add new variants: storage backends, log formatters,
middleware. Use a **trait object** (`dyn Trait`) or generics.

```rust
// CLOSED — you know all the shapes
enum Shape { Circle(f64), Rectangle(f64, f64) }

fn area(shape: &Shape) -> f64 {
    match shape {
        Shape::Circle(r) => std::f64::consts::PI * r * r,
        Shape::Rectangle(w, h) => w * h,
    }
}

// OPEN — users define their own backends
trait Storage: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, StorageError>;
    fn put(&self, key: &str, value: &[u8]) -> Result<(), StorageError>;
}

fn create_cache(backend: Box<dyn Storage>) -> Cache { todo!() }
```

**When agents get this wrong:** They default to `dyn Trait` for everything — a habit
from languages where interfaces are the only abstraction. In Rust, enums are cheaper
(no vtable, no allocation), enable exhaustive matching, and carry per-variant data.

Use trait objects or generics when:
- The set is genuinely open (plugin systems, user-defined types)
- You need heterogeneous collections of unknown concrete types
- You're erasing types for API simplicity (`Box<dyn Error>`)

For the full decision framework (generics vs trait objects vs enums), see
**rust-traits**.

### 9. Borrow by default — own when intentional

Functions should borrow unless they need ownership. Ownership is a **decision**, not
a default.

```rust
// WRONG — takes ownership unnecessarily
fn contains_admin(users: Vec<User>) -> bool { todo!() }
```

```rust
// RIGHT — borrows the data it only needs to read
fn contains_admin(users: &[User]) -> bool { todo!() }
```

**Take ownership when:**
- The function stores the value (struct field, collection insertion)
- The function transforms and returns the value (builder pattern, `into_*` methods)
- The function needs to move the value to another thread

**Borrow when:**
- The function only reads the data (`&T`)
- The function needs to modify but not consume (`&mut T`)

For function signatures, prefer `&str` over `&String`, `&[T]` over `&Vec<T>`,
`&Path` over `&PathBuf`. Accept the most general borrowed form.

**Authority:** Effective Rust Items 14-15. Rust API Guidelines [C-CALLER-CONTROL].

## Common Mistakes (Agent Failure Modes)

- **Public newtype fields (`pub struct Email(pub String)`)** → Make the field private and force construction through `parse`/`new` so invariants can't be bypassed.
- **Boolean flags leaking into APIs** → Replace with enums, even when there are only two states today.
- **"Kind" field + `Option` payload fields** → Replace with an enum carrying per-variant data; delete the `Option` fields.
- **Wildcard matches on your own enums (`_ =>`)** → List every variant; adding a variant should break the build.
- **Validation that returns `Result<(), E>`** → Parse once at the boundary into a domain type; pass the domain type forward.
- **`Error(String)` / `anyhow::Error` in a library** → Define a structured error enum; reserve `anyhow` for application boundaries.
- **Taking ownership by default (`String`, `Vec<T>`, `PathBuf`)** → Borrow (`&str`, `&[T]`, `&Path`) unless you store/return/transfer ownership.

## Cross-References

- **rust-type-design** — Newtype patterns, typestate, phantom types, builder pattern
- **rust-error-handling** — Full error strategy (library vs app, thiserror vs anyhow)
- **rust-ownership** — Borrow checker errors, smart pointer decisions, lifetime design
- **rust-traits** — Trait design, static vs dynamic dispatch, object safety

## Review Checklist

Run through this list when reviewing Rust code — yours or the agent's.

1. **Bare `String` in a struct or function signature?** → Newtype it.
   Exception: truly arbitrary text with no domain meaning.

2. **`bool` parameter or struct field?** → Replace with a two-variant enum.
   Exception: genuinely boolean domain concept (e.g., `is_alive` in a health check).

3. **`Option` where `None` is ambiguous?** → Custom enum with named variants.

4. **`_ =>` in a match on an enum you control?** → List every variant.

5. **`Error(String)` or `anyhow!` in a library?** → Structured error enum with
   per-variant data.

6. **Validation function that returns `Result<(), E>`?** → Parse into a
   more-specific type instead.

7. **Struct with "kind" field + `Option` fields per kind?** → Enum with
   per-variant data.

8. **`dyn Trait` for a set you can enumerate?** → Enum.

9. **Function takes `Vec<T>` or `String` by value but only reads it?** → Borrow
   as `&[T]` or `&str`.

10. **`clone()` to satisfy the borrow checker?** → Check if you can restructure
    to borrow instead. Clone is fine when intentional, not when it's a band-aid.
