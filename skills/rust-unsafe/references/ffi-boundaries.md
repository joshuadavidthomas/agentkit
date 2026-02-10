# FFI Boundaries: Make the Contract Explicit

FFI is an unsafe boundary because Rust’s type system and aliasing rules do not extend across it. Treat the boundary as hostile: convert to a C-stable representation at the edge, uphold invariants internally, and never let C “see” Rust-only types.

Authorities: Rustonomicon (FFI chapter), Rust Reference (ABI, unwinding, UB), bindgen and cbindgen documentation.

## 1) Rule zero: decide who owns memory (and write it down)

Before you write any `extern "C"` block, answer:

- Who allocates this buffer / string / struct?
- Who frees it?
- With which allocator?
- What is the lifetime rule (call-scoped borrow vs retained pointer)?

If you cannot answer these, do not write the FFI yet.

## 2) Do not expose Rust types in a C ABI

Do not put these in `extern "C"` signatures:

- `String`, `&str`
- `Vec<T>`, slices, or `&[T]` (unless you explicitly model as pointer + length)
- `bool` (C’s `_Bool` is not Rust’s `bool` representation contract)
- `Result`, enums without `#[repr(C)]` (and even then, be cautious)

Prefer C-stable primitives:

- integers from `core::ffi` (e.g. `c_int`, `c_char`)
- `*const T` / `*mut T` where `T` is `#[repr(C)]` or opaque
- `(ptr, len)` pairs for buffers

Pattern (explicit buffer contract):

```rust
use core::ffi::c_uchar;
use core::slice;

#[no_mangle]
pub extern "C" fn sum_bytes(ptr: *const c_uchar, len: usize) -> u64 {
    if ptr.is_null() {
        return 0;
    }

    // SAFETY: caller provided a non-null pointer to `len` readable bytes.
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    bytes.iter().map(|b| *b as u64).sum()
}
```

## 3) Treat null pointers as an input case, not “impossible”

C can pass null. Make null handling explicit at the boundary:

- Return an error code
- Return a null/zero sentinel
- Or accept `Option<NonNull<T>>` internally after you check

Do not convert `*const T` to `&T` before checking null and alignment.

## 4) Strings: use CStr/CString and define encoding

Use `CStr` for borrowed inputs and `CString` for owned outputs. Define the encoding (almost always UTF-8, validated at the boundary).

```rust
use core::ffi::{c_char, CStr};

#[no_mangle]
pub extern "C" fn name_len(name: *const c_char) -> usize {
    if name.is_null() {
        return 0;
    }

    // SAFETY: `name` is non-null and points to a NUL-terminated string.
    let cstr = unsafe { CStr::from_ptr(name) };

    match cstr.to_str() {
        Ok(s) => s.len(),
        Err(_) => 0,
    }
}
```

If you return strings to C, also provide a `*_free` function that deallocates using Rust’s allocator.

## 5) Panics and unwinding: do not let them cross the boundary

Unwinding across an FFI boundary is undefined behavior unless both sides agree on an unwind-capable ABI and you use it correctly (Rust Reference).

Defaults:

- Wrap `extern "C"` entrypoints that can panic in `std::panic::catch_unwind`.
- Convert panics into an error code (or abort) and document the behavior.

If you need C to call back into Rust and you cannot avoid panics, use an unwind-capable ABI (`"C-unwind"`) intentionally and document it, but prefer “no unwind” APIs.

## 6) Layout rules: `#[repr(C)]` is necessary, not sufficient

- Use `#[repr(C)]` on any struct you pass by value or behind a pointer where C understands the layout.
- Keep FFI structs simple: integers, floats, pointers, and other `#[repr(C)]` structs.
- Do not assume Rust `enum` layout is stable; prefer tagged integer + payload patterns you control.
- Do not take references to `#[repr(packed)]` fields; use raw pointers and unaligned reads.

Use `#[repr(transparent)]` for newtypes that must be ABI-compatible with their inner type.

## 7) Constrain unsafe to a boundary module

Create a single `ffi` module/crate that:

- contains all `extern` declarations and `#[no_mangle]` exports
- performs boundary validation (null checks, length checks, UTF-8 checks)
- converts into safe internal types

Everything beyond that boundary should be safe Rust.

## 8) bindgen: generate bindings, don’t hand-maintain them

Use bindgen when you consume a C header.

Defaults:

- check generated bindings into `src/bindings.rs`
- treat bindings as generated artifacts: do not edit by hand
- minimize exposure with allowlists/blocklists so you don’t accidentally bind the world

If your unsafe code depends on a particular layout, validate it (size/align tests) and run Miri/sanitizers on the safe wrapper logic, not on the external calls.

## 9) cbindgen: generate headers for your C-facing Rust API

Use cbindgen when C consumers need a header for your Rust library.

Defaults:

- keep a dedicated C ABI surface (small, stable, versioned)
- avoid `pub` fields on FFI structs unless you commit to them as ABI
- document ownership and threading rules in the header comments

If you cannot describe the contract in a header comment, you are not ready to publish the ABI.
