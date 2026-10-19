//! Thin GitHub REST client over a [`Transport`].

use std::fmt::Write as _;

use serde::Serialize;

use crate::error::Error;
use crate::http::{Method, Request, Response, Transport};

/// REST API base URL.
pub const API_BASE: &str = "https://api.github.com";
/// Web base URL (OAuth endpoints).
pub const WEB_BASE: &str = "https://github.com";

/// GitHub client.
#[derive(Debug)]
pub struct GitHub<T: Transport> {
    transport: T,
    api_base: String,
    web_base: String,
}

impl<T: Transport> GitHub<T> {
    /// Client against github.com.
    pub fn new(transport: T) -> Self {
        Self { transport, api_base: API_BASE.into(), web_base: WEB_BASE.into() }
    }

    /// The underlying transport.
    pub fn transport(&self) -> &T {
        &self.transport
    }

    /// `GET api_base + path`, errors mapped.
    pub async fn get(&self, token: Option<&str>, path: &str) -> Result<Response, Error> {
        self.request(Method::Get, token, path, None).await
    }

    /// `POST api_base + path` with a JSON body, errors mapped.
    pub async fn post_json(
        &self,
        token: Option<&str>,
        path: &str,
        body: &impl Serialize,
    ) -> Result<Response, Error> {
        let bytes = serde_json::to_vec(body).map_err(|e| Error::Decode(e.to_string()))?;
        self.request(Method::Post, token, path, Some(bytes)).await
    }

    /// The single path every API call goes through.
    async fn request(
        &self,
        method: Method,
        token: Option<&str>,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> Result<Response, Error> {
        let mut headers = vec![
            ("Accept".to_string(), "application/vnd.github+json".to_string()),
            ("X-GitHub-Api-Version".to_string(), "2022-11-28".to_string()),
        ];
        if let Some(t) = token {
            headers.push(("Authorization".into(), format!("Bearer {t}")));
        }
        if body.is_some() {
            headers.push(("Content-Type".into(), "application/json".into()));
        }
        let url = format!("{}{path}", self.api_base);
        let res = self.transport.send(Request { method, url, headers, body }).await?;
        map_status(res)
    }

    /// `POST web_base + path` as a form. Statuses are not mapped: the device flow reports
    /// its errors in the JSON body.
    pub(crate) async fn post_form_web(
        &self,
        path: &str,
        form: &[(&str, &str)],
    ) -> Result<Response, Error> {
        let body = form
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let headers = vec![
            ("Accept".to_string(), "application/json".to_string()),
            ("Content-Type".to_string(), "application/x-www-form-urlencoded".to_string()),
        ];
        let url = format!("{}{path}", self.web_base);
        self.transport
            .send(Request { method: Method::Post, url, headers, body: Some(body.into_bytes()) })
            .await
    }
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

fn map_status(res: Response) -> Result<Response, Error> {
    if (200..300).contains(&res.status) {
        return Ok(res);
    }
    match res.status {
        401 => return Err(Error::Unauthorized),
        404 => return Err(Error::NotFound),
        429 => {
            let reset = res.header("x-ratelimit-reset").and_then(|v| v.trim().parse().ok());
            return Err(Error::RateLimited { reset });
        }
        403 => {
            let exhausted = res.header("x-ratelimit-remaining") == Some("0");
            if exhausted || res.header("retry-after").is_some() {
                let reset = res.header("x-ratelimit-reset").and_then(|v| v.trim().parse().ok());
                return Err(Error::RateLimited { reset });
            }
        }
        _ => {}
    }
    let message = res
        .json::<serde_json::Value>()
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str().map(str::to_string)))
        .unwrap_or_else(|| status_text(res.status));
    Err(Error::Status { status: res.status, message })
}

fn status_text(status: u16) -> String {
    match status {
        400 => "Bad Request",
        403 => "Forbidden",
        409 => "Conflict",
        422 => "Unprocessable Entity",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Error",
    }
    .to_string()
}
