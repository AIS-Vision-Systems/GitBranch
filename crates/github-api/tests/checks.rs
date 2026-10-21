//! Batched checks cache against the mock transport.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use std::time::Duration;

use github_api::checks::ChecksCache;
use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use github_api::repos::RepoSlug;
use github_api::{Error, GitHub};
use serde_json::json;

fn slug() -> RepoSlug {
    RepoSlug { owner: "octo".into(), name: "hello".into() }
}

fn shas() -> Vec<String> {
    vec!["aaaa".into(), "bbbb".into(), "aaaa".into()]
}

fn runs(status: &str, conclusion: Option<&str>) -> Response {
    Response::json_body(
        200,
        &json!({"check_runs": [{"name": "ci", "status": status, "conclusion": conclusion}]}),
    )
}

fn empty_status() -> Response {
    Response::json_body(200, &json!({"statuses": []}))
}

fn ok_mock() -> MockTransport {
    MockTransport::new()
        .route(Method::Get, "/check-runs?per_page=100", vec![runs("completed", Some("success"))])
        .route(Method::Get, "/status", vec![empty_status()])
}

fn cache() -> ChecksCache {
    ChecksCache::new(Duration::from_secs(120), Duration::from_secs(20))
}

#[tokio::test(start_paused = true)]
async fn caches_within_ttl_and_refetches_after() {
    let gh = GitHub::new(ok_mock());
    let c = cache();
    let r = c.get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    assert_eq!(r.len(), 2);
    assert_eq!(r["aaaa"].overall, "success");
    let n = gh.transport().calls().len();
    assert_eq!(n, 4); // 2 shas x (check-runs + status)

    tokio::time::advance(Duration::from_secs(100)).await;
    c.get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), n);

    tokio::time::advance(Duration::from_secs(21)).await;
    c.get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 2 * n);
}

#[tokio::test(start_paused = true)]
async fn pending_expires_faster() {
    let t = MockTransport::new()
        .route(Method::Get, "/check-runs?per_page=100", vec![runs("in_progress", None)])
        .route(Method::Get, "/status", vec![empty_status()]);
    let gh = GitHub::new(t);
    let c = cache();
    let one = vec!["aaaa".to_string()];
    c.get_many(&gh, "tok", &slug(), &one, false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 2);
    tokio::time::advance(Duration::from_secs(10)).await;
    c.get_many(&gh, "tok", &slug(), &one, false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 2);
    tokio::time::advance(Duration::from_secs(11)).await;
    c.get_many(&gh, "tok", &slug(), &one, false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 4);
}

#[tokio::test(start_paused = true)]
async fn force_refetches_and_clear_empties() {
    let gh = GitHub::new(ok_mock());
    let c = cache();
    c.get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    c.get_many(&gh, "tok", &slug(), &shas(), true).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 8);
    c.clear();
    c.get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    assert_eq!(gh.transport().calls().len(), 12);
}

#[tokio::test(start_paused = true)]
async fn failing_sha_is_omitted() {
    let boom = Response::json_body(500, &json!({"message": "boom"}));
    let t = MockTransport::new()
        .route(Method::Get, "/bbbb/check-runs?per_page=100", vec![boom])
        .route(Method::Get, "/check-runs?per_page=100", vec![runs("completed", Some("success"))])
        .route(Method::Get, "/status", vec![empty_status()]);
    let gh = GitHub::new(t);
    let r = cache().get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap();
    assert_eq!(r.len(), 1);
    assert!(r.contains_key("aaaa"));
}

#[tokio::test(start_paused = true)]
async fn rate_limit_aborts() {
    let limited =
        Response::json_body(429, &json!({"message": "slow down"})).with_header("retry-after", "30");
    let t = MockTransport::new().route(Method::Get, "/check-runs?per_page=100", vec![limited]);
    let gh = GitHub::new(t);
    let e = cache().get_many(&gh, "tok", &slug(), &shas(), false).await.unwrap_err();
    assert!(matches!(e, Error::RateLimited { .. }), "{e:?}");
}
