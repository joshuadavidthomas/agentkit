# Function Signature Patterns

## Accept borrowed forms — the general rule

Every owned type has a borrowed counterpart that's more flexible. Accept the borrowed
form unless you need ownership.

| Owned form | Borrowed form | Deref coercion from |
|-----------|--------------|---------------------|
| `String` | `&str` | `String`, `&str`, `Box<str>`, `Cow<str>`, `Rc<String>`, `Arc<String>` |
| `Vec<T>` | `&[T]` | `Vec<T>`, `[T; N]`, `Box<[T]>` |
| `PathBuf` | `&Path` | `PathBuf`, `&Path`, `OsString` (via `AsRef<Path>`) |
| `OsString` | `&OsStr` | `OsString`, `&OsStr`, `String`, `&str` |
| `CString` | `&CStr` | `CString`, `&CStr` |

**Why this matters:** A function accepting `&str` works for callers holding `String`,
`&str`, or string literals — zero allocation, zero conversion. A function accepting
`&String` forces callers with `&str` to allocate a `String` first.

**Authority:** Rust API Guidelines [C-CALLER-CONTROL]. clippy: `ptr_arg`.

## `impl AsRef<T>` — generic borrows

When your function needs to work with multiple types that can provide a reference
to `T`, use `AsRef<T>`:

```rust
use std::path::Path;

fn read_config(path: impl AsRef<Path>) -> std::io::Result<String> {
    std::fs::read_to_string(path.as_ref())
}

// All of these work:
read_config("config.toml");                    // &str
read_config(Path::new("config.toml"));         // &Path
read_config(PathBuf::from("config.toml"));     // PathBuf
read_config(String::from("config.toml"));      // String
```

Common `AsRef` bounds:
- `AsRef<Path>` — filesystem operations
- `AsRef<str>` — string operations
- `AsRef<[u8]>` — byte operations
- `AsRef<OsStr>` — OS string operations

**Don't use `AsRef` when a simple `&T` works.** If your function only ever gets
one type, `&str` is simpler than `impl AsRef<str>`.

**Authority:** std: `fs::read_to_string(path: impl AsRef<Path>)`.

## `impl Into<T>` — flexible ownership transfer

When a function needs to **own** the value, `Into<T>` lets callers pass either the
target type or anything convertible to it.

```rust
struct Config {
    name: String,
    path: PathBuf,
}

impl Config {
    fn new(name: impl Into<String>, path: impl Into<PathBuf>) -> Self {
        Self {
            name: name.into(),
            path: path.into(),
        }
    }
}

// Callers don't need explicit conversion
let c1 = Config::new("my-app", "/etc/my-app");       // &str → String, &str → PathBuf
let c2 = Config::new(app_name, config_path);          // String → String, PathBuf → PathBuf
```

**Use `Into<T>` when:**
- The function stores the value (struct fields, collections)
- Callers commonly have `&str` when you need `String`
- You want ergonomic constructors

**Don't use `Into<T>` when:**
- You only need to read the data — use `&str` / `&[T]` / `AsRef`
- The conversion could fail — use `TryInto<T>` or a `parse`/`new` method
- There's only one reasonable input type — just take that type directly

## `Cow<'a, T>` — conditional ownership

`Cow` (Clone on Write) borrows when possible, owns when necessary. Use it when a
function sometimes returns a reference to its input and sometimes creates a new value.

```rust
use std::borrow::Cow;

fn escape_html(input: &str) -> Cow<'_, str> {
    if input.contains('&') || input.contains('<') || input.contains('>') {
        // Must allocate to hold the escaped version
        Cow::Owned(
            input
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        )
    } else {
        // No escaping needed — borrow the original
        Cow::Borrowed(input)
    }
}

// Caller doesn't care whether it's borrowed or owned
let output = escape_html("hello");          // Cow::Borrowed — zero alloc
let output = escape_html("a < b");          // Cow::Owned — one alloc
println!("{}", output);                      // Deref to &str either way
```

### When to use Cow

- **String processing** that usually passes input through unchanged
- **Normalization** functions (trim, lowercase) where most inputs are already normal
- **Configuration** that has defaults (borrowed) overridden by user values (owned)
- **Deserialization** with zero-copy for common cases

### When NOT to use Cow

- The function always modifies input → just return `String`
- The function never modifies input → just return `&str`
- The complexity cost of `Cow` outweighs the allocation savings

### Cow in structs

```rust
use std::borrow::Cow;

struct LogEntry<'a> {
    message: Cow<'a, str>,
    level: LogLevel,
}

impl<'a> LogEntry<'a> {
    // Can hold borrowed OR owned strings
    fn new(message: impl Into<Cow<'a, str>>, level: LogLevel) -> Self {
        Self { message: message.into(), level }
    }

    // Convert to fully owned version (e.g., for sending to another thread)
    fn into_owned(self) -> LogEntry<'static> {
        LogEntry {
            message: Cow::Owned(self.message.into_owned()),
            level: self.level,
        }
    }
}
```

## Conversion naming conventions

Function names signal ownership transfer. Follow std conventions:

| Prefix | Signature pattern | Cost | Examples |
|--------|------------------|------|---------|
| `as_` | `&self → &T` | Free | `str::as_bytes`, `Option::as_ref` |
| `to_` | `&self → T` | Expensive (allocates or computes) | `str::to_string`, `str::to_lowercase` |
| `into_` | `self → T` | Consumes, may be free | `String::into_bytes`, `Vec::into_boxed_slice` |

```rust
impl MyType {
    fn as_str(&self) -> &str { &self.inner }              // Free borrow
    fn to_string(&self) -> String { self.inner.clone() }  // Allocates
    fn into_inner(self) -> String { self.inner }          // Consumes, free
}
```

**Authority:** Rust API Guidelines [C-CONV].

## Pattern: splitting borrows

When the borrow checker complains about borrowing two parts of the same struct,
split the borrow by accessing fields directly:

```rust
struct State {
    items: Vec<Item>,
    log: Vec<String>,
}

// WRONG — borrows all of State twice
fn process(state: &mut State) {
    for item in &state.items {
        state.log.push(format!("processed {}", item.name));  // E0502
    }
}

// RIGHT — borrow fields independently
fn process(state: &mut State) {
    let State { items, log } = state;
    for item in items.iter() {
        log.push(format!("processed {}", item.name));  // OK: disjoint borrows
    }
}
```

This works because the compiler can see that `items` and `log` don't overlap.
Destructuring makes this visible.

## Pattern: bind temporaries to extend their lifetime

Temporaries live only for the statement that creates them (unless directly bound
in a `let`). When you need the borrowed data to outlive the statement, bind the
temporary to a variable first.

```rust
// WRONG — temporary String is dropped after push; vec holds a dangling borrow
let mut refs: Vec<&str> = Vec::new();
refs.push(&String::from("hello"));  // E0716: temporary value dropped while borrowed

// RIGHT — bind the temporary, borrow from the binding
let owned = String::from("hello");
let mut refs: Vec<&str> = Vec::new();
refs.push(&owned);  // owned lives as long as refs — no issue
```

The binding extends the value's lifetime to the enclosing scope.

**Authority:** Rust API Guidelines [C-CALLER-CONTROL], [C-CONV].
Effective Rust Items 14-15. The Rust Book ch 4.
