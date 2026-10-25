//! Tests for `ops::conflict`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::FixtureRepo;
use git_core::ops::conflict::{Side, conflicted_files, mark_resolved, take_side};
use git_core::ops::merge::{MergeArgs, MergeMode, merge};

/// Merge of `feat` into `main` stopped on f1.txt and f2.txt.
async fn stopped() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    std::fs::write(r.path().join("f2.txt"), "feat 2\n").unwrap();
    r.commit_file("f1.txt", "feat side\n", "feat edit");
    r.git(&["commit", "-qam", "feat edit 2"]);
    r.git(&["switch", "main"]);
    std::fs::write(r.path().join("f2.txt"), "main 2\n").unwrap();
    r.commit_file("f1.txt", "main side\n", "main edit");
    r.git(&["commit", "-qam", "main edit 2"]);
    let args = MergeArgs { source: "feat".into(), mode: MergeMode::Default, message: None };
    merge(&r.runner(), r.path(), &args).await.unwrap_err();
    r
}

#[tokio::test]
async fn lists_and_resolves_conflicts() {
    let r = stopped().await;
    let runner = r.runner();
    let mut files = conflicted_files(&runner, r.path()).await.unwrap();
    files.sort();
    assert_eq!(files, ["f1.txt", "f2.txt"]);

    take_side(&runner, r.path(), &["f1.txt".into()], Side::Ours).await.unwrap();
    assert_eq!(std::fs::read_to_string(r.path().join("f1.txt")).unwrap(), "main side\n");
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), ["f2.txt"]);

    std::fs::write(r.path().join("f2.txt"), "hand merged\n").unwrap();
    mark_resolved(&runner, r.path(), &["f2.txt".into()]).await.unwrap();
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), [] as [String; 0]);
}

#[tokio::test]
async fn empty_paths_do_nothing() {
    let r = FixtureRepo::linear(1);
    let runner = r.runner();
    take_side(&runner, r.path(), &[], Side::Theirs).await.unwrap();
    mark_resolved(&runner, r.path(), &[]).await.unwrap();
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), [] as [String; 0]);
}

/// main modified f1.txt, feat deleted it; merging feat into main stops on a modify/delete conflict.
async fn modify_delete() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.git(&["switch", "-c", "feat"]);
    r.git(&["rm", "-q", "f1.txt"]);
    r.git(&["commit", "-qm", "feat deletes f1"]);
    r.git(&["switch", "main"]);
    r.commit_file("f1.txt", "main edit\n", "main edits f1");
    let args = MergeArgs { source: "feat".into(), mode: MergeMode::Default, message: None };
    merge(&r.runner(), r.path(), &args).await.unwrap_err();
    r
}

#[tokio::test]
async fn modify_delete_take_ours_keeps_the_file() {
    let r = modify_delete().await;
    let runner = r.runner();
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), ["f1.txt"]);
    take_side(&runner, r.path(), &["f1.txt".into()], Side::Ours).await.unwrap();
    assert_eq!(std::fs::read_to_string(r.path().join("f1.txt")).unwrap(), "main edit\n");
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), [] as [String; 0]);
}

#[tokio::test]
async fn modify_delete_take_theirs_deletes_the_file() {
    let r = modify_delete().await;
    let runner = r.runner();
    take_side(&runner, r.path(), &["f1.txt".into()], Side::Theirs).await.unwrap();
    assert!(!r.path().join("f1.txt").exists());
    assert_eq!(conflicted_files(&runner, r.path()).await.unwrap(), [] as [String; 0]);
    assert_eq!(r.git(&["status", "--porcelain"]), "D  f1.txt");
}
