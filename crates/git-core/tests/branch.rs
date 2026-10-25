//! Tests for `ops::branch`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::{FixtureRepo, git_command};
use git_core::ops::branch::{checkout, create_branch, delete_branch, rename_branch, set_upstream};

fn head_ref(fx: &FixtureRepo) -> String {
    fx.git(&["symbolic-ref", "-q", "HEAD"])
}

#[tokio::test]
async fn create_without_and_with_checkout() {
    let fx = FixtureRepo::linear(3);
    let r = fx.runner();
    create_branch(&r, fx.path(), "side", "HEAD~1", false).await.unwrap();
    assert_eq!(fx.rev_parse("side"), fx.rev_parse("HEAD~1"));
    assert_eq!(head_ref(&fx), "refs/heads/main");

    create_branch(&r, fx.path(), "work", "HEAD", true).await.unwrap();
    assert_eq!(head_ref(&fx), "refs/heads/work");

    checkout(&r, fx.path(), "main", false).await.unwrap();
    assert_eq!(head_ref(&fx), "refs/heads/main");
    assert!(create_branch(&r, fx.path(), "side", "HEAD", false).await.is_err());
}

#[tokio::test]
async fn checkout_detach() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    checkout(&r, fx.path(), "HEAD~1", true).await.unwrap();
    let out = git_command(fx.path())
        .args(["symbolic-ref", "-q", "HEAD"])
        .current_dir(fx.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert_eq!(fx.rev_parse("HEAD"), fx.rev_parse("main~1"));
}

#[tokio::test]
async fn checkout_remote_tracking_creates_local() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tip = fx.rev_parse("HEAD");
    fx.git(&["remote", "add", "origin", "."]);
    fx.git(&["update-ref", "refs/remotes/origin/feat", &tip]);
    checkout(&r, fx.path(), "origin/feat", false).await.unwrap();
    assert_eq!(head_ref(&fx), "refs/heads/feat");
    assert_eq!(fx.git(&["rev-parse", "--abbrev-ref", "feat@{upstream}"]), "origin/feat");
    // Local exists now: plain switch.
    checkout(&r, fx.path(), "main", false).await.unwrap();
    checkout(&r, fx.path(), "origin/feat", false).await.unwrap();
    assert_eq!(head_ref(&fx), "refs/heads/feat");
}

#[tokio::test]
async fn rename() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tip = fx.rev_parse("HEAD");
    create_branch(&r, fx.path(), "old", "HEAD", false).await.unwrap();
    rename_branch(&r, fx.path(), "old", "new").await.unwrap();
    assert_eq!(fx.rev_parse("new"), tip);
    assert_eq!(fx.git(&["branch", "--list", "old"]), "");
}

#[tokio::test]
async fn delete_safe_and_force() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    create_branch(&r, fx.path(), "topic", "HEAD", true).await.unwrap();
    let tip = fx.commit_file("t.txt", "t\n", "topic work");
    checkout(&r, fx.path(), "main", false).await.unwrap();

    let err = delete_branch(&r, fx.path(), "topic", false).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::ExitCode(1));
    assert!(err.stderr.contains("not fully merged"), "{}", err.stderr);
    assert_eq!(fx.rev_parse("topic"), tip);

    let d = delete_branch(&r, fx.path(), "topic", true).await.unwrap();
    assert_eq!(d.name, "topic");
    assert_eq!(d.tip, tip);
    assert_eq!(fx.git(&["branch", "--list", "topic"]), "");
}

#[tokio::test]
async fn upstream_set_and_unset() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    create_branch(&r, fx.path(), "base", "HEAD", false).await.unwrap();
    create_branch(&r, fx.path(), "topic", "HEAD", false).await.unwrap();
    set_upstream(&r, fx.path(), "topic", Some("base")).await.unwrap();
    assert_eq!(fx.git(&["rev-parse", "--abbrev-ref", "topic@{upstream}"]), "base");
    set_upstream(&r, fx.path(), "topic", None).await.unwrap();
    let out = git_command(fx.path())
        .args(["rev-parse", "--abbrev-ref", "topic@{upstream}"])
        .output()
        .unwrap();
    assert!(!out.status.success());
}
