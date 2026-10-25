//! Transport abstraction so the client is testable offline.

use std::future::Future;
use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::error::Error;

/// HTTP method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    /// GET
    Get,
    /// POST
    Post,
    /// PATCH
    Patch,
    /// PUT
    Put,
    /// DELETE
    Delete,
}

/// An outgoing request. Headers carry `Authorization` and are never logged or shown by `Debug`.
#[derive(Clone)]
pub struct Request {
    /// Method.
    pub method: Method,
    /// Absolute URL.
    pub url: String,
    /// Header name/value pairs.
    pub headers: Vec<(String, String)>,
    /// Body bytes.
    pub body: Option<Vec<u8>>,
}

impl std::fmt::Debug for Request {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Request")
            .field("method", &self.method)
            .field("url", &self.url)
            .field("headers", &"<redacted>")
            .field("body_len", &self.body.as_ref().map(Vec::len))
            .finish()
    }
}

/// A received response.
#[derive(Clone)]
pub struct Response {
    /// HTTP status.
    pub status: u16,
    /// Header name/value pairs (names as received).
    pub headers: Vec<(String, String)>,
    /// Body bytes.
    pub body: Vec<u8>,
}

impl std::fmt::Debug for Response {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Response")
            .field("status", &self.status)
            .field("headers", &self.headers.len())
            .field("body_len", &self.body.len())
            .finish()
    }
}

impl Response {
    /// First header named `name`, case-insensitive.
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    /// Deserializes the body as JSON.
    pub fn json<T: DeserializeOwned>(&self) -> Result<T, Error> {
        serde_json::from_slice(&self.body).map_err(|e| Error::Decode(e.to_string()))
    }
}

/// Sends requests. Implemented by [`ReqwestTransport`] and the test mock.
pub trait Transport: Send + Sync {
    /// Performs one request; HTTP error statuses are returned as `Ok`.
    fn send(&self, req: Request) -> impl Future<Output = Result<Response, Error>> + Send;

    /// Like [`Transport::send`] for untrusted downloads: the body is limited to `max_body` bytes
    /// (checked against `Content-Length` and while reading) and every hop of a redirect chain
    /// (at most 3) must satisfy `allow_url`; a refused URL is [`Error::BadUrl`], an oversized body
    /// [`Error::Decode`]. The default implementation does not follow redirects.
    fn send_limited(
        &self,
        req: Request,
        max_body: usize,
        allow_url: fn(&str) -> bool,
    ) -> impl Future<Output = Result<Response, Error>> + Send {
        async move {
            if !allow_url(&req.url) {
                return Err(Error::BadUrl("url is not allowed".into()));
            }
            let res = self.send(req).await?;
            if res.body.len() > max_body {
                return Err(Error::Decode("response body is too large".into()));
            }
            Ok(res)
        }
    }
}

/// The real transport (rustls).
#[derive(Debug, Clone)]
pub struct ReqwestTransport {
    client: reqwest::Client,
    /// Never follows redirects; used by [`Transport::send_limited`].
    manual: reqwest::Client,
}

/// Redirect hops [`Transport::send_limited`] follows.
const MAX_HOPS: usize = 3;

impl Default for ReqwestTransport {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(format!("GitBranch/{}", crate::VERSION))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("reqwest client builder with static options");
        let manual = reqwest::Client::builder()
            .user_agent(format!("GitBranch/{}", crate::VERSION))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client builder with static options");
        Self { client, manual }
    }
}

impl Transport for ReqwestTransport {
    async fn send(&self, req: Request) -> Result<Response, Error> {
        let method = match req.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Patch => reqwest::Method::PATCH,
            Method::Put => reqwest::Method::PUT,
            Method::Delete => reqwest::Method::DELETE,
        };
        let mut b = self.client.request(method, &req.url);
        for (k, v) in &req.headers {
            b = b.header(k, v);
        }
        if let Some(body) = req.body {
            b = b.body(body);
        }
        let res = b.send().await.map_err(|e| Error::Network(e.without_url().to_string()))?;
        let status = res.status().as_u16();
        let headers = res
            .headers()
            .iter()
            .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
            .collect();
        let body = res.bytes().await.map_err(|e| Error::Network(e.without_url().to_string()))?;
        Ok(Response { status, headers, body: body.to_vec() })
    }

    async fn send_limited(
        &self,
        req: Request,
        max_body: usize,
        allow_url: fn(&str) -> bool,
    ) -> Result<Response, Error> {
        let net = |e: reqwest::Error| Error::Network(e.without_url().to_string());
        let mut url = req.url.clone();
        for _ in 0..=MAX_HOPS {
            if !allow_url(&url) {
                return Err(Error::BadUrl("url is not allowed".into()));
            }
            let mut b = self.manual.get(&url);
            for (k, v) in &req.headers {
                b = b.header(k, v);
            }
            let mut res = b.send().await.map_err(net)?;
            if res.status().is_redirection() {
                let next = res
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|loc| res.url().join(loc).ok())
                    .ok_or_else(|| Error::BadUrl("redirect without a usable location".into()))?;
                url = next.to_string();
                continue;
            }
            let too_large = || Error::Decode("response body is too large".into());
            if res.content_length().is_some_and(|n| n > max_body as u64) {
                return Err(too_large());
            }
            let status = res.status().as_u16();
            let headers = res
                .headers()
                .iter()
                .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
                .collect();
            let mut body = Vec::new();
            while let Some(chunk) = res.chunk().await.map_err(net)? {
                if body.len() + chunk.len() > max_body {
                    return Err(too_large());
                }
                body.extend_from_slice(&chunk);
            }
            return Ok(Response { status, headers, body });
        }
        Err(Error::BadUrl("too many redirects".into()))
    }
}

/// Offline transport for tests.
#[cfg(any(test, feature = "mock"))]
pub mod mock {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::{Error, Method, Request, Response, Transport};

    impl Response {
        /// A response with a JSON body.
        pub fn json_body(status: u16, value: &serde_json::Value) -> Self {
            Self {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: value.to_string().into_bytes(),
            }
        }

        /// Adds a header.
        #[must_use]
        pub fn with_header(mut self, name: &str, value: &str) -> Self {
            self.headers.push((name.into(), value.into()));
            self
        }
    }

    struct Route {
        method: Method,
        url: String,
        queue: VecDeque<Response>,
    }

    /// Scripted transport recording every request.
    #[derive(Default)]
    pub struct MockTransport {
        routes: Mutex<Vec<Route>>,
        calls: Mutex<Vec<Request>>,
    }

    impl MockTransport {
        /// Empty mock.
        pub fn new() -> Self {
            Self::default()
        }

        /// Registers responses for requests whose URL ends with `url_suffix` (or equals it).
        /// They are consumed in order; the last one repeats.
        #[must_use]
        pub fn route(self, method: Method, url_suffix: &str, responses: Vec<Response>) -> Self {
            self.routes.lock().expect("lock poisoned").push(Route {
                method,
                url: url_suffix.to_string(),
                queue: responses.into(),
            });
            self
        }

        /// Every request received so far.
        pub fn calls(&self) -> Vec<Request> {
            self.calls.lock().expect("lock poisoned").clone()
        }
    }

    impl Transport for MockTransport {
        // No await inside: answer with a ready future (clippy::unused_async_trait_impl).
        fn send(
            &self,
            req: Request,
        ) -> impl std::future::Future<Output = Result<Response, Error>> + Send {
            let found = {
                let mut routes = self.routes.lock().expect("lock poisoned");
                routes
                    .iter_mut()
                    .find(|r| r.method == req.method && req.url.ends_with(&r.url))
                    .and_then(|r| {
                        if r.queue.len() > 1 {
                            r.queue.pop_front()
                        } else {
                            r.queue.front().cloned()
                        }
                    })
            };
            self.calls.lock().expect("lock poisoned").push(req);
            std::future::ready(found.ok_or_else(|| Error::Network("no route".into())))
        }
    }
}
