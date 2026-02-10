# Allocation and Data Structure Wins

Most Rust performance work is not “make LLVM smarter”. It is “allocate less, copy less, pick the right container, stop doing O(n²) work”.

## Preallocate when you can estimate size

**Incorrect (growth reallocations):**

```rust
let mut out = Vec::new();
for x in xs {
    out.push(f(x));
}
```

**Correct (one allocation):**

```rust
let mut out = Vec::with_capacity(xs.len());
for x in xs {
    out.push(f(x));
}
```

Also consider `String::with_capacity` for hot string building.

**Authority:** Rust Performance Book “Heap Allocations” (Vec/String growth).

## Prefer `extend` over “collect then append”

**Incorrect (extra allocation):**

```rust
let mut out = Vec::new();
let tmp: Vec<_> = iter.map(f).collect();
out.append(&mut tmp.clone());
```

**Correct (no intermediate Vec):**

```rust
let mut out = Vec::new();
out.extend(iter.map(f));
```

**Authority:** Rust Performance Book “Iterators” (`collect` and `extend`).

## Avoid hot `format!` when a buffer works

`format!` produces a new `String` (allocation). In hot paths, prefer writing into an existing buffer.

**Incorrect:**

```rust
let s = format!("user:{id}");
```

**Correct:**

```rust
use std::fmt::Write;

let mut s = String::with_capacity(32);
write!(&mut s, "user:{id}").unwrap();
```

Or avoid allocation entirely if a borrowed representation is acceptable.

**Authority:** Rust Performance Book “Heap Allocations” (`format!`).

## `clone_from` can reuse allocations

When overwriting an existing allocation (e.g. reusing a buffer), prefer `clone_from`.

```rust
let mut buf = String::with_capacity(1024);
let next = "small".to_owned();
buf.clone_from(&next); // reuses allocation when possible
```

**Authority:** Rust Performance Book “Heap Allocations” (`clone_from`).

## Use `HashMap::entry` and capacity

**Incorrect (double lookup):**

```rust
if !m.contains_key(&k) {
    m.insert(k, 0);
}
*m.get_mut(&k).unwrap() += 1;
```

**Correct (single lookup):**

```rust
*m.entry(k).or_insert(0) += 1;
```

Also: `HashMap::with_capacity(n)` when you can estimate size.

**Authority:** std `Entry` API; Rust Performance Book “Heap Allocations”.

## Faster hashers are a threat-model decision

If hashing is hot and HashDoS attacks are not a concern, switching to `rustc_hash`/`ahash` can produce real wins. Do not do this as a default in network-exposed code.

To enforce consistency, use Clippy’s `disallowed_types` in `clippy.toml`.

```toml
disallowed-types = ["std::collections::HashMap", "std::collections::HashSet"]
```

**Authority:** Rust Performance Book “Hashing” + “Linting”.

## Use asymptotically better ops in hot loops

- Use `Vec::swap_remove` instead of `Vec::remove` when order does not matter.
- Use `Vec::retain` for bulk deletion.
- Use `VecDeque` for queue semantics (push/pop at both ends).

**Authority:** Rust Performance Book “Standard Library Types”.
