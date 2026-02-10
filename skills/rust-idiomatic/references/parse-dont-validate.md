# Parse, Don't Validate — Boundary Patterns

The core distinction: **validation** checks data and throws away the proof.
**Parsing** checks data and encodes the result in the type system. After parsing,
the type guarantees validity — no downstream re-checking.

## The Problem with Validation

```rust
fn process_order(items: Vec<Item>, customer_id: String) -> Result<(), OrderError> {
    // Validation: check then forget
    if items.is_empty() {
        return Err(OrderError::EmptyOrder);
    }
    if customer_id.is_empty() {
        return Err(OrderError::MissingCustomer);
    }

    // Later in the function (or a called function):
    let first_item = items.first().unwrap(); // "we already checked" — but the
                                              // type doesn't know that
    // ...
}
```

Every function downstream must either:
- Re-validate (redundant, error-prone)
- Trust that someone validated upstream (`unwrap()`, comments saying "safe because...")
- Accept `Option` and handle `None` again

This is **shotgun parsing** — validation scattered throughout the codebase, hoping
every path checks everything.

## The Parsing Pattern

```rust
struct NonEmptyVec<T>(Vec<T>);

impl<T> NonEmptyVec<T> {
    pub fn try_from_vec(v: Vec<T>) -> Result<Self, EmptyVecError> {
        if v.is_empty() {
            return Err(EmptyVecError);
        }
        Ok(Self(v))
    }

    pub fn first(&self) -> &T {
        &self.0[0] // Always safe — guaranteed non-empty
    }

    pub fn as_slice(&self) -> &[T] {
        &self.0
    }
}

struct CustomerId(String);

impl CustomerId {
    pub fn parse(raw: String) -> Result<Self, InvalidCustomerId> {
        if raw.is_empty() {
            return Err(InvalidCustomerId::Empty);
        }
        // Could add format checks, prefix checks, etc.
        Ok(Self(raw))
    }
}
```

Now the processing function:
```rust
fn process_order(items: NonEmptyVec<Item>, customer: CustomerId) -> Result<(), OrderError> {
    let first_item = items.first(); // No unwrap. Type guarantees it exists.
    // customer is guaranteed valid — no re-checking.
    // ...
}
```

The **caller** is responsible for parsing at the boundary. The processing function
receives already-valid types.

## Boundary Architecture

Parse at system boundaries. Use domain types internally.

```
┌─────────────────────────────────────────────────────────────┐
│ External World (raw data)                                   │
│   HTTP request body, CLI args, config file, DB rows, JSON   │
└──────────────────────────┬──────────────────────────────────┘
                           │ parse (can fail)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Boundary Layer                                              │
│   raw → domain type conversion                              │
│   String → EmailAddress, u64 → PositiveAmount, etc.         │
│   All validation errors surface HERE, not deeper            │
└──────────────────────────┬──────────────────────────────────┘
                           │ domain types (guaranteed valid)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Domain Logic                                                │
│   Works with EmailAddress, CustomerId, NonEmptyVec, etc.    │
│   No validation. No unwrap. No "should never happen."       │
└─────────────────────────────────────────────────────────────┘
```

## Real Boundary Examples

### HTTP handler boundary

```rust
// Raw request → domain types at the handler boundary
async fn create_user(Json(body): Json<CreateUserRequest>) -> Result<Json<User>, ApiError> {
    // Parse raw strings into domain types
    let email = EmailAddress::parse(body.email)?;
    let username = Username::parse(body.username)?;
    let age = Age::try_from(body.age)?;

    // Past this point: only domain types. No validation.
    let user = user_service.create(email, username, age).await?;
    Ok(Json(user))
}

// The service never sees raw strings
impl UserService {
    async fn create(&self, email: EmailAddress, username: Username, age: Age) -> Result<User, CreateUserError> {
        // email, username, age are all guaranteed valid
        // No re-checking. No "just in case" validation.
    }
}
```

### CLI argument boundary

```rust
// Parse CLI args into domain types immediately
fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse(); // clap

    let port = Port::try_from(args.port)?;
    let host = HostName::parse(&args.host)?;
    let config = Config::from_path(&args.config)?;

    // run() only sees validated types
    run(host, port, config)
}
```

### Config file boundary

```rust
// Raw config (from TOML/YAML/JSON)
#[derive(Deserialize)]
struct RawConfig {
    port: u16,
    host: String,
    max_connections: usize,
    log_level: String,
}

// Validated config (used throughout the app)
struct Config {
    port: Port,
    host: HostName,
    max_connections: NonZeroUsize,
    log_level: LogLevel,
}

impl Config {
    fn parse(raw: RawConfig) -> Result<Self, ConfigError> {
        Ok(Self {
            port: Port::try_from(raw.port)?,
            host: HostName::parse(&raw.host)?,
            max_connections: NonZeroUsize::try_from(raw.max_connections)
                .map_err(|_| ConfigError::ZeroConnections)?,
            log_level: raw.log_level.parse()?,
        })
    }
}
```

## Standard Library Parsers

std already follows this pattern:

| Raw type | Parsed type | What's guaranteed |
|----------|-------------|-------------------|
| `u32` | `NonZero<u32>` | Value is not zero |
| `String` | `IpAddr` | Valid IPv4 or IPv6 |
| `String` | `SocketAddr` | Valid IP + port |
| `String` | `PathBuf` | Valid OS path |
| `&str` | `http::Method` | Valid HTTP method |
| `&str` | `url::Url` | Valid URL with scheme, host, etc. |

## When Parsing Is Overkill

Not everything needs a newtype. Use bare types when:
- The value has no domain constraints (truly arbitrary text: user comments, notes)
- The value is internal and ephemeral (loop counter, temporary buffer)
- The overhead of a newtype harms readability more than it helps correctness

The test: "Would passing the wrong value here cause a bug that the compiler could
have caught?" If yes, parse into a domain type. If no, a bare type is fine.

## Common Mistakes

**Parsing then discarding.** Parsing into a type but then extracting the raw value
and passing that forward — you've lost the proof.

```rust
// WRONG — parses then immediately discards the parse result
let email = EmailAddress::parse(raw)?;
send_email(email.as_str()); // Back to &str — other code can't trust it

// RIGHT — pass the domain type through
let email = EmailAddress::parse(raw)?;
send_email(&email); // Callee receives proof of validity
```

**Validating in multiple places.** If you find yourself checking the same invariant
in multiple functions, you haven't parsed — you've scattered validation.

**"Parsing" that doesn't restrict.** A newtype with `pub fn new(s: String) -> Self`
(no validation) isn't parsing — it's just wrapping. The type doesn't guarantee
anything the bare type didn't. Either add invariants or don't bother with the newtype.
Exception: newtypes for type distinction (Miles vs Kilometers) don't need validation
because the invariant is "this is a distance in miles," not a data constraint.
