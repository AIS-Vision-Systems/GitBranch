//! Repository operations that are not parsers: maintenance, ignore checks, and the Phase 2 writes.

pub mod blame;
pub mod branch;
pub mod clone;
pub mod commit;
pub mod config;
pub mod conflict;
pub mod difftool;
pub mod history;
pub mod ignore;
pub mod init;
pub mod log_range;
pub mod maintenance;
pub mod merge;
pub mod patch;
pub mod pull_request;
pub mod rebase;
pub mod reflog;
pub mod remote;
pub mod stage;
pub mod stash;
pub mod state;
pub mod submodule;
pub mod tag;
pub mod worktree;
