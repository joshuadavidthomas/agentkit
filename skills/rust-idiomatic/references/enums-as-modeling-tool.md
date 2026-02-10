# Enums as the Primary Modeling Tool

Rust enums are algebraic sum types — they represent "exactly one of these variants."
They carry per-variant data, enable exhaustive matching, and make invalid states
unrepresentable. They are the **first tool** to reach for when modeling a domain.

## The Anti-Pattern: Structs with Kind Fields

```rust
// WRONG — invalid states are representable
struct Event {
    kind: EventKind,
    // Only valid for Click
    x: Option<f64>,
    y: Option<f64>,
    // Only valid for KeyPress
    key: Option<KeyCode>,
    modifiers: Option<Modifiers>,
    // Only valid for Resize
    width: Option<u32>,
    height: Option<u32>,
}

enum EventKind { Click, KeyPress, Resize }

// What's event.key when kind is Click? None? What if someone sets it?
// What's event.x when kind is Resize? The type allows it.
```

```rust
// RIGHT — each variant carries exactly the data it needs
enum Event {
    Click { x: f64, y: f64 },
    KeyPress { key: KeyCode, modifiers: Modifiers },
    Resize { width: u32, height: u32 },
}

// No Option fields. No invalid combinations. Pattern matching handles each case.
match event {
    Event::Click { x, y } => handle_click(x, y),
    Event::KeyPress { key, modifiers } => handle_key(key, modifiers),
    Event::Resize { width, height } => handle_resize(width, height),
}
```

**The smell:** A struct with a "kind" or "type" field plus `Option` fields that are
"only valid when kind is X" — this is always an enum waiting to be written.

## State Machines

Enums naturally represent state machines where different states have different data.

```rust
enum Order {
    Draft { items: Vec<Item> },
    Submitted { items: Vec<Item>, submitted_at: DateTime<Utc> },
    Paid { items: Vec<Item>, submitted_at: DateTime<Utc>, payment: Payment },
    Shipped { tracking: TrackingNumber, shipped_at: DateTime<Utc> },
    Delivered { tracking: TrackingNumber, delivered_at: DateTime<Utc> },
    Cancelled { reason: String, cancelled_at: DateTime<Utc> },
}
```

Just from the type, you know:
- A `Draft` has no timestamp (it hasn't been submitted)
- A `Paid` order always has payment info
- A `Shipped` order always has tracking
- You can't access `tracking` on a `Draft` — it doesn't exist

```rust
impl Order {
    fn ship(self, tracking: TrackingNumber) -> Result<Order, OrderError> {
        match self {
            Order::Paid { items, submitted_at, payment } => {
                Ok(Order::Shipped {
                    tracking,
                    shipped_at: Utc::now(),
                })
            }
            other => Err(OrderError::InvalidTransition {
                from: other.status_name(),
                to: "Shipped",
            }),
        }
    }
}
```

Transition functions consume the current state and produce the next. The compiler
prevents calling `ship` on an already-shipped order without handling the error.

For more complex state machines where you want compile-time transition enforcement
(not just runtime), see the typestate pattern in **rust-type-design**.

## Enum vs Trait Object Decision

| Question | Enum | Trait Object |
|----------|------|-------------|
| Do you know all variants at compile time? | ✅ | — |
| Do variants carry different data shapes? | ✅ | ❌ (common interface only) |
| Need exhaustive matching? | ✅ | ❌ |
| Need to add variants without recompilation? | ❌ | ✅ |
| Need heterogeneous collections of unknown types? | ❌ | ✅ |
| Dispatch overhead matters? | ✅ (zero-cost) | ❌ (vtable indirection) |

**Default to enum.** Switch to trait object when:
- The set is genuinely open (plugin system, user-defined types)
- Different crates need to add variants independently
- You're building a library and users must extend it

### The Hybrid Pattern

Sometimes you have a mostly-closed set with an escape hatch:

```rust
enum LogOutput {
    Stdout,
    Stderr,
    File(PathBuf),
    Custom(Box<dyn Write + Send>), // Escape hatch for unusual cases
}
```

This gives you exhaustive matching for the common cases and a trait object for
extensibility. Use sparingly — if the `Custom` variant dominates, switch to a
trait-based design.

## Enum Methods and Shared Behavior

Don't scatter match arms across the codebase. Implement methods on the enum:

```rust
impl Shape {
    fn area(&self) -> f64 {
        match self {
            Shape::Circle { radius } => std::f64::consts::PI * radius * radius,
            Shape::Rectangle { width, height } => width * height,
            Shape::Triangle { base, height } => 0.5 * base * height,
        }
    }

    fn perimeter(&self) -> f64 {
        match self {
            Shape::Circle { radius } => 2.0 * std::f64::consts::PI * radius,
            Shape::Rectangle { width, height } => 2.0 * (width + height),
            Shape::Triangle { .. } => todo!("need side lengths"),
        }
    }
}
```

For computed properties shared across all variants, use helper methods:

```rust
enum Message {
    Text { content: String, sender: UserId },
    Image { url: Url, sender: UserId },
    System { content: String },
}

impl Message {
    fn sender(&self) -> Option<UserId> {
        match self {
            Message::Text { sender, .. } | Message::Image { sender, .. } => Some(*sender),
            Message::System { .. } => None,
        }
    }
}
```

## Standard Library Evidence

Enums are not a niche pattern — they are foundational in std:

| Enum | Purpose |
|------|---------|
| `Option<T>` | Presence or absence |
| `Result<T, E>` | Success or failure |
| `Cow<'a, B>` | Borrowed or owned |
| `IpAddr` | IPv4 or IPv6 |
| `SocketAddr` | V4 or V6 socket |
| `Ordering` | Less, Equal, Greater |
| `Bound<T>` | Range bound types |
| `Entry<K, V>` | Occupied or Vacant map entry |

Every one of these could have been modeled as a struct with flags and `Option` fields.
None of them were. That's the idiom.

## #[non_exhaustive] for Library Enums

If you're writing a library and your enum might gain variants, mark it
`#[non_exhaustive]`:

```rust
#[non_exhaustive]
pub enum DatabaseError {
    ConnectionFailed,
    QueryFailed,
    Timeout,
}
```

This forces downstream crates to include a `_ =>` arm — the one case where wildcard
matching is required. Use deliberately: it makes the API less ergonomic. Prefer
semver-major bumps when practical.
