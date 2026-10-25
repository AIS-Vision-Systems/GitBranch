//! Tests for `ops::history`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::history::{ResetMode, cherry_pick, reset, revert};

#[tokio::test]
async fn reset_modes() {
    let fx = FixtureRepo::linear(3);
    let r = fx.runner();
    let p = fx.path();
    let c3 = fx.rev_parse("HEAD");
    let c2 = fx.rev_parse("HEAD~1");

    reset(&r, p, "HEAD~1", ResetMode::Soft).await.unwrap();
    assert_eq!(fx.rev_parse("HEAD"), c2);
    assert!(fx.git(&["status", "--porcelain"]).starts_with("A  f3.txt"));

    reset(&r, p, "HEAD", ResetMode::Mixed).await.unwrap();
    assert_eq!(fx.git(&["status", "--porcelain"]), "?? f3.txt");

    reset(&r, p, &c3, ResetMode::Hard).await.unwrap();
    assert_eq!(fx.rev_parse("HEAD"), c3);
    assert_eq!(fx.git(&["status", "--porcelain"]), "");

    reset(&r, p, "HEAD~2", ResetMode::Hard).await.unwrap();
    assert!(!p.join("f3.txt").exists());
}

#[tokio::test]
async fn revert_creates_inverse_commit() {
    let fx = FixtureRepo::linear(3);
    let r = fx.runner();
    let c3 = fx.rev_parse("HEAD");
    revert(&r, fx.path(), std::slice::from_ref(&c3), false).await.unwrap();
    assert_eq!(fx.rev_parse("HEAD~1"), c3);
    assert_eq!(fx.rev_parse("HEAD^{tree}"), fx.rev_parse("HEAD~2^{tree}"));

    // no_commit leaves the change staged.
    let c2 = fx.rev_parse("HEAD~2");
    let head = fx.rev_parse("HEAD");
    revert(&r, fx.path(), &[c2], true).await.unwrap();
    assert_eq!(fx.rev_parse("HEAD"), head);
    assert_ne!(fx.git(&["status", "--porcelain"]), "");
}

#[tokio::test]
async fn revert_merge_uses_mainline_one() {
    let fx = FixtureRepo::merge();
    let r = fx.runner();
    let merge = fx.rev_parse("HEAD");
    let first_parent_tree = fx.rev_parse("HEAD^1^{tree}");
    revert(&r, fx.path(), &[merge], false).await.unwrap();
    assert_eq!(fx.rev_parse("HEAD^{tree}"), first_parent_tree);
}

#[tokio::test]
async fn cherry_pick_onto_other_branch() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let p = fx.path();
    let c2 = fx.rev_parse("HEAD");
    fx.git(&["switch", "-q", "-c", "side", "HEAD~1"]);
    cherry_pick(&r, p, std::slice::from_ref(&c2), false).await.unwrap();
    assert!(p.join("f2.txt").exists());
    assert_ne!(fx.rev_parse("HEAD"), c2);
    assert_eq!(fx.rev_parse("HEAD^{tree}"), fx.rev_parse("main^{tree}"));
    assert_eq!(fx.git(&["log", "-1", "--format=%s"]), "c2");
}

#[tokio::test]
async fn cherry_pick_merge_commit() {
    let fx = FixtureRepo::merge();
    let r = fx.runner();
    let merge = fx.rev_parse("HEAD");
    fx.git(&["switch", "-q", "-c", "side", "HEAD^1"]);
    // Already contains the first-parent side, so mainline 1 yields an empty pick; no_commit avoids
    // the "empty commit" refusal while still proving -m 1 was supplied.
    cherry_pick(&r, fx.path(), &[merge], true).await.unwrap();
}

#[tokio::test]
async fn cherry_pick_conflict() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let p = fx.path();
    let c2 = fx.rev_parse("HEAD");
    fx.git(&["switch", "-q", "-c", "side", "HEAD~1"]);
    fx.commit_file("f2.txt", "other\n", "side f2");
    let err = cherry_pick(&r, p, &[c2], false).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::Conflict, "{err:?}");
    assert!(p.join(".git").join("CHERRY_PICK_HEAD").exists());
}
