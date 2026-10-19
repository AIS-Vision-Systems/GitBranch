//! `checkout_pr` against a bare `origin` and a clone of it (file transport, no network).
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::{FixtureRepo, commit_file_in, git_in};
use git_core::ops::pull_request::{CheckoutPr, checkout_pr};
use git_core::ops::remote::OpCtx;

/// Fixture (clone with `origin`), a second clone to work in, a pushed `feature` branch and
/// `refs/pull/7/head` on the bare origin. Returns (fixture, clone, feature oid, pr oid).
fn setup() -> (FixtureRepo, std::path::PathBuf, String, String) {
    let fx = FixtureRepo::with_remote();
    fx.git(&["switch", "-c", "feature"]);
    let feature = fx.commit_file("f.txt", "f", "feature work");
    fx.git(&["push", "origin", "feature"]);
    fx.git(&["switch", "main"]);
    fx.git(&["switch", "-c", "pr-src"]);
    let pr = fx.commit_file("p.txt", "p", "fork work");
    fx.git(&["push", "origin", "pr-src"]);
    git_in(fx.remote_path(), &["update-ref", "refs/pull/7/head", &pr]);
    fx.git(&["switch", "main"]);
    let clone = fx.clone_of("pr-clone");
    (fx, clone, feature, pr)
}

fn same_repo() -> CheckoutPr {
    CheckoutPr { remote: "origin".into(), number: 7, head_ref: "feature".into(), same_repo: true }
}

fn fork() -> CheckoutPr {
    CheckoutPr { remote: "origin".into(), number: 7, head_ref: "x".into(), same_repo: false }
}

#[tokio::test]
async fn same_repo_creates_tracking_branch_then_reuses_it() {
    let (fx, clone, feature, _) = setup();
    let runner = fx.runner();
    let name = checkout_pr(&runner, &clone, &same_repo(), &OpCtx::noop()).await.unwrap();
    assert_eq!(name, "feature");
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]).trim(), feature);
    assert_eq!(git_in(&clone, &["branch", "--show-current"]).trim(), "feature");
    assert_eq!(git_in(&clone, &["config", "branch.feature.remote"]).trim(), "origin");
    assert_eq!(git_in(&clone, &["config", "branch.feature.merge"]).trim(), "refs/heads/feature");

    // A local commit must survive a second checkout (branch reused, not reset).
    let local = commit_file_in(&clone, "l.txt", "l", "local");
    git_in(&clone, &["switch", "main"]);
    let name = checkout_pr(&runner, &clone, &same_repo(), &OpCtx::noop()).await.unwrap();
    assert_eq!(name, "feature");
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]).trim(), local);
}

#[tokio::test]
async fn fork_creates_pr_branch_and_fast_forwards() {
    let (fx, clone, _, pr) = setup();
    let runner = fx.runner();
    let name = checkout_pr(&runner, &clone, &fork(), &OpCtx::noop()).await.unwrap();
    assert_eq!(name, "pr/7");
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]).trim(), pr);
    assert_eq!(git_in(&clone, &["branch", "--show-current"]).trim(), "pr/7");
    let up = std::process::Command::new("git")
        .args(["config", "branch.pr/7.remote"])
        .current_dir(&clone)
        .output()
        .unwrap();
    assert!(!up.status.success(), "fork branch must have no upstream");

    // The PR advances upstream; checking out again fast-forwards.
    git_in(fx.path(), &["switch", "pr-src"]);
    let newer = commit_file_in(fx.path(), "p2.txt", "p2", "more fork work");
    git_in(fx.path(), &["push", "origin", "pr-src"]);
    git_in(fx.remote_path(), &["update-ref", "refs/pull/7/head", &newer]);
    git_in(&clone, &["switch", "main"]);
    checkout_pr(&runner, &clone, &fork(), &OpCtx::noop()).await.unwrap();
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]).trim(), newer);
}

#[tokio::test]
async fn rejects_bad_names() {
    let (fx, clone, _, _) = setup();
    let runner = fx.runner();
    let mut a = same_repo();
    a.head_ref = "-x".into();
    assert!(checkout_pr(&runner, &clone, &a, &OpCtx::noop()).await.is_err());
    let mut a = same_repo();
    a.remote = "--upload-pack=x".into();
    assert!(checkout_pr(&runner, &clone, &a, &OpCtx::noop()).await.is_err());
}

#[tokio::test]
async fn dirty_worktree_blocks_the_switch() {
    let (fx, clone, _, _) = setup();
    let runner = fx.runner();
    let before = git_in(&clone, &["rev-parse", "HEAD"]);
    // Untracked file that the branch would overwrite.
    std::fs::write(clone.join("f.txt"), "mine").unwrap();
    assert!(checkout_pr(&runner, &clone, &same_repo(), &OpCtx::noop()).await.is_err());
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]), before);
    assert_eq!(git_in(&clone, &["branch", "--show-current"]).trim(), "main");
    assert_eq!(std::fs::read_to_string(clone.join("f.txt")).unwrap(), "mine");
}

#[tokio::test]
async fn rewritten_fork_head_fails_without_switching() {
    let (fx, clone, feature, _) = setup();
    let runner = fx.runner();
    checkout_pr(&runner, &clone, &fork(), &OpCtx::noop()).await.unwrap();
    git_in(&clone, &["switch", "main"]);
    let before = git_in(&clone, &["rev-parse", "HEAD"]);
    // Force-push-like rewrite: the PR head is now a commit that is not a descendant.
    git_in(fx.remote_path(), &["update-ref", "refs/pull/7/head", &feature]);
    let err = checkout_pr(&runner, &clone, &fork(), &OpCtx::noop()).await.unwrap_err();
    assert!(err.stderr.contains("rewritten"), "{err:?}");
    assert_eq!(git_in(&clone, &["rev-parse", "HEAD"]), before);
    assert_eq!(git_in(&clone, &["branch", "--show-current"]).trim(), "main");
}

#[tokio::test]
async fn fork_ref_survives_prune() {
    let (fx, clone, _, pr) = setup();
    let runner = fx.runner();
    checkout_pr(&runner, &clone, &fork(), &OpCtx::noop()).await.unwrap();
    git_in(&clone, &["fetch", "--prune", "origin"]);
    assert_eq!(git_in(&clone, &["rev-parse", "refs/pull/origin/7"]).trim(), pr);
}
