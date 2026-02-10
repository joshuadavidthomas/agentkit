---
name: rust-type-design
description: "Use when encoding domain constraints in types, designing newtypes with invariants, implementing typestate (state-machine types), builder pattern, phantom types, or making invalid states unrepresentable. Covers validation-at-construction, state transitions that consume self, zero-variant marker types, and sealed traits."
---

# Type-Driven Domain Modeling

**rust-idiomatic** tells you *what* to do: use newtypes, use enums, encode
invariants. This skill tells you *how* — the implementation patterns, variations,
and tradeoffs for each technique.

The goal: **make invalid states unrepresentable.** Push constraints from runtime
checks to compile-time types. After parsing at boundaries, the type system
guarantees validity throughout the program.

## Pattern Catalog

### 1. Newtype — Distinguish and Constrain

A tuple struct wrapping a single field. Zero runtime cost.

**Three purposes:**
1. **Type distinction** — prevent mixing (Miles vs Kilometers)
2. **Invariant enforcement** — validate at construction (non-empty, non-zero)
3. **Encapsulation** — hide representation for future flexibility

**The minimal pattern:**
```rust
pub struct Miles(f64);

impl Miles {
    pub fn new(value: f64) -> Self {
        Self(value)
    }

    pub fn get(&self) -> f64 {
        self.0
    }
}
```

**With invariant (private field is critical):**
```rust
pub struct Port(u16);

impl Port {
    pub fn new(n: u16) -> Result<Self, PortError> {
        if n == 0 { return Err(PortError::Zero); }
        Ok(Self(n))
    }

    pub fn get(&self) -> u16 { self.0 }
}
// Port(0) won't compile — field is private. Only Port::new() works.
```

Keep the inner field private. If callers can write `Port(0)` directly, your
invariant is meaningless. The module system enforces this.

**Authority:** Rust API Guidelines [C-NEWTYPE]. std: `PathBuf`, `String`,
`NonZero<T>`. Ecosystem: `url::Url`, `semver::Version`.

For implementation details (serde, derive_more, trait impls), see
[references/newtype-patterns.md](references/newtype-patterns.md).

### 2. Typestate — State Machine in Types

Encode state transitions as type transformations. Operations unavailable in a
state don't exist on that type. The compiler rejects invalid sequences.

**The pattern:**
```rust
// Each state is a separate type
pub struct Door<State> {
    _state: std::marker::PhantomData<State>,
}

pub struct Closed;
pub struct Open;
pub struct Locked;

impl Door<Closed> {
    pub fn open(self) -> Door<Open> {
        Door { _state: PhantomData }
    }

    pub fn lock(self) -> Door<Locked> {
        Door { _state: PhantomData }
    }
}

impl Door<Open> {
    pub fn close(self) -> Door<Closed> {
        Door { _state: PhantomData }
    }
    // No lock() method — can't lock an open door
}

impl Door<Locked> {
    pub fn unlock(self) -> Door<Closed> {
        Door { _state: PhantomData }
    }
    // No open() method — must unlock first
}
```

**Key properties:**
- Operations consume `self` and return a new type
- Invalid transitions don't compile — the method doesn't exist
- State types can carry state-specific data
- Common operations go in `impl<S> Door<S>` blocks

**Variation — states with data:**
```rust
struct Connecting { attempt: u32, started: Instant }
struct Connected { session: Session }
struct Disconnecting { reason: DisconnectReason }

struct Connection<S>(S);

impl Connection<Connecting> {
    fn attempt(&self) -> u32 { self.0.attempt }

    fn succeed(self, session: Session) -> Connection<Connected> {
        Connection(Connected { session })
    }

    fn fail(self) -> Connection<Connecting> {
        Connection(Connecting {
            attempt: self.0.attempt + 1,
            started: Instant::now(),
        })
    }
}
```

**Authority:** Cliffle, "The Typestate Pattern in Rust." serde `Serializer`/
`SerializeStruct` is a production typestate. `std::process::Command` uses
builder-typestate hybrid.

For advanced patterns (sealed state traits, fallible transitions), see
[references/typestate-patterns.md](references/typestate-patterns.md).

### 3. Builder — Construct Complex Values

Separate construction from the final type. Accumulate configuration, then
produce the result.

**Non-consuming builder (preferred when possible):**
```rust
pub struct ServerConfig {
    port: u16,
    host: String,
    workers: usize,
}

#[derive(Default)]
pub struct ServerConfigBuilder {
    port: Option<u16>,
    host: Option<String>,
    workers: Option<usize>,
}

impl ServerConfigBuilder {
    pub fn port(&mut self, port: u16) -> &mut Self {
        self.port = Some(port);
        self
    }

    pub fn host(&mut self, host: impl Into<String>) -> &mut Self {
        self.host = Some(host.into());
        self
    }

    pub fn workers(&mut self, n: usize) -> &mut Self {
        self.workers = Some(n);
        self
    }

    pub fn build(&self) -> Result<ServerConfig, ConfigError> {
        Ok(ServerConfig {
            port: self.port.ok_or(ConfigError::MissingPort)?,
            host: self.host.clone().unwrap_or_else(|| "localhost".into()),
            workers: self.workers.unwrap_or(num_cpus::get()),
        })
    }
}

// Usage:
let config = ServerConfigBuilder::default()
    .port(8080)
    .host("0.0.0.0")
    .build()?;
```

**Consuming builder (when build transfers ownership):**
```rust
impl TaskBuilder {
    pub fn stdout(mut self, out: Box<dyn Write + Send>) -> Self {
        self.stdout = Some(out);
        self
    }

    pub fn spawn(self, f: impl FnOnce()) {
        // Consumes self — can't reuse builder
    }
}
```

Use consuming builders when:
- Build requires owned data (`Box<dyn Write>`)
- Builder should not be reused after build
- One-liner chaining is the primary use case

**Authority:** Rust API Guidelines [C-BUILDER]. std: `Command`, `thread::Builder`.
Ecosystem: `reqwest::ClientBuilder`, `env_logger::Builder`.

For derive macros and validation patterns, see
[references/builder-patterns.md](references/builder-patterns.md).

### 4. Phantom Types — Type-Level Tags

Use `PhantomData<T>` to carry type information without storing values.

**Tag types distinguish identical representations:**
```rust
use std::marker::PhantomData;

struct Meters;
struct Feet;

struct Length<Unit> {
    value: f64,
    _unit: PhantomData<Unit>,
}

impl<U> Length<U> {
    fn new(value: f64) -> Self {
        Self { value, _unit: PhantomData }
    }
}

// Can't add Length<Meters> to Length<Feet>
fn add<U>(a: Length<U>, b: Length<U>) -> Length<U> {
    Length::new(a.value + b.value)
}
```

**Invariant markers:**
```rust
struct Validated;
struct Unvalidated;

struct Input<State> {
    data: String,
    _state: PhantomData<State>,
}

fn validate(input: Input<Unvalidated>) -> Result<Input<Validated>, Error> {
    // Check input.data...
    Ok(Input { data: input.data, _state: PhantomData })
}

fn process(input: Input<Validated>) {
    // Can only be called with validated input
}
```

**Zero-variant enums as uninhabited markers:**
```rust
enum Sealed {}  // Can never be instantiated

struct Token<T> {
    value: u64,
    _marker: PhantomData<T>,
}
// Token<Sealed> can exist, but Sealed itself cannot
```

**Authority:** std: `PhantomData`, `PhantomPinned`. Ecosystem: typed IDs, unit
systems, permission tokens.

### 5. Sealed Traits — Close Extension

Prevent external implementations of a trait. Used for typestate bounds and
exhaustive trait matching.

```rust
mod private {
    pub trait Sealed {}
}

pub trait ConnectionState: private::Sealed {
    fn name(&self) -> &'static str;
}

pub struct Connected;
pub struct Disconnected;

impl private::Sealed for Connected {}
impl private::Sealed for Disconnected {}

impl ConnectionState for Connected {
    fn name(&self) -> &'static str { "connected" }
}

impl ConnectionState for Disconnected {
    fn name(&self) -> &'static str { "disconnected" }
}

// External code cannot impl ConnectionState — can't access private::Sealed
```

**Use when:**
- Typestate: ensure only your state types are valid
- Exhaustive dispatch: guarantee you know all implementations
- Future compatibility: add trait methods without breaking

**Authority:** Rust API Guidelines [C-SEALED]. std: `Fn`/`FnMut`/`FnOnce` traits.

## Decision Framework

**"I have a primitive with domain meaning"**
→ Newtype. String→EmailAddress, i64→UserId, f64→Celsius.

**"I have operations that are only valid in certain states"**
→ Typestate. File open/closed, connection lifecycle, protocol phases.

**"I have many optional parameters for construction"**
→ Builder. Server config, HTTP request, CLI args.

**"I need to distinguish types with identical representations"**
→ Phantom types. Units, validated/unvalidated, permission levels.

**"I need to guarantee no external implementations"**
→ Sealed trait. Typestate bounds, exhaustive matching.

**"I have a struct with a 'kind' field and optional per-kind fields"**
→ **This is wrong.** Replace with an enum carrying per-variant data.
See **rust-idiomatic** rule 7.

## Common Mistakes

**Public newtype fields (`pub struct Email(pub String)`)** → Field must be
private for invariants to hold. Use module boundaries.

**Typestate without consuming self** → Operations must take `self` (not `&self`)
to invalidate the previous state. Otherwise callers can use both states.

**Builder that panics on missing fields** → Return `Result` from `build()`.
Reserve panic for true programmer errors (double-set of exclusive fields).

**Phantom type without `PhantomData`** → The compiler will complain about unused
type parameters. `PhantomData` is the standard solution.

**Sealed trait in same module as public trait** → The `Sealed` trait must be in
a private submodule. Same-module privacy doesn't block external access.

**Typestate explosion** → If you have N states with N² transitions, consider
whether a runtime state machine (enum) is simpler. Typestate shines for linear
or nearly-linear protocols.

## Review Checklist

1. **Primitive with domain meaning in signature?** → Wrap in newtype.

2. **Newtype with public inner field?** → Make private, add accessor method.

3. **Operations valid only in some states?** → Consider typestate.

4. **Typestate method returns `&self` or `&mut self`?** → Should consume `self`
   and return new state type.

5. **Constructor with many optional parameters?** → Use builder pattern.

6. **Builder panics on invalid config?** → Return `Result` instead.

7. **Need to distinguish same-representation values?** → Phantom type parameter.

8. **Trait that must not be externally implemented?** → Seal it.

9. **Struct with kind field + Option fields per kind?** → Replace with enum.

10. **Runtime validation repeated throughout codebase?** → Parse once at boundary
    into a type that encodes the validated state.

## Cross-References

- **rust-idiomatic** — When to use these patterns (the "what")
- **rust-ownership** — Consuming self, borrowing in builders
- **rust-traits** — Sealed traits, trait bounds for typestate
- **rust-error-handling** — Result types for fallible construction
