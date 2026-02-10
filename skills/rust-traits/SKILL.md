---
name: rust-traits
description: "Use when designing trait hierarchies, choosing between generics/trait objects/enums for polymorphism, hitting object safety errors, E0277 (trait bound not satisfied), E0038 (not object-safe), orphan rule violations, or deciding which standard traits to implement. Covers static vs dynamic dispatch, sealed/extension/marker traits, associated types vs generics, and common trait design mistakes."
---

# Trait Design and Dispatch

Traits define shared behavior. The agent's job is choosing the **right dispatch
mechanism** — enum, generic, or trait object — and designing traits that are
object-safe when they need to be, sealed when they should be, and minimal always.

The core failure mode: defaulting to `dyn Trait` for everything. This is an
interface-oriented habit from Java/C#/TypeScript. In Rust, enums are cheaper
and generics are faster. Trait objects are the *last* tool, not the first.

## The Central Decision: How to Dispatch

Every time you need polymorphism, ask three questions in order:

```
1. Is the set of variants known at compile time?
   ├─ Yes → Use an enum. Stop here.
   └─ No (or "users add variants") → Continue.

2. Can the concrete type be known at each call site?
   ├─ Yes → Use generics (static dispatch).
   └─ No (heterogeneous collection, plugin, type erasure) → Continue.

3. You need dynamic dispatch → Use dyn Trait (trait object).
```

| Mechanism | Dispatch | Allocation | Exhaustive match | Use when |
|-----------|----------|------------|-----------------|----------|
| `enum` | None (direct) | Stack | Yes | Closed set, per-variant data, state machines |
| `impl Trait` / `<T: Trait>` | Static (monomorphized) | None | N/A | Open set, max performance, known at call site |
| `dyn Trait` | Dynamic (vtable) | Heap (usually) | No | Heterogeneous collections, plugins, type erasure |

### Enum: the default for closed sets

If you can list every variant, use an enum. Enums give you exhaustive matching,
per-variant data, zero allocation, and no vtable overhead. See **rust-idiomatic**
Rules 7-8 for modeling guidance.

```rust
// AST nodes, config formats, HTTP methods, command types → enum
enum Expr {
    Literal(i64),
    BinOp { op: Op, lhs: Box<Expr>, rhs: Box<Expr> },
    UnaryOp { op: Op, operand: Box<Expr> },
}
```

### Generics: the default for open sets

When the set is open but the concrete type is known at each call site, use generics.
The compiler monomorphizes — one copy per concrete type, fully inlined, zero runtime
cost.

```rust
fn serialize<S: Serializer>(value: &MyType, serializer: S) -> Result<S::Ok, S::Error> {
    // Compiler generates a version for JsonSerializer, BincodeSerializer, etc.
    todo!()
}
```

**Use `impl Trait` in argument position** as shorthand when you don't need to name
the type parameter:

```rust
fn process(reader: impl Read) -> io::Result<Vec<u8>> { todo!() }
// Equivalent to: fn process<R: Read>(reader: R) -> io::Result<Vec<u8>>
```

**Use `impl Trait` in return position** to return an unnamed concrete type:

```rust
fn make_iter(v: &[i32]) -> impl Iterator<Item = &i32> {
    v.iter().filter(|&&x| x > 0)
}
// Caller can't name the type, but it's still static dispatch.
```

### Trait objects: when you must erase the type

Use `dyn Trait` only when you need a heterogeneous collection, a plugin interface,
or deliberate type erasure for API simplicity.

```rust
// Plugin system — users add backends at runtime
fn create_cache(backend: Box<dyn Storage>) -> Cache { todo!() }

// Heterogeneous collection — different concrete types in one Vec
let handlers: Vec<Box<dyn Handler>> = vec![
    Box::new(LogHandler),
    Box::new(AuthHandler),
    Box::new(MetricsHandler),
];
```

**Cost of trait objects:** vtable indirection on every method call, heap allocation
(usually `Box`), no inlining, no monomorphization. This matters in hot paths.

For the full dispatch reference (monomorphization trade-offs, `impl Trait` edge
cases, `dyn Trait` with lifetimes, performance comparison), see
[references/dispatch-patterns.md](references/dispatch-patterns.md).

## Object Safety Quick Reference

A trait is object-safe (dyn-compatible) when it can be used as `dyn Trait`. If the
compiler rejects `dyn YourTrait`, one of these rules is violated.

### Object safety rules

A trait is object-safe if **all** of these hold:

1. **No `Self: Sized` supertrait.** `trait Foo: Sized` prevents `dyn Foo`.
2. **No associated constants** (stable Rust).
3. **Every method is dispatchable** — meaning all of:
   - Receiver is `&self`, `&mut self`, `Box<Self>`, `Rc<Self>`, `Arc<Self>`, or `Pin<&Self>`.
   - No generic type parameters on the method.
   - Return type does not use `Self` (except behind indirection: `Box<Self>` is fine).
   - No `where Self: Sized` bound (which opts the method *out* of dispatch — see below).

### Opt out individual methods with `Self: Sized`

Methods that violate object safety can be excluded from the vtable. The trait stays
object-safe, but those methods are unavailable on `dyn Trait`.

```rust
trait Cloneable {
    fn clone_box(&self) -> Box<dyn Cloneable>;

    // This method breaks object safety (returns Self),
    // but the Self: Sized bound opts it out.
    fn into_inner(self) -> Self
    where
        Self: Sized;
}
// dyn Cloneable works — into_inner just isn't callable on it.
```

**Authority:** std uses this pattern extensively: `Iterator::collect`, `Iterator::zip`,
and 50+ other methods have `where Self: Sized` to keep `dyn Iterator` usable.

### Common object safety errors

| Error | Cause | Fix |
|-------|-------|-----|
| E0038: "the trait cannot be made into an object" | Generic method, `Self` in return, associated const | Add `where Self: Sized` to the offending method, or redesign |
| "method has generic type parameters" | `fn foo<T>(&self, t: T)` | Take `&dyn OtherTrait` instead, or add `Self: Sized` |
| "method references the `Self` type in its return type" | `fn clone(&self) -> Self` | Return `Box<Self>` or add `Self: Sized` |

## Associated Types vs Generic Parameters

This is the most confused trait design decision. The rule is simple:

**Associated type** — one implementation per type. The type is *determined by* the
implementor.

```rust
trait Iterator {
    type Item;  // Each iterator has exactly ONE Item type.
    fn next(&mut self) -> Option<Self::Item>;
}
// Vec<i32>::IntoIter always yields i32. No choice.
```

**Generic parameter** — multiple implementations per type. The type is *chosen by*
the caller or the impl.

```rust
trait Add<Rhs = Self> {
    type Output;
    fn add(self, rhs: Rhs) -> Self::Output;
}
// Point can impl Add<Point> AND Add<Vector> — different Rhs types.
```

**Decision rule:** If asking "can this type implement this trait in more than one
way?", the answer determines the design. One way → associated type. Multiple ways
→ generic parameter.

**Authority:** Rust API Guidelines [C-OBJECT]. std: `Iterator` (associated),
`Add`/`Mul`/`From` (generic), `AsRef` (generic — one type can AsRef many targets).

## Trait Design Rules

### Rule 1: Minimize required methods

Define the smallest set of methods that implementors *must* provide. Everything else
gets a default implementation built on those primitives.

```rust
trait Summary {
    // REQUIRED — implementor must provide
    fn core_text(&self) -> &str;

    // DEFAULT — free for implementors, overridable
    fn summarize(&self) -> String {
        format!("{}...", &self.core_text()[..100.min(self.core_text().len())])
    }
}
```

**Authority:** std: `Iterator` requires only `next()`, provides 70+ default methods.
Rust API Guidelines [C-OBJECT] ("traits that can be used as trait objects… should have a
small number of methods").

### Rule 2: Implement standard traits eagerly

Every type should derive or implement the standard traits that apply. Missing traits
frustrate downstream users who can't print, compare, hash, or collect your types.

**Minimum for most types:** `Debug`, `Clone`, `PartialEq`, `Eq`

| Also implement | When |
|---------------|------|
| `Hash` | Type implements `Eq` (enables `HashMap`/`HashSet` keys) |
| `Copy` | Type is small, stack-only, and bitwise-copyable |
| `Default` | A sensible zero/empty value exists |
| `Display` | Type is user-facing |
| `Ord` + `PartialOrd` | Ordering is meaningful |
| `Send` + `Sync` | Automatic unless you use `Rc`, raw pointers, etc. |
| `From`/`TryFrom` | Natural conversions exist |
| `FromIterator` | Type is a collection |

**Consistency rules:**
- `Eq` implies `Hash` must agree: if `a == b` then `hash(a) == hash(b)`.
- `Ord` implies `PartialOrd`, `Eq`, `PartialEq` — derive all four together.
- `Copy` implies `Clone` — derive both. Only for types where implicit copying is cheap.
- Implement `From<T>`, never `Into<T>` — the blanket impl gives you `Into` for free.
- Implement `TryFrom<T>`, never `TryInto<T>` — same reason.

**Authority:** Rust API Guidelines [C-COMMON-TRAITS]. Effective Rust Item 10.

For the full standard traits reference (conversion hierarchy, when to derive vs
implement manually, `Deref` rules), see
[references/standard-traits.md](references/standard-traits.md).

### Rule 3: Respect the orphan rule

You can only implement a trait if you own the trait **or** you own the type. You
cannot implement a foreign trait for a foreign type.

```rust
// ✅ You own the trait
trait MyTrait {}
impl MyTrait for Vec<i32> {}

// ✅ You own the type
struct MyType;
impl Display for MyType { /* ... */ todo!() }

// ❌ Both foreign — orphan violation
impl Display for Vec<i32> { /* ... */ } // ERROR
```

**Workaround:** Wrap the foreign type in a newtype (see **rust-idiomatic** Rule 1,
**rust-type-design** Pattern 1):

```rust
struct PrettyVec(Vec<i32>);
impl Display for PrettyVec { /* ... */ todo!() }
```

### Rule 4: Use supertraits to compose requirements

When a trait requires behavior from another trait, declare it as a supertrait bound.

```rust
trait Drawable: Clone + Debug {
    fn draw(&self);
}
// Every Drawable must also be Clone + Debug.
// Implementors must satisfy all three.
```

Don't over-constrain. Add supertrait bounds only when the trait's *own methods*
or *own invariants* require them. If only some callers need `Clone`, put the bound
on those functions, not on the trait.

### Rule 5: Prefer `&self` receivers in trait methods

Traits with `self` (by value) receivers consume the implementor. This prevents trait
objects (unless boxed) and limits flexibility. Use `&self` or `&mut self` unless the
method genuinely consumes the value.

```rust
// WRONG — consumes self, prevents reuse and trait objects
trait Transform {
    fn apply(self) -> Output;
}

// RIGHT — borrows, works everywhere including dyn Trait
trait Transform {
    fn apply(&self) -> Output;
}
```

**Exception:** Conversion methods (`into_*`) and typestate transitions correctly
consume `self`. See **rust-type-design** Pattern 2.

## Error → Design Question

When you hit a trait-related compiler error, ask what the error is telling you about
your design.

| Error | Compiler Says | Ask Instead |
|-------|--------------|-------------|
| E0277 | trait bound not satisfied | Does this type actually need this capability? Should you add a bound or change the type? |
| E0038 | trait cannot be made into an object | Do you actually need `dyn Trait`? Often an enum or generic is better. If you do, fix the object safety violation. |
| E0119 | conflicting implementations | Is one impl too broad? Use more specific bounds or the newtype pattern. |
| E0210 | orphan rule violation | Wrap the foreign type in a newtype. |
| E0658 | unstable feature (GATs, etc.) | Check your edition and Rust version. GATs are stable since 1.65. |

## Pattern Catalog

These patterns appear frequently in well-designed Rust code. Each solves a specific
design problem.

### Sealed trait — prevent external implementations

Use when you need exhaustive dispatch over trait implementors (similar to enum) but
want the ergonomics of trait methods.

```rust
mod private {
    pub trait Sealed {}
}

pub trait State: private::Sealed {
    fn name(&self) -> &'static str;
}

pub struct Active;
pub struct Inactive;

impl private::Sealed for Active {}
impl private::Sealed for Inactive {}

impl State for Active { fn name(&self) -> &'static str { "active" } }
impl State for Inactive { fn name(&self) -> &'static str { "inactive" } }
```

**Authority:** Rust API Guidelines [C-SEALED]. std sealing patterns.

### Extension trait — add methods to foreign types

Use when you need methods on types you don't own, without the newtype cost.

```rust
pub trait StrExt {
    fn truncate_ellipsis(&self, max: usize) -> String;
}

impl StrExt for str {
    fn truncate_ellipsis(&self, max: usize) -> String {
        if self.len() <= max { self.to_string() }
        else { format!("{}…", &self[..max]) }
    }
}
```

Convention: name the trait `{Type}Ext` and put it in a prelude or re-export it.

### Marker trait — compile-time capability tags

Traits with no methods that signal a property. The compiler uses them for safety
guarantees.

```rust
// std examples
trait Send {}   // Safe to transfer between threads
trait Sync {}   // Safe to share references between threads
trait Copy {}   // Bitwise copy is valid
trait Eq {}     // Reflexive equality (x == x)
trait Sized {}  // Size known at compile time
```

Define your own when you need to tag types with a capability:

```rust
trait Validated {}  // Marks types that have passed validation

fn store<T: Validated>(data: T) { /* ... */ todo!() }
```

### Blanket implementation — implement for all qualifying types

Use to provide automatic behavior for all types meeting a bound.

```rust
impl<T: Display> Loggable for T {
    fn log(&self) {
        println!("[LOG] {}", self);
    }
}
// Every Display type is now Loggable for free.
```

**Caution:** Blanket impls are powerful but limit what other impls can exist (due to
coherence). Use them deliberately.

For the full pattern catalog (GATs, supertraits with defaults, newtype delegation,
trait aliases, conditional impls, closure-based strategies), see
[references/trait-patterns.md](references/trait-patterns.md).

## Common Mistakes (Agent Failure Modes)

- **`dyn Trait` as the default** → Use enum for closed sets, generics for open sets.
  Trait objects are the last resort, not the first.
- **Generic parameter where associated type belongs** → If there's exactly one
  implementation per type, use an associated type.
- **Missing standard trait impls** → Every type should derive `Debug`, `Clone`,
  `PartialEq`, `Eq` at minimum. Missing `Hash` when you have `Eq` breaks `HashMap`.
- **`impl Into<T>` instead of `impl From<T>`** → Implement `From`; the blanket impl
  gives you `Into` for free.
- **`Deref` for field access (fake inheritance)** → `Deref` is for smart pointers only.
  Use `AsRef` or explicit delegation for composition.
- **Over-constrained trait bounds** → Don't add bounds the function doesn't use.
  `T: Clone + Debug + Send + Sync + 'static` when you only call one method is noise
  that restricts callers.
- **Forgetting `Self: Sized` escape hatch** → When one method breaks object safety
  but you still need `dyn Trait`, add `where Self: Sized` to that method.
- **Orphan rule workaround with `impl<T> MyTrait for T`** → Blanket impls can
  conflict with specific impls. Consider newtype or more specific bounds.
- **`Hash` disagrees with `Eq`** → If you implement `Eq` manually, implement `Hash`
  manually too. They must agree: `a == b` implies `hash(a) == hash(b)`.
- **Returning `impl Trait` from trait methods** → Not yet stable for all patterns.
  Use associated types or `Box<dyn Trait>` in trait definitions.

## Review Checklist

1. **Enum or trait?** If the set of variants is known, use an enum. Don't reach for
   `dyn Trait` when you can list every type.

2. **Generic or trait object?** Use generics when the concrete type is known at the
   call site. Use `dyn Trait` only for heterogeneous collections, plugins, or type
   erasure.

3. **Associated type or generic parameter?** One impl per type → associated type.
   Multiple impls per type → generic parameter.

4. **Is the trait object-safe?** If you need `dyn Trait`, check: no generic methods,
   no `Self` in return position (except `Box<Self>`), no `Self: Sized` supertrait.

5. **Are standard traits implemented?** At minimum: `Debug`, `Clone`, `PartialEq`,
   `Eq`. Add `Hash` if `Eq` is present. Add `Default` if a zero value exists.

6. **Does `Hash` agree with `Eq`?** If either is manually implemented, both must be.
   `a == b` must imply `hash(a) == hash(b)`.

7. **Are trait bounds minimal?** Every bound on a generic restricts callers. Only
   require bounds the function actually uses.

8. **Are `From` impls used instead of `Into`?** Implement `From<T>` — never
   implement `Into<T>` directly.

9. **Is `Deref` used only for smart pointers?** `Deref` on a newtype for field access
   is an anti-pattern. Use `AsRef` or explicit methods.

10. **Should the trait be sealed?** If external implementations would break invariants
    or you need exhaustive dispatch, seal it.

## Cross-References

- **rust-idiomatic** — Rules 7-8 (enums for closed sets, trait objects for open sets)
- **rust-type-design** — Sealed traits, typestate bounds, phantom types
- **rust-ownership** — Trait object lifetimes (`Box<dyn Trait + 'a>`), `Send`/`Sync` bounds
- **rust-error-handling** — `Error` trait, `From` impls, `Box<dyn Error>` erasure
- **rust-async** — `Send`/`Sync` bounds on futures, trait objects in async contexts
