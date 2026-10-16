//! Tests for `ops::stage` and `ops::patch`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::ops::patch::{HunkSelection, PatchError, PatchOp, apply_selection};
use git_core::ops::stage::{discard, stage, stage_all, unstage, unstage_all};
use git_core::parse::diff::{DiffTarget, file_diff};
use git_core::parse::status::{FileState, status};

fn s(v: &str) -> Vec<String> {
    vec![v.to_string()]
}

async fn entry(r: &FixtureRepo, path: &str) -> Option<(FileState, FileState)> {
    let st = status(&r.runner(), r.path()).await.unwrap();
    st.entries.iter().find(|e| e.path == path).map(|e| (e.staged, e.unstaged))
}

fn twenty() -> String {
    (1..=20).map(|i| format!("l{i}\n")).collect::<Vec<_>>().concat()
}

/// Commits a 20-line file and changes lines 5 and 8 (one hunk with -U3).
fn two_change_fixture() -> FixtureRepo {
    let r = FixtureRepo::linear(2);
    r.commit_file("big.txt", &twenty(), "big");
    let changed = twenty().replace("l5\n", "L5\n").replace("l8\n", "L8\n");
    std::fs::write(r.path().join("big.txt"), changed).unwrap();
    r
}

fn unstaged(path: &str) -> DiffTarget {
    DiffTarget::Unstaged { path: path.into() }
}

#[tokio::test]
async fn stage_and_unstage_one_path() {
    let r = FixtureRepo::linear(2);
    std::fs::write(r.path().join("f1.txt"), "changed\n").unwrap();
    std::fs::write(r.path().join("a[1].txt"), "x\n").unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Unmodified);
    stage(&r.runner(), r.path(), &s("f1.txt")).await.unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Modified);
    stage(&r.runner(), r.path(), &s("a[1].txt")).await.unwrap();
    assert_eq!(entry(&r, "a[1].txt").await.unwrap().0, FileState::Added);
    unstage(&r.runner(), r.path(), &s("f1.txt")).await.unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Unmodified);
    stage(&r.runner(), r.path(), &[]).await.unwrap();
}

#[tokio::test]
async fn stage_deleted_and_unstage_on_unborn_head() {
    let r = FixtureRepo::linear(2);
    std::fs::remove_file(r.path().join("f1.txt")).unwrap();
    stage(&r.runner(), r.path(), &s("f1.txt")).await.unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Deleted);

    let e = FixtureRepo::empty();
    std::fs::write(e.path().join("n.txt"), "n\n").unwrap();
    stage_all(&e.runner(), e.path()).await.unwrap();
    assert_eq!(entry(&e, "n.txt").await.unwrap().0, FileState::Added);
    unstage(&e.runner(), e.path(), &s("n.txt")).await.unwrap();
    assert_eq!(entry(&e, "n.txt").await.unwrap().0, FileState::Untracked);
    stage_all(&e.runner(), e.path()).await.unwrap();
    unstage_all(&e.runner(), e.path()).await.unwrap();
    assert_eq!(entry(&e, "n.txt").await.unwrap().0, FileState::Untracked);
}

#[tokio::test]
async fn discard_tracked_and_untracked() {
    let r = FixtureRepo::linear(2);
    std::fs::write(r.path().join("f1.txt"), "changed\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "n\n").unwrap();
    std::fs::create_dir(r.path().join("dir")).unwrap();
    std::fs::write(r.path().join("dir/x.txt"), "x\n").unwrap();
    let tracked = s("f1.txt");
    let untracked = vec!["new.txt".to_string(), "dir".to_string()];
    discard(&r.runner(), r.path(), &tracked, &untracked).await.unwrap();
    assert_eq!(std::fs::read_to_string(r.path().join("f1.txt")).unwrap(), "line 1\n");
    assert!(!r.path().join("new.txt").exists());
    assert!(!r.path().join("dir").exists());
    discard(&r.runner(), r.path(), &[], &[]).await.unwrap();
}

#[tokio::test]
async fn stage_all_and_unstage_all() {
    let r = FixtureRepo::linear(2);
    std::fs::write(r.path().join("f1.txt"), "changed\n").unwrap();
    std::fs::write(r.path().join("new.txt"), "n\n").unwrap();
    stage_all(&r.runner(), r.path()).await.unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Modified);
    assert_eq!(entry(&r, "new.txt").await.unwrap().0, FileState::Added);
    unstage_all(&r.runner(), r.path()).await.unwrap();
    assert_eq!(entry(&r, "f1.txt").await.unwrap().0, FileState::Unmodified);
    assert_eq!(entry(&r, "new.txt").await.unwrap().0, FileState::Untracked);
}

#[tokio::test]
async fn hunk_stage_then_unstage_round_trip() {
    let r = two_change_fixture();
    let run = r.runner();
    let d = file_diff(&run, r.path(), &unstaged("big.txt")).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
    let sel = HunkSelection {
        target: unstaged("big.txt"),
        hunk_index: 0,
        hunk_header: d.hunks[0].header.clone(),
        lines: None,
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Stage).await.unwrap();
    assert_eq!(r.git(&["diff"]), "");
    assert!(r.git(&["diff", "--cached"]).contains("+L8"));

    let staged = DiffTarget::Staged { path: "big.txt".into() };
    let sd = file_diff(&run, r.path(), &staged).await.unwrap();
    let sel = HunkSelection {
        target: staged,
        hunk_index: 0,
        hunk_header: sd.hunks[0].header.clone(),
        lines: None,
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Unstage).await.unwrap();
    assert_eq!(r.git(&["diff", "--cached"]), "");
    assert!(r.git(&["diff"]).contains("+L8"));
}

#[tokio::test]
async fn line_level_stage_and_unstage() {
    let r = two_change_fixture();
    let run = r.runner();
    let d = file_diff(&run, r.path(), &unstaged("big.txt")).await.unwrap();
    let h = &d.hunks[0];
    // Pick the first added line only ("+L5").
    let first_add = h.lines.iter().position(|l| l.text == "L5").unwrap();
    let sel = HunkSelection {
        target: unstaged("big.txt"),
        hunk_index: 0,
        hunk_header: h.header.clone(),
        lines: Some(vec![first_add]),
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Stage).await.unwrap();
    let cached = r.git(&["diff", "--cached", "-U0"]);
    let pluses = cached.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count();
    let minuses = cached.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count();
    assert_eq!((pluses, minuses), (1, 0), "{cached}");
    assert!(cached.contains("+L5"));

    // Unstage the same single line again from the staged diff.
    let staged = DiffTarget::Staged { path: "big.txt".into() };
    let sd = file_diff(&run, r.path(), &staged).await.unwrap();
    let add = sd.hunks[0].lines.iter().position(|l| l.text == "L5").unwrap();
    let sel = HunkSelection {
        target: staged,
        hunk_index: 0,
        hunk_header: sd.hunks[0].header.clone(),
        lines: Some(vec![add]),
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Unstage).await.unwrap();
    assert_eq!(r.git(&["diff", "--cached"]), "");
}

#[tokio::test]
async fn partial_unstage_keeps_other_staged_lines() {
    let r = two_change_fixture();
    let run = r.runner();
    r.git(&["add", "big.txt"]);
    let staged = DiffTarget::Staged { path: "big.txt".into() };
    let sd = file_diff(&run, r.path(), &staged).await.unwrap();
    let add = sd.hunks[0].lines.iter().position(|l| l.text == "L5").unwrap();
    let sel = HunkSelection {
        target: staged,
        hunk_index: 0,
        hunk_header: sd.hunks[0].header.clone(),
        lines: Some(vec![add]),
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Unstage).await.unwrap();
    let cached = r.git(&["diff", "--cached", "-U0"]);
    assert!(cached.contains("+L8") && !cached.contains("+L5"), "{cached}");
}

#[tokio::test]
async fn stale_header_is_rejected() {
    let r = two_change_fixture();
    let sel = HunkSelection {
        target: unstaged("big.txt"),
        hunk_index: 0,
        hunk_header: "not the header".into(),
        lines: None,
    };
    let err = apply_selection(&r.runner(), r.path(), &sel, PatchOp::Stage).await.unwrap_err();
    assert!(matches!(err, PatchError::Stale), "{err:?}");
    // Wrong target for the op.
    let staged = HunkSelection { target: DiffTarget::Staged { path: "big.txt".into() }, ..sel };
    let err = apply_selection(&r.runner(), r.path(), &staged, PatchOp::Stage).await.unwrap_err();
    assert!(matches!(err, PatchError::Invalid(_)), "{err:?}");
}

#[tokio::test]
async fn discard_hunk_restores_content() {
    let r = two_change_fixture();
    let run = r.runner();
    let d = file_diff(&run, r.path(), &unstaged("big.txt")).await.unwrap();
    let sel = HunkSelection {
        target: unstaged("big.txt"),
        hunk_index: 0,
        hunk_header: d.hunks[0].header.clone(),
        lines: None,
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Discard).await.unwrap();
    assert_eq!(std::fs::read_to_string(r.path().join("big.txt")).unwrap(), twenty());
}

#[tokio::test]
async fn discard_single_line_keeps_the_other_change() {
    let r = two_change_fixture();
    let run = r.runner();
    let d = file_diff(&run, r.path(), &unstaged("big.txt")).await.unwrap();
    let add = d.hunks[0].lines.iter().position(|l| l.text == "L5").unwrap();
    let sel = HunkSelection {
        target: unstaged("big.txt"),
        hunk_index: 0,
        hunk_header: d.hunks[0].header.clone(),
        lines: Some(vec![add]),
    };
    apply_selection(&run, r.path(), &sel, PatchOp::Discard).await.unwrap();
    let now = std::fs::read_to_string(r.path().join("big.txt")).unwrap();
    assert!(now.contains("L8\n") && !now.contains("L5\n"), "{now}");
}
