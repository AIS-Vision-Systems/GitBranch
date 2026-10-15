use serde::Serialize;

/// Error shape every command returns to the UI (see `docs/ARCHITECTURE.md`, IPC contract).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// Stable machine-readable code (`git.exit`, `git.timeout`, `git.not_a_repo`, ...).
    pub code: String,
    /// One-line human message.
    pub message: String,
    /// Optional long detail (stderr, context). Never contains tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}
