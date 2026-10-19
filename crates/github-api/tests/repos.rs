//! `list_repos` against the mock transport.

use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use github_api::repos::{Repo, list_repos};
use github_api::{Error, GitHub};
use serde_json::{Value, json};

fn repo(id: u64, name: &str) -> Value {
    json!({
        "id": id, "name": name, "full_name": format!("octo/{name}"),
        "owner": {"login": "octo"}, "private": true, "fork": false, "archived": false,
        "description": null,
        "html_url": format!("https://github.com/octo/{name}"),
        "clone_url": format!("https://github.com/octo/{name}.git"),
        "ssh_url": format!("git@github.com:octo/{name}.git"),
        "default_branch": "main", "pushed_at": null, "language": null
    })
}

const PAGE1: &str = "per_page=100";
const PAGE2: &str = "per_page=100&page=2";

#[tokio::test]
async fn two_pages_are_joined_and_mapped() {
    let next = format!("<https://api.github.com/user/repos?x=1&{PAGE2}>; rel=\"next\"");
    let mut first = repo(1, "a");
    first["pushed_at"] = json!("2026-01-01T00:00:00Z");
    first["language"] = json!("Rust");
    first["description"] = json!("desc");
    let t = MockTransport::new()
        .route(Method::Get, PAGE2, vec![Response::json_body(200, &json!([repo(3, "c")]))])
        .route(
            Method::Get,
            PAGE1,
            vec![
                Response::json_body(200, &json!([first, repo(2, "b")])).with_header("Link", &next),
            ],
        );
    let gh = GitHub::new(t);
    let repos = list_repos(&gh, "tok").await.expect("ok");
    let names: Vec<_> = repos.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(names, ["a", "b", "c"]);
    let a = &repos[0];
    assert_eq!(a.owner, "octo");
    assert!(a.private && !a.fork && !a.archived);
    assert_eq!(a.clone_url, "https://github.com/octo/a.git");
    assert_eq!(a.default_branch, "main");
    assert_eq!(a.language.as_deref(), Some("Rust"));
    assert_eq!(a.pushed_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert!(repos[1].description.is_none() && repos[1].pushed_at.is_none());
    let v = serde_json::to_value(a).expect("ok");
    assert_eq!(v["fullName"], "octo/a");
    assert_eq!(v["defaultBranch"], "main");
    let calls = gh.transport().calls();
    assert_eq!(calls.len(), 2);
    assert!(calls[0].url.starts_with("https://api.github.com/user/repos?affiliation="));
}

#[tokio::test]
async fn stops_at_max_pages() {
    let next = "<https://api.github.com/user/repos?per_page=100&page=2>; rel=\"next\"";
    let page = |id| Response::json_body(200, &json!([repo(id, "a")])).with_header("Link", next);
    let t = MockTransport::new().route(Method::Get, PAGE2, vec![page(2)]).route(
        Method::Get,
        PAGE1,
        vec![page(1)],
    );
    let gh = GitHub::new(t);
    let got: Vec<Repo> = gh.get_all(Some("t"), "/user/repos?per_page=100", 3).await.expect("ok");
    assert_eq!(got.len(), 3);
    assert_eq!(gh.transport().calls().len(), 3);
}

#[tokio::test]
async fn unauthorized_maps() {
    let t = MockTransport::new().route(
        Method::Get,
        PAGE1,
        vec![Response::json_body(401, &json!({"message": "Bad credentials"}))],
    );
    let err = list_repos(&GitHub::new(t), "bad").await.expect_err("error");
    assert!(matches!(err, Error::Unauthorized));
}

#[tokio::test]
async fn rate_limit_maps() {
    let t = MockTransport::new().route(
        Method::Get,
        PAGE1,
        vec![
            Response::json_body(403, &json!({"message": "rate limit"}))
                .with_header("x-ratelimit-remaining", "0")
                .with_header("x-ratelimit-reset", "1700000000"),
        ],
    );
    let err = list_repos(&GitHub::new(t), "t").await.expect_err("error");
    assert!(matches!(err, Error::RateLimited { reset: Some(1_700_000_000) }));
}
