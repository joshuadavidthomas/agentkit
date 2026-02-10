# Newtypes and Domain Types

Newtypes wrap a single inner type to create a distinct type with its own semantics.
They are zero-cost — the compiler erases the wrapper. Use them everywhere you have
a primitive with domain meaning.

## The Three Purposes

### 1. Type Distinction — Prevent Mixing

Different quantities with the same representation must not be interchangeable.

```rust
struct Miles(f64);
struct Kilometers(f64);

fn distance_remaining(total: Miles, traveled: Miles) -> Miles {
    Miles(total.0 - traveled.0)
}

// Compiler prevents: distance_remaining(miles, kilometers)
// The Mars Climate Orbiter crash was exactly this bug.
```

No validation needed — the invariant is identity ("this is miles"), not a data
constraint.

Provide explicit conversions:
```rust
impl From<Miles> for Kilometers {
    fn from(m: Miles) -> Self {
        Kilometers(m.0 * 1.60934)
    }
}
```

### 2. Invariant Enforcement — Parse at Construction

When the inner type has constraints, validate once at construction.

```rust
pub struct Port(u16);

impl Port {
    pub fn new(n: u16) -> Result<Self, PortError> {
        if n == 0 {
            return Err(PortError::Zero);
        }
        Ok(Self(n))
    }

    pub fn get(&self) -> u16 {
        self.0
    }
}
```

**Critical: keep the inner field private.** If callers can construct `Port(0)` directly,
your invariant is meaningless. Use module boundaries to enforce privacy:

```rust
// In a module or separate file
mod network {
    pub struct Port(u16);  // Field is private to this module

    impl Port {
        pub fn new(n: u16) -> Result<Self, PortError> { /* ... */ }
        pub fn get(&self) -> u16 { self.0 }
    }
}

// Outside the module:
// network::Port(0)  // ERROR: constructor is private
// network::Port::new(0)  // Ok — returns Err(PortError::Zero)
```

### 3. Encapsulation — Hide Representation

Newtypes hide the inner type so you can change it later without breaking callers.

```rust
// Today: backed by String
pub struct Username(String);

// Tomorrow: backed by CompactString, Arc<str>, or SmolStr
// All callers still work — they never saw the String.
```

The std library does this extensively:
- `PathBuf` wraps `OsString` — representation is OS-dependent
- `String` wraps `Vec<u8>` — guarantees valid UTF-8
- Return type wrappers like `std::iter::Map` — hide iterator chain internals

## Implementation Patterns

### Derive what makes sense

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(i64);
```

Don't derive traits that violate your semantics:
- `Ord` on `EmailAddress`? Probably not meaningful.
- `Default` on `Port`? Only if zero/empty is valid.
- `Copy` on large newtypes? Avoid — prefer explicit cloning.

### Implement standard traits for interop

```rust
impl fmt::Display for EmailAddress {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl AsRef<str> for EmailAddress {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

// For deserialization boundaries
impl FromStr for EmailAddress {
    type Err = EmailError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s.to_owned())
    }
}
```

### Serde integration

```rust
use serde::{Deserialize, Serialize};

// Simple: serialize as the inner type
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(i64);

// With validation on deserialization
impl<'de> Deserialize<'de> for Port {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let n = u16::deserialize(d)?;
        Port::new(n).map_err(serde::de::Error::custom)
    }
}
```

`#[serde(transparent)]` serializes/deserializes as the inner type. Use it for simple
wrappers. Implement custom `Deserialize` when you need validation on the way in.

### Reduce boilerplate with derive_more

```rust
use derive_more::{Display, From, Into, AsRef, Deref};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Display, AsRef, Deref)]
pub struct Username(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, From, Into)]
pub struct UserId(i64);
```

`derive_more` eliminates the pass-through method boilerplate that is the main
ergonomic cost of newtypes.

## Standard Library Evidence

The std library is full of newtypes. These are not obscure patterns — they are
fundamental Rust design:

| Newtype | Wraps | Purpose |
|---------|-------|---------|
| `String` | `Vec<u8>` | Guarantees UTF-8 validity |
| `PathBuf` | `OsString` | OS-specific path handling |
| `NonZero<u32>` | `u32` | Guarantees non-zero value |
| `Wrapping<T>` | `T` | Changes overflow semantics |
| `Saturating<T>` | `T` | Changes overflow semantics |
| `Pin<P>` | `P` | Prevents moving the pointee |
| `ManuallyDrop<T>` | `T` | Prevents automatic drop |

## When NOT to Newtype

- **Truly arbitrary text** with no domain constraints: user comments, log messages,
  notes. A newtype adds indirection with no safety benefit.
- **Internal temporaries** that never cross function boundaries.
- **Types already carrying their semantics**: `Duration` doesn't need a
  `Timeout(Duration)` wrapper unless you have multiple duration-typed fields that
  could be confused.

The test: "Can passing the wrong value cause a bug the compiler could catch?"
If yes → newtype. If no → bare type is fine.
