//! Thin GitHub REST client over a [`Transport`].

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;

use crate::error::Error;
use crate::http::{Method, Request, Response, Transport};

/// REST API base URL.
pub const API_BASE: &str = "https://api.github.com";
/// Web base URL (OAuth endpoints).
pub const WEB_BASE: &str = "https://github.com";

/// Default ETag cache capacity (entries).
const CACHE_CAPACITY: usize = 256;
/// Back-off when GitHub signals a rate limit without saying when it ends.
const DEFAULT_BACKOFF_SECS: u64 = 60;
/// Longest local refusal window, whatever the server asks for.
const MAX_BACKOFF_SECS: u64 = 3600;

/// Rate-limit counters from the last response carrying `x-ratelimit-*` headers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimit {
    /// Requests allowed per window.
    pub limit: u32,
    /// Requests left in the window.
    pub remaining: u32,
    /// Window end, epoch seconds.
    pub reset: u64,
}

/// Connectivity and rate-limit state, for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    /// `false` after a network failure until the next response.
    pub online: bool,
    /// Last known counters.
    pub rate_limit: Option<RateLimit>,
    /// While set (and in the future), requests are refused locally. Epoch seconds.
    pub rate_limited_until: Option<u64>,
}

#[derive(Debug, Clone)]
struct CachedEntry {
    etag: String,
    body: Vec<u8>,
    headers: Vec<(String, String)>,
    inserted: Instant,
}

/// Mutable client state. The back-off window is tracked twice: `Instant` decides when to
/// stop refusing (monotonic, controllable with tokio's paused time in tests), the epoch value
/// is what is reported to the UI.
#[derive(Debug)]
struct State {
    rate: Option<RateLimit>,
    online: bool,
    blocked: Option<(Instant, u64)>,
}

/// GitHub client.
#[derive(Debug)]
pub struct GitHub<T: Transport> {
    transport: T,
    api_base: String,
    web_base: String,
    etags: Mutex<HashMap<String, CachedEntry>>,
    cache_capacity: usize,
    generation: AtomicU64,
    state: Mutex<State>,
}

fn lock<V>(m: &Mutex<V>) -> MutexGuard<'_, V> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn epoch_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn parse_rate(res: &Response) -> Option<RateLimit> {
    Some(RateLimit {
        limit: res.header("x-ratelimit-limit")?.trim().parse().ok()?,
        remaining: res.header("x-ratelimit-remaining")?.trim().parse().ok()?,
        reset: res.header("x-ratelimit-reset")?.trim().parse().ok()?,
    })
}

impl<T: Transport> GitHub<T> {
    /// Client against github.com.
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            api_base: API_BASE.into(),
            web_base: WEB_BASE.into(),
            etags: Mutex::new(HashMap::new()),
            cache_capacity: CACHE_CAPACITY,
            generation: AtomicU64::new(0),
            state: Mutex::new(State { rate: None, online: true, blocked: None }),
        }
    }

    /// Sets the ETag cache capacity (at least 1).
    #[must_use]
    pub fn with_cache_capacity(mut self, capacity: usize) -> Self {
        self.cache_capacity = capacity.max(1);
        self
    }

    /// Drops every cached response (sign-out).
    pub fn clear_cache(&self) {
        let mut map = lock(&self.etags);
        self.generation.fetch_add(1, Ordering::SeqCst);
        map.clear();
    }

    /// Connectivity and rate-limit snapshot.
    pub fn status(&self) -> GithubStatus {
        let st = lock(&self.state);
        let until = st.blocked.filter(|(i, _)| Instant::now() < *i).map(|(_, e)| e);
        GithubStatus { online: st.online, rate_limit: st.rate, rate_limited_until: until }
    }

    /// The underlying transport.
    pub fn transport(&self) -> &T {
        &self.transport
    }

    /// `GET api_base + path`, errors mapped.
    pub async fn get(&self, token: Option<&str>, path: &str) -> Result<Response, Error> {
        self.request(Method::Get, token, path, None).await
    }

    /// GET of an absolute URL (e.g. a `Link: rel="next"` target), errors mapped.
    pub async fn get_url(&self, token: Option<&str>, url: &str) -> Result<Response, Error> {
        self.send(Method::Get, token, url.to_string(), None).await
    }

    /// GETs `path` (relative, with its query) and follows `Link: rel="next"` up to `max_pages`
    /// pages, concatenating the JSON arrays.
    pub async fn get_all<R: DeserializeOwned>(
        &self,
        token: Option<&str>,
        path: &str,
        max_pages: usize,
    ) -> Result<Vec<R>, Error> {
        let mut out = Vec::new();
        let mut res = self.get(token, path).await?;
        for page in 1.. {
            out.extend(res.json::<Vec<R>>()?);
            let next = res.header("link").and_then(next_link);
            match next {
                Some(url) if page < max_pages => res = self.get_url(token, &url).await?,
                _ => break,
            }
        }
        Ok(out)
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
        let url = format!("{}{path}", self.api_base);
        self.send(method, token, url, body).await
    }

    async fn send(
        &self,
        method: Method,
        token: Option<&str>,
        url: String,
        body: Option<Vec<u8>>,
    ) -> Result<Response, Error> {
        let until = {
            let st = lock(&self.state);
            st.blocked.filter(|(i, _)| Instant::now() < *i).map(|(_, e)| e)
        };
        if let Some(until) = until {
            return Err(Error::RateLimited { reset: Some(until) });
        }
        let is_get = method == Method::Get;
        let generation = self.generation.load(Ordering::SeqCst);
        let mut use_cache = is_get;
        loop {
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
            if use_cache && let Some(e) = lock(&self.etags).get(&url) {
                headers.push(("If-None-Match".into(), e.etag.clone()));
            }
            let req = Request { method, url: url.clone(), headers, body: body.clone() };
            let res = match self.transport.send(req).await {
                Ok(r) => r,
                Err(e) => {
                    if matches!(e, Error::Network(_)) {
                        lock(&self.state).online = false;
                    }
                    return Err(e);
                }
            };
            self.observe(&res);
            if use_cache && res.status == 304 {
                if let Some(e) = lock(&self.etags).get_mut(&url) {
                    e.inserted = Instant::now();
                    return Ok(Response {
                        status: 200,
                        headers: e.headers.clone(),
                        body: e.body.clone(),
                    });
                }
                // The entry vanished during the request: refetch unconditionally, once.
                use_cache = false;
                continue;
            }
            let etag = res.header("etag").map(str::to_string);
            let mapped = map_status(res.clone());
            match &mapped {
                Ok(r) if is_get => {
                    if let Some(etag) = etag {
                        self.store(url, etag, r, generation);
                    }
                }
                Err(Error::RateLimited { reset }) => self.block(&res, *reset),
                _ => {}
            }
            return mapped;
        }
    }

    /// Records connectivity and the rate-limit counters of any received response.
    fn observe(&self, res: &Response) {
        let mut st = lock(&self.state);
        st.online = true;
        if let Some(r) = parse_rate(res) {
            st.rate = Some(r);
        }
    }

    /// Starts the local back-off: `retry-after` if sent, else the reset time, else 60 s.
    fn block(&self, res: &Response, reset: Option<u64>) {
        let now = epoch_now();
        let retry: Option<u64> = res.header("retry-after").and_then(|v| v.trim().parse().ok());
        let until = retry.map(|s| now + s).or(reset).unwrap_or(now + DEFAULT_BACKOFF_SECS);
        let wait = Duration::from_secs(until.saturating_sub(now).min(MAX_BACKOFF_SECS));
        lock(&self.state).blocked = Some((Instant::now() + wait, until));
    }

    fn store(&self, key: String, etag: String, res: &Response, generation: u64) {
        let mut map = lock(&self.etags);
        if self.generation.load(Ordering::SeqCst) != generation {
            return; // cleared while this request was in flight
        }
        if !map.contains_key(&key) && map.len() >= self.cache_capacity {
            let oldest = map.iter().min_by_key(|(_, e)| e.inserted).map(|(k, _)| k.clone());
            if let Some(k) = oldest {
                map.remove(&k);
            }
        }
        let entry = CachedEntry {
            etag,
            body: res.body.clone(),
            headers: res.headers.clone(),
            inserted: Instant::now(),
        };
        map.insert(key, entry);
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

/// Parses an RFC 8288 `Link` header and returns the `rel="next"` URL, if any.
pub fn next_link(link_header: &str) -> Option<String> {
    link_header.split(',').find_map(|part| {
        let mut pieces = part.split(';');
        let target = pieces.next()?.trim();
        let url = target.strip_prefix('<')?.strip_suffix('>')?;
        let is_next = pieces.any(|p| {
            p.trim().strip_prefix("rel=").is_some_and(|v| {
                v.trim_matches('"').split_whitespace().any(|r| r.eq_ignore_ascii_case("next"))
            })
        });
        is_next.then(|| url.to_string())
    })
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
    let body = res.json::<serde_json::Value>().ok();
    let mut message = body
        .as_ref()
        .and_then(|v| v.get("message").and_then(|m| m.as_str().map(str::to_string)))
        .unwrap_or_else(|| status_text(res.status));
    if let Some(d) = body.as_ref().and_then(error_detail) {
        message = format!("{message}: {d}");
    }
    Err(Error::Status { status: res.status, message })
}

/// First entry of GitHub's `errors[]`: a plain string, an object's `message`, or
/// `"<field> <code>"`.
fn error_detail(v: &serde_json::Value) -> Option<String> {
    let first = v.get("errors")?.as_array()?.first()?;
    let text = if let Some(s) = first.as_str() {
        s.to_string()
    } else if let Some(m) = first.get("message").and_then(|m| m.as_str()) {
        m.to_string()
    } else {
        let f = |k: &str| first.get(k).and_then(|x| x.as_str()).unwrap_or("");
        format!("{} {}", f("field"), f("code")).trim().to_string()
    };
    (!text.is_empty()).then_some(text)
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

#[cfg(test)]
mod tests {
    use super::{error_detail, next_link};
    use serde_json::json;

    #[test]
    fn error_detail_forms() {
        assert_eq!(error_detail(&json!({"errors": ["bad"]})).as_deref(), Some("bad"));
        assert_eq!(error_detail(&json!({"errors": [{"message": "m"}]})).as_deref(), Some("m"));
        let o = json!({"errors": [{"field": "head", "code": "invalid"}]});
        assert_eq!(error_detail(&o).as_deref(), Some("head invalid"));
        assert_eq!(error_detail(&json!({"errors": [{}]})), None);
        assert_eq!(error_detail(&json!({"message": "x"})), None);
    }

    #[test]
    fn next_with_prev_and_spaces() {
        let h = r#"<https://api.github.com/x?page=1>; rel="prev" ,  <https://api.github.com/x?page=3> ; rel="next", <https://api.github.com/x?page=9>; rel="last""#;
        assert_eq!(next_link(h).as_deref(), Some("https://api.github.com/x?page=3"));
    }

    #[test]
    fn no_next() {
        let h = r#"<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first""#;
        assert_eq!(next_link(h), None);
        assert_eq!(next_link(""), None);
    }

    #[test]
    fn single_next_link() {
        assert_eq!(
            next_link(r#"<https://a/b?page=2>; rel="next""#).as_deref(),
            Some("https://a/b?page=2")
        );
        assert_eq!(
            next_link("<https://a/b?page=2>; rel=next").as_deref(),
            Some("https://a/b?page=2")
        );
    }
}
