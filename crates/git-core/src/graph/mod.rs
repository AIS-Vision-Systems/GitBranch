//! Commit-graph lane layout (see `docs/ARCHITECTURE.md`, "Graph layout").

pub mod color;
pub mod layout;

pub use layout::{Edge, EdgeKind, LayoutState, Row};
