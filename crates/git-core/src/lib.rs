//! Git backend for GitBranch.
//!
//! Everything in this crate talks to the user's `git` executable through the runner and parses
//! only machine-readable output. It has no dependency on Tauri so it can be tested with real
//! repositories in temporary directories.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod graph;
pub mod parse;
pub mod runner;

pub use runner::{GitError, GitErrorKind, GitOutput, GitRunner, GitVersion, RunOpts};

/// Throwaway repositories built with real `git`, for tests and debugging (feature `fixtures`).
#[cfg(feature = "fixtures")]
pub mod fixtures;

/// Crate version, reported by the Tauri shell.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
