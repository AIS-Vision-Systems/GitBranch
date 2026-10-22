//! Errors of the GitHub client. Never contain a token.

use crate::token::TokenError;

/// Everything that can go wrong talking to GitHub.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Transport failure (DNS, TLS, timeout, offline).
    #[error("network error: {0}")]
    Network(String),
    /// GitHub answered with an unexpected non-2xx status.
    #[error("GitHub returned {status}: {message}")]
    Status {
        /// HTTP status.
        status: u16,
        /// Message from the JSON body, or the status text.
        message: String,
    },
    /// 401, or no token stored.
    #[error("not signed in to GitHub")]
    Unauthorized,
    /// 404.
    #[error("not found")]
    NotFound,
    /// Primary or secondary rate limit.
    #[error("GitHub rate limit reached")]
    RateLimited {
        /// Epoch seconds when the limit resets, if known.
        reset: Option<u64>,
    },
    /// The body was not what we expected.
    #[error("unexpected response: {0}")]
    Decode(String),
    /// The user denied the device authorization.
    #[error("sign-in was denied on GitHub")]
    AccessDenied,
    /// The device code expired.
    #[error("the sign-in code expired")]
    Expired,
    /// The sign-in was cancelled locally.
    #[error("sign-in cancelled")]
    Cancelled,
    /// The OAuth app does not allow the device flow.
    #[error("device flow is not enabled for this OAuth app (see docs/DECISIONS.md D-004)")]
    DeviceFlowDisabled,
    /// A URL outside the allowed hosts.
    #[error("refused URL: {0}")]
    BadUrl(String),
    /// Credential store failure.
    #[error(transparent)]
    Token(#[from] TokenError),
}

impl Error {
    /// Stable machine-readable code for the UI.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "github.network",
            Self::Status { .. } => "github.api",
            Self::Unauthorized => "github.unauthorized",
            Self::NotFound => "github.not_found",
            Self::RateLimited { .. } => "github.rate_limit",
            Self::Decode(_) => "github.decode",
            Self::AccessDenied => "github.denied",
            Self::Expired => "github.expired",
            Self::Cancelled => "github.cancelled",
            Self::DeviceFlowDisabled => "github.device_flow_disabled",
            Self::BadUrl(_) => "github.bad_url",
            Self::Token(_) => "github.keyring",
        }
    }
}
