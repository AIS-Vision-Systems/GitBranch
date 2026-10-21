//! ETag cache, rate-limit and offline tracking, against the mock transport.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use github_api::http::mock::MockTransport;
use github_api::http::{Method, Request, Response, Transport};
use github_api::{Error, GitHub};
use serde_json::json;

fn ok(v: &serde_json::Value, etag: &str) -> Response {
    Response::json_body(200, v).with_header("ETag", etag)
}

fn not_modified() -> Response {
    Response { status: 304, headers: vec![], body: vec![] }
}

fn inm(r: &Request) -> Option<&str> {
    r.headers.iter().find(|(k, _)| k == "If-None-Match").map(|(_, v)| v.as_str())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_secs()
}

#[tokio::test]
async fn second_get_sends_if_none_match_and_304_yields_cached_body() {
    let t = MockTransport::new().route(
        Method::Get,
        "/x",
        vec![ok(&json!({"a": 1}), "\"e1\""), not_modified()],
    );
    let g = GitHub::new(t);
    let first = g.get(None, "/x").await.expect("first");
    let second = g.get(None, "/x").await.expect("second");
    assert_eq!(second.status, 200);
    assert_eq!(second.body, first.body);
    assert_eq!(second.header("etag"), Some("\"e1\""));
    let calls = g.transport().calls();
    assert_eq!(inm(&calls[0]), None);
    assert_eq!(inm(&calls[1]), Some("\"e1\""));
}

#[tokio::test]
async fn new_etag_replaces_entry() {
    let t = MockTransport::new().route(
        Method::Get,
        "/x",
        vec![ok(&json!(1), "\"e1\""), ok(&json!(2), "\"e2\""), not_modified()],
    );
    let g = GitHub::new(t);
    g.get(None, "/x").await.expect("1");
    g.get(None, "/x").await.expect("2");
    let third = g.get(None, "/x").await.expect("3");
    assert_eq!(third.body, b"2");
    assert_eq!(inm(&g.transport().calls()[2]), Some("\"e2\""));
}

#[tokio::test]
async fn capacity_evicts_oldest() {
    let t = MockTransport::new().route(Method::Get, "/a", vec![ok(&json!("a"), "\"a\"")]).route(
        Method::Get,
        "/b",
        vec![ok(&json!("b"), "\"b\"")],
    );
    let g = GitHub::new(t).with_cache_capacity(1);
    g.get(None, "/a").await.expect("a");
    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    g.get(None, "/b").await.expect("b");
    g.get(None, "/a").await.expect("a again");
    g.get(None, "/b").await.expect("b again");
    let calls = g.transport().calls();
    assert_eq!(inm(&calls[2]), None, "a was evicted by b");
    assert_eq!(inm(&calls[3]), None, "b was evicted by a");
}

#[tokio::test]
async fn clear_cache_drops_entries() {
    let t = MockTransport::new().route(Method::Get, "/x", vec![ok(&json!(1), "\"e\"")]);
    let g = GitHub::new(t);
    g.get(None, "/x").await.expect("1");
    g.clear_cache();
    g.get(None, "/x").await.expect("2");
    assert_eq!(inm(&g.transport().calls()[1]), None);
}

#[tokio::test]
async fn get_all_caches_each_page_by_url() {
    let link = "<https://api.github.com/x?page=2>; rel=\"next\"";
    let t = MockTransport::new()
        .route(
            Method::Get,
            "/x?per_page=1",
            vec![ok(&json!([1]), "\"p1\"").with_header("Link", link), not_modified()],
        )
        .route(Method::Get, "/x?page=2", vec![ok(&json!([2]), "\"p2\""), not_modified()]);
    let g = GitHub::new(t);
    let a: Vec<u32> = g.get_all(None, "/x?per_page=1", 5).await.expect("a");
    assert_eq!(a, [1, 2]);
    // Second run: both pages come back 304 and are served from the cache, Link included.
    let b: Vec<u32> = g.get_all(None, "/x?per_page=1", 5).await.expect("b");
    assert_eq!(a, b);
    let calls = g.transport().calls();
    assert_eq!(calls.len(), 4);
    assert_eq!(inm(&calls[2]), Some("\"p1\""));
    assert_eq!(inm(&calls[3]), Some("\"p2\""));
}

#[tokio::test]
async fn rate_headers_update_status() {
    let r = Response::json_body(200, &json!({}))
        .with_header("x-ratelimit-limit", "5000")
        .with_header("x-ratelimit-remaining", "4990")
        .with_header("x-ratelimit-reset", "1700000000");
    let g = GitHub::new(MockTransport::new().route(Method::Get, "/x", vec![r]));
    assert!(g.status().rate_limit.is_none());
    g.get(None, "/x").await.expect("ok");
    let rl = g.status().rate_limit.expect("rate limit");
    assert_eq!((rl.limit, rl.remaining, rl.reset), (5000, 4990, 1_700_000_000));
    assert!(g.status().online);
}

#[tokio::test]
async fn exhausted_403_blocks_following_calls_locally() {
    let reset = now() + 100;
    let r = Response::json_body(403, &json!({"message": "rate limited"}))
        .with_header("x-ratelimit-limit", "60")
        .with_header("x-ratelimit-remaining", "0")
        .with_header("x-ratelimit-reset", &reset.to_string());
    let g = GitHub::new(MockTransport::new().route(Method::Get, "/x", vec![r]));
    let e = g.get(None, "/x").await.expect_err("limited");
    assert!(matches!(e, Error::RateLimited { reset: Some(r) } if r == reset));
    assert_eq!(g.status().rate_limited_until, Some(reset));
    let e = g.get(None, "/x").await.expect_err("short-circuit");
    assert!(matches!(e, Error::RateLimited { reset: Some(r) } if r == reset));
    assert_eq!(g.transport().calls().len(), 1);
}

#[tokio::test]
async fn retry_after_without_reset_sets_window() {
    let r = Response::json_body(429, &json!({})).with_header("retry-after", "30");
    let g = GitHub::new(MockTransport::new().route(Method::Get, "/x", vec![r]));
    g.get(None, "/x").await.expect_err("limited");
    let until = g.status().rate_limited_until.expect("until");
    assert!((now() + 28..=now() + 31).contains(&until), "{until}");
}

struct Flaky {
    fail: AtomicUsize,
}

impl Transport for Flaky {
    async fn send(&self, _req: Request) -> Result<Response, Error> {
        if self.fail.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok()
        {
            return Err(Error::Network("down".into()));
        }
        Ok(Response::json_body(200, &json!({})))
    }
}

#[tokio::test]
async fn network_error_flips_online() {
    let g = GitHub::new(Flaky { fail: AtomicUsize::new(1) });
    assert!(g.status().online);
    assert!(matches!(g.get(None, "/x").await, Err(Error::Network(_))));
    assert!(!g.status().online);
    g.get(None, "/x").await.expect("recovered");
    assert!(g.status().online);
}

#[tokio::test(start_paused = true)]
async fn window_ends_and_call_reaches_transport() {
    let limited = Response::json_body(429, &json!({})).with_header("retry-after", "30");
    let t = MockTransport::new().route(
        Method::Get,
        "/x",
        vec![limited, Response::json_body(200, &json!({}))],
    );
    let g = GitHub::new(t);
    g.get(None, "/x").await.expect_err("limited");
    g.get(None, "/x").await.expect_err("blocked");
    assert_eq!(g.transport().calls().len(), 1);
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    g.get(None, "/x").await.expect("window over");
    assert_eq!(g.transport().calls().len(), 2);
    assert_eq!(g.status().rate_limited_until, None);
}

#[tokio::test]
async fn past_reset_does_not_block() {
    let r = Response::json_body(403, &json!({}))
        .with_header("x-ratelimit-remaining", "0")
        .with_header("x-ratelimit-reset", "1700000000");
    let g = GitHub::new(MockTransport::new().route(Method::Get, "/x", vec![r]));
    g.get(None, "/x").await.expect_err("limited");
    g.get(None, "/x").await.expect_err("limited again");
    assert_eq!(g.transport().calls().len(), 2);
}

#[tokio::test]
async fn post_never_conditional_or_cached() {
    let t = MockTransport::new().route(Method::Get, "/x", vec![ok(&json!(1), "\"e\"")]).route(
        Method::Post,
        "/x",
        vec![ok(&json!(2), "\"p\"")],
    );
    let g = GitHub::new(t);
    g.get(None, "/x").await.expect("get");
    g.post_json(None, "/x", &json!({})).await.expect("post");
    g.post_json(None, "/x", &json!({})).await.expect("post 2");
    let calls = g.transport().calls();
    assert_eq!(inm(&calls[1]), None);
    assert_eq!(inm(&calls[2]), None);
    // The GET entry is untouched by the POST.
    g.get(None, "/x").await.expect("get 2");
    assert_eq!(inm(&g.transport().calls()[3]), Some("\"e\""));
}

#[tokio::test]
async fn not_modified_without_entry_resends_unconditionally() {
    // Entry cleared while the conditional request was in flight.
    struct ClearOn304 {
        inner: MockTransport,
        gh: std::sync::OnceLock<std::sync::Weak<GitHub<ClearOn304>>>,
    }
    impl Transport for ClearOn304 {
        async fn send(&self, req: Request) -> Result<Response, Error> {
            let conditional = inm(&req).is_some();
            let r = self.inner.send(req).await;
            if conditional && let Some(g) = self.gh.get().and_then(std::sync::Weak::upgrade) {
                g.clear_cache();
            }
            r
        }
    }
    let inner = MockTransport::new().route(
        Method::Get,
        "/x",
        vec![ok(&json!(1), "\"e\""), not_modified(), ok(&json!(1), "\"e\"")],
    );
    let g = std::sync::Arc::new(GitHub::new(ClearOn304 { inner, gh: std::sync::OnceLock::new() }));
    g.transport().gh.set(std::sync::Arc::downgrade(&g)).expect("set once");
    g.get(None, "/x").await.expect("first");
    let res = g.get(None, "/x").await.expect("second");
    assert_eq!(res.status, 200);
    let calls = g.transport().inner.calls();
    assert_eq!(calls.len(), 3);
    assert_eq!(inm(&calls[2]), None);
}
