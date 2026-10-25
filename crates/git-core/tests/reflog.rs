//! Tests for reflog parsing and `ops::reflog` undo.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::FixtureRepo;
use git_core::ops::merge::{MergeArgs, MergeMode, merge};
use git_core::ops::reflog::{UndoAction, apply_action, undo_last, undo_preview};
use git_core::ops::stash::{StashPushArgs, stash_push};
use git_core::parse::reflog::head_reflog;

#[tokio::test]
async fn reads_head_reflog() {
    let r = FixtureRepo::linear(3);
    let v = head_reflog(&r.runner(), r.path(), 2).await.unwrap();
    assert_eq!(v.len(), 2);
    assert_eq!(v[0].oid, r.rev_parse("HEAD"));
    assert_eq!(v[0].selector, "HEAD@{0}");
    assert_eq!(v[0].subject, "commit: c3");
    assert_eq!(v[1].oid, r.rev_parse("HEAD~1"));
    assert!(v[0].time >= v[1].time && v[0].time > 0);
    let empty = FixtureRepo::empty();
    assert_eq!(
        head_reflog(&empty.runner(), empty.path(), 5).await.unwrap(),
        [] as [git_core::parse::reflog::ReflogEntry; 0]
    );
}

#[tokio::test]
async fn undo_after_commit_resets_to_previous() {
    let r = FixtureRepo::linear(2);
    let prev = r.rev_parse("HEAD");
    r.commit_file("x.txt", "x\n", "extra");
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.label, "commit: extra");
    assert_eq!(info.action, UndoAction::ResetSoft { target: prev.clone() });
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), prev);
    // The undone commit's changes stay staged.
    assert_eq!(r.git(&["diff", "--cached", "--name-only"]), "x.txt");
}

#[tokio::test]
async fn undo_after_switch_goes_back() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.action, UndoAction::Checkout { target: "main".into(), detach: false });
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.git(&["branch", "--show-current"]), "main");

    // Detached checkout, then undo back to the branch.
    r.git(&["switch", "--detach", "HEAD~1"]);
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.action, UndoAction::Checkout { target: "main".into(), detach: false });
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.git(&["branch", "--show-current"]), "main");

    // Moving away from a detached HEAD goes back detached.
    let oid = r.rev_parse("HEAD");
    r.git(&["switch", "--detach", "HEAD"]);
    r.git(&["switch", "main"]);
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.action, UndoAction::Checkout { target: oid, detach: true });
}

#[tokio::test]
async fn undo_after_merge_returns_to_pre_merge_tip() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("feat1.txt", "feat\n", "feat1");
    r.git(&["switch", "main"]);
    r.commit_file("main1.txt", "main\n", "main1");
    let before = r.rev_parse("HEAD");
    let a = MergeArgs { source: "feat".into(), mode: MergeMode::Default, message: None };
    merge(&r.runner(), r.path(), &a).await.unwrap();
    assert_ne!(r.rev_parse("HEAD"), before);
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), before);
    assert_eq!(r.git(&["status", "--porcelain"]), "");
    assert!(r.path().join("main1.txt").exists());
}

#[tokio::test]
async fn redo_after_undoing_a_merge_restores_the_merge_commit() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("feat1.txt", "feat\n", "feat1");
    r.git(&["switch", "main"]);
    r.commit_file("main1.txt", "main\n", "main1");
    let a = MergeArgs { source: "feat".into(), mode: MergeMode::Default, message: None };
    merge(&r.runner(), r.path(), &a).await.unwrap();
    let merged = r.rev_parse("HEAD");
    let out = undo_last(&r.runner(), r.path()).await.unwrap();
    assert_ne!(r.rev_parse("HEAD"), merged);
    assert_eq!(out.redo, UndoAction::ResetKeep { target: merged.clone() });
    assert_eq!(out.head, r.rev_parse("HEAD"));
    assert_eq!(out.branch.as_deref(), Some("main"));
    apply_action(&r.runner(), r.path(), &out.redo).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), merged);
    assert_eq!(r.git(&["branch", "--show-current"]), "main");
}

#[tokio::test]
async fn apply_action_rejects_option_like_targets() {
    let r = FixtureRepo::linear(2);
    for action in [
        UndoAction::ResetSoft { target: "--hard".into() },
        UndoAction::ResetKeep { target: "HEAD~1".into() },
        UndoAction::Checkout { target: "-c".into(), detach: false },
        UndoAction::Checkout { target: "main".into(), detach: true },
    ] {
        assert!(apply_action(&r.runner(), r.path(), &action).await.is_err(), "{action:?}");
    }
}

#[tokio::test]
async fn nothing_to_undo_on_a_single_entry() {
    let r = FixtureRepo::linear(1);
    assert_eq!(undo_preview(&r.runner(), r.path()).await.unwrap(), None);
    assert!(undo_last(&r.runner(), r.path()).await.is_err());
}

#[tokio::test]
async fn undo_after_rebase_restores_pre_rebase_tip() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.commit_file("a.txt", "a\n", "add a");
    r.commit_file("b.txt", "b\n", "add b");
    r.git(&["switch", "main"]);
    r.commit_file("m.txt", "m\n", "main moved");
    r.git(&["switch", "feat"]);
    let before = r.rev_parse("HEAD");
    git_core::ops::rebase::rebase(&r.runner(), r.path(), "main", None).await.unwrap();
    assert_ne!(r.rev_parse("HEAD"), before);
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.action, UndoAction::ResetKeep { target: before.clone() });
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), before);
    assert_eq!(r.git(&["branch", "--show-current"]), "feat");
    assert_eq!(r.git(&["status", "--porcelain"]), "");
}

#[tokio::test]
async fn undo_after_amend_is_soft_and_keeps_changes_staged() {
    let r = FixtureRepo::linear(2);
    let before = r.rev_parse("HEAD");
    std::fs::write(r.path().join("x.txt"), "x\n").unwrap();
    r.git(&["add", "x.txt"]);
    r.git(&["commit", "--amend", "--no-edit"]);
    assert_ne!(r.rev_parse("HEAD"), before);
    let info = undo_preview(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(info.action, UndoAction::ResetSoft { target: before.clone() });
    undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), before);
    assert_eq!(r.git(&["diff", "--cached", "--name-only"]), "x.txt");
}

#[tokio::test]
async fn nothing_to_undo_after_a_stash() {
    let r = FixtureRepo::linear(2);
    std::fs::write(
        r.path().join("f1.txt"),
        "changed
",
    )
    .unwrap();
    let args = StashPushArgs {
        message: None,
        include_untracked: false,
        keep_index: false,
        paths: Vec::new(),
    };
    stash_push(&r.runner(), r.path(), &args).await.unwrap();
    // HEAD@{0} is "reset: moving to HEAD" written by stash; the branch did not move.
    assert_eq!(undo_preview(&r.runner(), r.path()).await.unwrap(), None);
}

#[tokio::test]
async fn redo_after_undoing_a_commit_restores_the_tip() {
    let r = FixtureRepo::linear(2);
    r.commit_file(
        "x.txt", "x
", "extra",
    );
    let tip = r.rev_parse("HEAD");
    let out = undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(out.head, r.rev_parse("HEAD"));
    assert_ne!(out.head, tip);
    assert_eq!(out.redo, UndoAction::ResetSoft { target: tip.clone() });
    apply_action(&r.runner(), r.path(), &out.redo).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), tip);
    assert_eq!(r.git(&["branch", "--show-current"]), "main");
}

#[tokio::test]
async fn redo_after_undoing_a_checkout_returns_to_the_branch() {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    let out = undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.git(&["branch", "--show-current"]), "main");
    assert_eq!(out.redo, UndoAction::Checkout { target: "feat".into(), detach: false });
    apply_action(&r.runner(), r.path(), &out.redo).await.unwrap();
    assert_eq!(r.git(&["branch", "--show-current"]), "feat");
}

#[tokio::test]
async fn redo_on_detached_head_returns_to_the_detached_oid() {
    let r = FixtureRepo::linear(3);
    r.git(&["switch", "--detach", "HEAD~1"]);
    let detached = r.rev_parse("HEAD");
    r.git(&["switch", "--detach", "HEAD~1"]);
    let lower = r.rev_parse("HEAD");
    let out = undo_last(&r.runner(), r.path()).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), detached);
    assert_eq!(r.git(&["branch", "--show-current"]), "");
    assert_eq!(out.redo, UndoAction::Checkout { target: lower.clone(), detach: true });
    apply_action(&r.runner(), r.path(), &out.redo).await.unwrap();
    assert_eq!(r.rev_parse("HEAD"), lower);
    assert_eq!(r.git(&["branch", "--show-current"]), "");
}
