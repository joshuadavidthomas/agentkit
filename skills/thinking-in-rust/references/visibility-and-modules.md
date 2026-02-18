# Visibility Is a Design Tool

## The Smell

Everything is `pub`, or all code lives in one file with no module structure. Closely related: `use super::*` everywhere, or "utils"/"helpers" junk-drawer modules.

```
// WRONG — flat structure, everything public
src/
├── main.rs
├── types.rs       (pub everything)
├── helpers.rs     (pub everything)
└── utils.rs       (pub everything — what's the difference from helpers?)

// WRONG — one giant file
src/
└── main.rs  (3,000 lines)
```

## The Idiomatic Alternative

### Organize by domain, not by kind

```
src/
├── main.rs
├── lib.rs
├── auth/
│   ├── mod.rs         (re-exports public API)
│   ├── credentials.rs
│   ├── session.rs
│   └── middleware.rs
├── api/
│   ├── mod.rs
│   ├── handlers.rs
│   └── routes.rs
└── config.rs
```

### Use `mod.rs` to control the public API

```rust
// src/auth/mod.rs — the public API surface
mod credentials;
mod session;
mod middleware;

pub use credentials::Credentials;
pub use session::Session;
pub use middleware::AuthMiddleware;

// Internal helpers stay private
use session::validate_token;
```

### Visibility as deliberate API design

```rust
pub struct User {          // Public — part of the API
    pub name: String,      // Public — consumers can read/write
    pub(crate) id: UserId, // Crate-visible — internal subsystems can access
    email: String,         // Private — only this module
}

pub fn create_user(name: &str, email: &str) -> User { todo!() }    // Public API
pub(crate) fn validate_user(user: &User) -> bool { todo!() }        // Internal
fn hash_email(email: &str) -> String { todo!() }                     // Private helper
```

### Re-exports flatten the path

```rust
// Without re-export: users write
use mycrate::auth::credentials::Credentials;

// With re-export in auth/mod.rs:
use mycrate::auth::Credentials;

// Top-level convenience re-exports in lib.rs:
pub use auth::{Credentials, Session};
```

### Module file layout: prefer 2018+ convention

Use `foo.rs` + `foo/bar.rs`, not `foo/mod.rs` + `foo/bar.rs`. The 2018+ convention avoids the "many mod.rs tabs" problem in editors.

```
// PREFERRED (Rust 2018+)
src/
├── auth.rs          (declares mod credentials; mod session;)
├── auth/
│   ├── credentials.rs
│   └── session.rs
└── lib.rs

// AVOID (Rust 2015 style)
src/
├── auth/
│   ├── mod.rs       (declares mod credentials; mod session;)
│   ├── credentials.rs
│   └── session.rs
└── lib.rs
```

Never have both `auth.rs` and `auth/mod.rs` — that's a compile error. Pick one convention and use it consistently within a crate.

## Signs Your Structure Needs Work

- **Files over 500 lines.** Time to split.
- **Circular dependencies.** Module A uses B, B uses A → extract shared types into a third module.
- **`pub` on everything.** You haven't defined your API boundary. In libraries, every `pub` item is a semver commitment.
- **`use super::*` everywhere.** Modules are too tightly coupled.
- **"utils" or "helpers" modules.** Junk drawers. Put functions next to the code that uses them, or name the module after what it does.

## When Flat Structure Is Fine

- **Small projects / scripts.** A single-file binary under 200 lines doesn't need a module hierarchy.
- **Proc macro crates.** Often a single `lib.rs` by necessity.
- **Examples and tests.** Single-file is usually appropriate.

For crate-level and workspace organization, see **rust-project-structure**.

## Common Source Languages

- **Python** — module system exists but large single files are common; `__init__.py` confusion leads to flat structures
- **JavaScript** — historically one-file apps; module systems were bolted on
- **Go** — packages are flat by convention (no nested packages)
- **Java** — forces one-class-per-file but doesn't encourage the kind of API-surface thinking that `pub`/private modules enable
