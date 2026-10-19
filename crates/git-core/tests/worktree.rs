//! Tests for `ops::worktree` on fixture repositories.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::GitErrorKind;
use git_core::fixtures::FixtureRepo;
use git_core::ops::worktree::{
    WorktreeCheckout, add_worktree, find_linked, list_worktrees, lock_worktree, prune_worktrees,
    remove_worktree, unlock_worktree,
};

fn new_branch(b: &str) -> WorktreeCheckout {
    WorktreeCheckout::New { branch: b.into(), start_point: "HEAD".into() }
}

#[tokio::test]
async fn list_has_main_only() {
    let fx = FixtureRepo::linear(3);
    let l = list_worktrees(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(l.len(), 1);
    assert!(l[0].is_main && !l[0].is_bare);
    assert_eq!(l[0].branch.as_deref(), Some("main"));
    assert_eq!(l[0].head_oid.as_deref(), Some(fx.rev_parse("HEAD").as_str()));
}

#[tokio::test]
async fn add_new_and_detached_and_list_from_linked() {
    let fx = FixtureRepo::linear(3);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    let d = tmp.path().join("d");
    add_worktree(&r, fx.path(), &a, &new_branch("feat/a"), false).await.unwrap();
    let det = WorktreeCheckout::Detached { revision: "HEAD~1".into() };
    add_worktree(&r, fx.path(), &d, &det, false).await.unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert_eq!(l.len(), 3);
    assert_eq!(l[1].branch.as_deref(), Some("feat/a"));
    assert_eq!(l[1].head_oid.as_deref(), Some(fx.rev_parse("HEAD").as_str()));
    assert!(l[2].is_detached && l[2].branch.is_none());
    assert_eq!(l[2].head_oid.as_deref(), Some(fx.rev_parse("HEAD~1").as_str()));
    let from_linked = list_worktrees(&r, &a).await.unwrap();
    assert_eq!(from_linked, l);
}

#[tokio::test]
async fn existing_checked_out_needs_force() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let w = WorktreeCheckout::Existing { branch: "main".into() };
    assert!(add_worktree(&r, fx.path(), &tmp.path().join("m"), &w, false).await.is_err());
    add_worktree(&r, fx.path(), &tmp.path().join("m"), &w, true).await.unwrap();
}

#[tokio::test]
async fn lock_unlock_and_remove_rules() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    add_worktree(&r, fx.path(), &a, &new_branch("a"), false).await.unwrap();

    lock_worktree(&r, fx.path(), &a, Some("in use")).await.unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert!(l[1].locked);
    assert_eq!(l[1].lock_reason.as_deref(), Some("in use"));
    unlock_worktree(&r, fx.path(), &a).await.unwrap();
    assert!(!list_worktrees(&r, fx.path()).await.unwrap()[1].locked);

    lock_worktree(&r, fx.path(), &a, Some("two\nlines")).await.unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert_eq!(l[1].lock_reason.as_deref(), Some("two\nlines"));
    // Locked: never removed, even with force.
    assert!(remove_worktree(&r, fx.path(), &a, false).await.is_err());
    assert!(remove_worktree(&r, fx.path(), &a, true).await.is_err());
    assert!(a.exists());
    unlock_worktree(&r, fx.path(), &a).await.unwrap();
    remove_worktree(&r, fx.path(), &a, false).await.unwrap();
    assert_eq!(list_worktrees(&r, fx.path()).await.unwrap().len(), 1);
}

#[tokio::test]
async fn remove_dirty_needs_force() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    add_worktree(&r, fx.path(), &a, &new_branch("a"), false).await.unwrap();
    std::fs::write(a.join("untracked.txt"), "x").unwrap();
    assert!(remove_worktree(&r, fx.path(), &a, false).await.is_err());
    remove_worktree(&r, fx.path(), &a, true).await.unwrap();
    assert!(!a.exists());
}

#[tokio::test]
async fn deleted_directory_is_prunable() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    add_worktree(&r, fx.path(), &a, &new_branch("a"), false).await.unwrap();
    std::fs::remove_dir_all(&a).unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert!(l[1].prunable, "{l:?}");
    prune_worktrees(&r, fx.path()).await.unwrap();
    assert_eq!(list_worktrees(&r, fx.path()).await.unwrap().len(), 1);
}

#[tokio::test]
async fn existing_branch_happy_path() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    fx.git(&["branch", "side"]);
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("side");
    let w = WorktreeCheckout::Existing { branch: "side".into() };
    add_worktree(&r, fx.path(), &a, &w, false).await.unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert_eq!(l[1].branch.as_deref(), Some("side"));
}

#[tokio::test]
async fn existing_rejects_non_branch() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    fx.git(&["tag", "v1"]);
    let tmp = tempfile::tempdir().unwrap();
    let w = WorktreeCheckout::Existing { branch: "v1".into() };
    let err = add_worktree(&r, fx.path(), &tmp.path().join("t"), &w, false).await.unwrap_err();
    assert_eq!(err.kind, GitErrorKind::ExitCode(1));
    assert_eq!(err.stderr, "branch 'v1' does not exist");
    assert!(!tmp.path().join("t").exists());
}

#[tokio::test]
async fn path_with_spaces_and_unicode() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("wt dir \u{e9}");
    add_worktree(&r, fx.path(), &a, &new_branch("u"), false).await.unwrap();
    let l = list_worktrees(&r, fx.path()).await.unwrap();
    assert_eq!(l.len(), 2);
    assert!(find_linked(&l, &a).is_some(), "{l:?}");
    remove_worktree(&r, fx.path(), &a, false).await.unwrap();
    assert!(!a.exists());
}

#[tokio::test]
async fn bare_repo_lists_bare_main() {
    let tmp = tempfile::tempdir().unwrap();
    let bare = tmp.path().join("b.git");
    let fx = FixtureRepo::linear(1);
    let r = fx.runner();
    fx.git(&["clone", "--bare", fx.path().to_str().unwrap(), bare.to_str().unwrap()]);
    let l = list_worktrees(&r, &bare).await.unwrap();
    assert_eq!(l.len(), 1);
    assert!(l[0].is_main && l[0].is_bare && l[0].head_oid.is_none());
    let a = tmp.path().join("w");
    let w = WorktreeCheckout::Existing { branch: "main".into() };
    add_worktree(&r, &bare, &a, &w, false).await.unwrap();
    assert_eq!(list_worktrees(&r, &bare).await.unwrap().len(), 2);
}

#[tokio::test]
async fn remove_from_main_cwd_of_linked_target() {
    let fx = FixtureRepo::linear(2);
    let r = fx.runner();
    let tmp = tempfile::tempdir().unwrap();
    let a = tmp.path().join("a");
    add_worktree(&r, fx.path(), &a, &new_branch("a"), false).await.unwrap();
    assert!(a.exists());
    remove_worktree(&r, fx.path(), &a, false).await.unwrap();
    assert!(!a.exists());
    assert_eq!(list_worktrees(&r, fx.path()).await.unwrap().len(), 1);
}
