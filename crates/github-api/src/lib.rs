//! GitHub REST v3 client and OAuth App Device Flow for GitBranch.
//!
//! Implemented from Phase 5 of `docs/PLAN.md`. The crate exists now so the workspace layering
//! (`src-tauri` -> `git-core` / `github-api`) is fixed from the start.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod askpass;
pub mod auth;
pub mod token;

/// Crate version, exposed so the Tauri shell can report it in `User-Agent`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
