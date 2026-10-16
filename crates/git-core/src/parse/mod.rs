//! Parsers for machine-readable `git` output (`-z`, `--porcelain=v2`, `--format` with control separators).
//!
//! Each submodule exposes the data types, a pure `parse_*` function over bytes (unit-testable without
//! git) and an `async fn` that runs the corresponding git command through [`crate::GitRunner`].

pub mod log;
pub mod refs;

/// Error produced when git output does not match the expected machine-readable shape.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unexpected git output: {0}")]
pub struct ParseError(pub String);
