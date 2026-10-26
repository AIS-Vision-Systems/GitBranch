//! Commit-graph lane layout (see `docs/ARCHITECTURE.md`, "Graph layout").

pub mod color;
pub mod layout;
pub mod stash;

pub use layout::{Edge, EdgeKind, LayoutState, Row};
pub use stash::with_stashes;
