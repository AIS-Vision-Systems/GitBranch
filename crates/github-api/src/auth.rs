//! OAuth App Device Flow (implemented in Phase 5; see `docs/ARCHITECTURE.md`, Credentials).

/// Client ID of the `GitBranch` OAuth App registered under the AIS-Vision-Systems organization.
///
/// Public by design: the Device Flow never uses a client secret (D-004).
pub const CLIENT_ID: &str = "Ov23liz0pkJr73cVRaNX";

/// Scopes requested at login (D-005). `workflow` is added on demand from the settings.
pub const DEFAULT_SCOPES: &str = "repo read:org";
