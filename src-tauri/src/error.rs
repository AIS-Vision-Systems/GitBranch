use git_core::ops::remote::RemoteError;
use git_core::ops::submodule::SubmoduleError;
use git_core::parse::{
    diff::DiffError, log::LogError, refs::RefsError, show::ShowError, status::StatusError,
};
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
    /// An error with a code and a one-line message.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), detail: None }
    }

    /// Attaches a long detail (stderr, context).
    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

impl From<git_core::GitError> for AppError {
    fn from(err: git_core::GitError) -> Self {
        let message = err.to_string();
        AppError::new(err.code(), message).with_detail(err.stderr.clone())
    }
}

/// Parse-module errors: git failures keep their `git.*` code, malformed output becomes `parse.invalid`.
macro_rules! from_parse_module_error {
    ($t:ident) => {
        impl From<$t> for AppError {
            fn from(err: $t) -> Self {
                match err {
                    $t::Git(g) => g.into(),
                    $t::Parse(p) => AppError::new("parse.invalid", p.to_string()),
                }
            }
        }
    };
}

from_parse_module_error!(LogError);
from_parse_module_error!(RefsError);
from_parse_module_error!(StatusError);
from_parse_module_error!(ShowError);
from_parse_module_error!(DiffError);
from_parse_module_error!(RemoteError);
from_parse_module_error!(SubmoduleError);

impl From<github_api::Error> for AppError {
    fn from(err: github_api::Error) -> Self {
        AppError::new(err.code(), err.to_string())
    }
}
