//! Pull requests against the mock transport.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use github_api::http::mock::MockTransport;
use github_api::http::{Method, Response};
use github_api::pulls::{
    CheckRun, NewPull, PullState, RawReview, checks_for, create_pull, get_pull, list_pulls,
    summarize_checks, summarize_reviews,
};
use github_api::repos::RepoSlug;
use github_api::{Error, GitHub};
use serde_json::{Value, json};

fn slug() -> RepoSlug {
    RepoSlug { owner: "octo".into(), name: "hello".into() }
}

fn pull(n: u64) -> Value {
    json!({
        "number": n, "title": format!("PR {n}"), "state": "open", "draft": false,
        "merged_at": null, "user": {"login": "alice"},
        "head": {"ref": "feat", "sha": "abc123", "repo": {"full_name": "octo/hello"}},
        "base": {"ref": "main", "sha": "def", "repo": {"full_name": "octo/hello"}},
        "html_url": format!("https://github.com/octo/hello/pull/{n}"),
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z",
        "labels": [{"name": "bug"}, {"name": "ui"}]
    })
}

fn review(user: &str, state: &str) -> RawReview {
    serde_json::from_value(json!({"user": {"login": user}, "state": state})).unwrap()
}

fn run(status: &str, conclusion: Option<&str>) -> CheckRun {
    CheckRun {
        name: "ci".into(),
        status: status.into(),
        conclusion: conclusion.map(Into::into),
        html_url: None,
    }
}

#[tokio::test]
async fn list_maps_fields() {
    let mut merged = pull(2);
    merged["state"] = json!("closed");
    merged["merged_at"] = json!("2026-01-03T00:00:00Z");
    merged["draft"] = json!(true);
    merged["head"]["repo"] = Value::Null;
    merged["labels"] = json!([]);
    let t = MockTransport::new().route(
        Method::Get,
        "/repos/octo/hello/pulls?state=all&sort=updated&direction=desc&per_page=50",
        vec![Response::json_body(200, &json!([pull(1), merged]))],
    );
    let gh = GitHub::new(t);
    let list = list_pulls(&gh, "tok", &slug(), PullState::All).await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].labels, ["bug", "ui"]);
    assert_eq!(list[0].author, "alice");
    assert_eq!(list[0].head_repo.as_deref(), Some("octo/hello"));
    assert_eq!((list[0].head_ref.as_str(), list[0].base_ref.as_str()), ("feat", "main"));
    assert!(!list[0].merged && !list[0].draft);
    assert!(list[1].merged && list[1].draft);
    assert_eq!(list[1].head_repo, None);
    assert_eq!(list[1].base_repo, "octo/hello");
    let v = serde_json::to_value(&list[1]).unwrap();
    assert_eq!(v["headSha"], "abc123");
}

fn detail_mock() -> MockTransport {
    let mut p = pull(7);
    p["body"] = json!("text");
    p["mergeable"] = json!(true);
    p["mergeable_state"] = json!("clean");
    p["additions"] = json!(10);
    p["changed_files"] = json!(2);
    MockTransport::new()
        .route(Method::Get, "/repos/octo/hello/pulls/7", vec![Response::json_body(200, &p)])
        .route(
            Method::Get,
            "/pulls/7/reviews?per_page=100",
            vec![Response::json_body(
                200,
                &json!([
                    {"user": {"login": "bob"}, "state": "APPROVED"},
                    {"user": {"login": "bob"}, "state": "COMMENTED"},
                    {"user": {"login": "eve"}, "state": "CHANGES_REQUESTED"}
                ]),
            )],
        )
        .route(
            Method::Get,
            "/commits/abc123/check-runs?per_page=100",
            vec![Response::json_body(
                200,
                &json!({"total_count": 1, "check_runs": [
                    {"name": "build", "status": "completed", "conclusion": "success",
                     "html_url": "https://x/1"}
                ]}),
            )],
        )
        .route(
            Method::Get,
            "/commits/abc123/status",
            vec![Response::json_body(
                200,
                &json!({"state": "pending", "statuses": [
                    {"context": "legacy", "state": "pending", "target_url": null}
                ]}),
            )],
        )
}

#[tokio::test]
async fn get_pull_composes_three_calls() {
    let gh = GitHub::new(detail_mock());
    let d = get_pull(&gh, "tok", &slug(), 7).await.unwrap();
    assert_eq!(d.summary.number, 7);
    assert_eq!(d.body.as_deref(), Some("text"));
    assert_eq!(d.mergeable_state.as_deref(), Some("clean"));
    assert_eq!((d.additions, d.changed_files), (10, 2));
    assert_eq!((d.reviews.approved, d.reviews.changes_requested), (1, 1));
    assert_eq!(d.checks.total, 2);
    assert_eq!(d.checks.overall, "pending");
    let urls: Vec<String> = gh.transport().calls().into_iter().map(|c| c.url).collect();
    assert_eq!(urls.len(), 4);
    assert!(urls[0].ends_with("/pulls/7"));
    assert!(urls[1].contains("/pulls/7/reviews"));
    assert!(urls[2].contains("/check-runs"));
    assert!(urls[3].ends_with("/status"));
    let v = serde_json::to_value(&d).unwrap();
    assert_eq!(v["number"], 7);
    assert_eq!(v["checks"]["overall"], "pending");
}

#[tokio::test]
async fn checks_404_degrades_to_empty() {
    let missing = || Response::json_body(404, &json!({"message": "Not Found"}));
    let t = MockTransport::new()
        .route(Method::Get, "/check-runs?per_page=100", vec![missing()])
        .route(Method::Get, "/status", vec![Response::json_body(403, &json!({"message": "no"}))]);
    let gh = GitHub::new(t);
    let c = checks_for(&gh, "tok", &slug(), "abc").await.unwrap();
    assert_eq!((c.total, c.overall.as_str()), (0, "none"));
}

#[tokio::test]
async fn get_pull_survives_failing_reviews_and_checks() {
    let t = MockTransport::new()
        .route(Method::Get, "/pulls/7", vec![Response::json_body(200, &pull(7))])
        .route(Method::Get, "/reviews?per_page=100", vec![Response::json_body(500, &json!({}))])
        .route(Method::Get, "/check-runs?per_page=100", vec![Response::json_body(500, &json!({}))]);
    let gh = GitHub::new(t);
    let d = get_pull(&gh, "tok", &slug(), 7).await.unwrap();
    assert_eq!(d.reviews.reviewers.len(), 0);
    assert_eq!(d.checks.total, 0);
}

#[tokio::test]
async fn get_pull_unauthorized_in_reviews_propagates() {
    let t = MockTransport::new()
        .route(Method::Get, "/pulls/7", vec![Response::json_body(200, &pull(7))])
        .route(Method::Get, "/reviews?per_page=100", vec![Response::json_body(401, &json!({}))]);
    let gh = GitHub::new(t);
    assert!(matches!(get_pull(&gh, "tok", &slug(), 7).await, Err(Error::Unauthorized)));
}

#[test]
fn reviews_latest_state_per_user() {
    let s = summarize_reviews(&[
        review("a", "COMMENTED"),
        review("a", "APPROVED"),
        review("a", "COMMENTED"),
        review("b", "APPROVED"),
        review("b", "CHANGES_REQUESTED"),
        review("c", "COMMENTED"),
        review("d", "APPROVED"),
        review("d", "DISMISSED"),
        review("e", "CHANGES_REQUESTED"),
        review("e", "COMMENTED"),
    ]);
    let state = |l: &str| s.reviewers.iter().find(|r| r.login == l).unwrap().state.clone();
    assert_eq!(state("a"), "approved");
    assert_eq!(state("b"), "changes_requested");
    assert_eq!(state("c"), "commented");
    assert_eq!(state("d"), "dismissed");
    assert_eq!(state("e"), "changes_requested");
    assert_eq!((s.approved, s.changes_requested, s.commented), (1, 2, 1));
}

#[test]
fn checks_summary_verdicts() {
    assert_eq!(summarize_checks(vec![]).overall, "none");
    let ok = summarize_checks(vec![
        run("completed", Some("success")),
        run("completed", Some("skipped")),
    ]);
    assert_eq!((ok.overall.as_str(), ok.success, ok.skipped, ok.total), ("success", 1, 1, 2));
    let pend = summarize_checks(vec![run("completed", Some("success")), run("queued", None)]);
    assert_eq!((pend.overall.as_str(), pend.pending), ("pending", 1));
    let fail =
        summarize_checks(vec![run("in_progress", None), run("completed", Some("timed_out"))]);
    assert_eq!((fail.overall.as_str(), fail.failure), ("failure", 1));
}

#[tokio::test]
async fn check_runs_follow_next_pages() {
    let page = |name: &str| json!({"check_runs": [{"name": name, "status": "completed", "conclusion": "success"}]});
    let next =
        "<https://api.github.com/repos/octo/hello/commits/abc/check-runs?page=2>; rel=\"next\"";
    let t = MockTransport::new()
        .route(
            Method::Get,
            "/check-runs?per_page=100",
            vec![Response::json_body(200, &page("a")).with_header("link", next)],
        )
        .route(Method::Get, "/check-runs?page=2", vec![Response::json_body(200, &page("b"))])
        .route(Method::Get, "/status", vec![Response::json_body(200, &json!({"statuses": []}))]);
    let gh = GitHub::new(t);
    let c = checks_for(&gh, "tok", &slug(), "abc").await.unwrap();
    assert_eq!((c.total, c.overall.as_str()), (2, "success"));
    assert_eq!(github_api::pulls::ChecksSummary::default().overall, "none");
}

#[tokio::test]
async fn create_posts_json_and_maps_reply() {
    let t = MockTransport::new().route(
        Method::Post,
        "/repos/octo/hello/pulls",
        vec![Response::json_body(201, &pull(7))],
    );
    let gh = GitHub::new(t);
    let new = NewPull {
        title: "T".into(),
        body: Some("B".into()),
        head: "feat".into(),
        base: "main".into(),
        draft: true,
    };
    let p = create_pull(&gh, "tok", &slug(), &new).await.unwrap();
    assert_eq!((p.number, p.head_ref.as_str(), p.base_ref.as_str()), (7, "feat", "main"));
    let calls = gh.transport().calls();
    let sent: Value = serde_json::from_slice(calls[0].body.as_ref().unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({"title": "T", "body": "B", "head": "feat", "base": "main", "draft": true})
    );
}

#[tokio::test]
async fn create_422_includes_detail() {
    let body = json!({
        "message": "Validation Failed",
        "errors": [{"resource": "PullRequest", "code": "custom",
                    "message": "A pull request already exists for octo:feat."}]
    });
    let t = MockTransport::new().route(
        Method::Post,
        "/repos/octo/hello/pulls",
        vec![Response::json_body(422, &body)],
    );
    let gh = GitHub::new(t);
    let new = NewPull {
        title: "T".into(),
        body: None,
        head: "feat".into(),
        base: "main".into(),
        draft: false,
    };
    match create_pull(&gh, "tok", &slug(), &new).await {
        Err(Error::Status { status: 422, message }) => {
            assert!(message.starts_with("Validation Failed"), "{message}");
            assert!(message.contains("already exists for octo:feat"), "{message}");
        }
        other => panic!("unexpected {other:?}"),
    }
}
