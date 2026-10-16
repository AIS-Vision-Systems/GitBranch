//! Tests for `parse::status`.
#![allow(clippy::unwrap_used, clippy::many_single_char_names)] // tests: unwrap and terse locals are fine

use git_core::fixtures::FixtureRepo;
use git_core::parse::status::{FileState, StatusEntry, parse_status, status};

fn paths<'a>(it: impl Iterator<Item = &'a StatusEntry>) -> Vec<&'a str> {
    it.map(|e| e.path.as_str()).collect()
}

#[test]
fn parses_handwritten_output() {
    let oid = "a".repeat(40);
    let h = "b".repeat(40);
    let raw = format!(
        "# branch.oid {oid}\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 M. N... 100644 100644 100644 {h} {h} staged.txt\0\
1 .M N... 100644 100644 100644 {h} {h} unstaged.txt\0\
1 A. N... 000000 100644 100644 {h} {h} added.txt\0\
1 D. N... 100644 000000 000000 {h} {h} deleted.txt\0\
1 .M S.M. 160000 160000 160000 {h} {h} sub\0\
1 M. N... 100644 100644 100644 {h} {h} with space.txt\0\
2 R. N... 100644 100644 100644 {h} {h} R100 new.txt\0old.txt\0\
u UU N... 100644 100644 100644 100644 {h} {h} {h} conflict.txt\0\
? untracked.txt\0! ignored.log\0"
    );
    let s = parse_status(raw.as_bytes()).unwrap();
    let b = s.branch.clone().unwrap();
    assert_eq!(b.oid.as_deref(), Some(oid.as_str()));
    assert_eq!(b.head.as_deref(), Some("main"));
    assert_eq!(b.upstream.as_deref(), Some("origin/main"));
    assert_eq!((b.ahead, b.behind), (2, 1));
    assert_eq!(s.entries.len(), 10);
    assert!(!s.is_clean());
    assert_eq!(s.entries[0].staged, FileState::Modified);
    assert_eq!(s.entries[0].unstaged, FileState::Unmodified);
    assert_eq!(s.entries[1].unstaged, FileState::Modified);
    assert_eq!(s.entries[2].staged, FileState::Added);
    assert_eq!(s.entries[3].staged, FileState::Deleted);
    assert!(s.entries[4].submodule && !s.entries[0].submodule);
    assert_eq!(s.entries[5].path, "with space.txt");
    let r = &s.entries[6];
    assert_eq!((r.path.as_str(), r.orig_path.as_deref()), ("new.txt", Some("old.txt")));
    assert_eq!(r.staged, FileState::Renamed);
    let u = &s.entries[7];
    assert!(u.conflicted);
    assert_eq!((u.staged, u.unstaged), (FileState::Unmerged, FileState::Unmerged));
    assert_eq!(s.entries[8].staged, FileState::Untracked);
    assert_eq!(s.entries[9].staged, FileState::Ignored);

    assert_eq!(
        paths(s.staged()),
        ["staged.txt", "added.txt", "deleted.txt", "with space.txt", "new.txt"]
    );
    assert_eq!(paths(s.unstaged()), ["unstaged.txt", "sub"]);
    assert_eq!(paths(s.untracked()), ["untracked.txt"]);
    assert_eq!(paths(s.conflicted()), ["conflict.txt"]);
}

#[test]
fn rejects_garbage() {
    assert!(parse_status(b"x what\0").is_err());
    assert!(parse_status(b"2 R. N... 1 1 1 a b R100 new\0").is_err());
}

#[tokio::test]
async fn clean_linear_repo() {
    let repo = FixtureRepo::linear(2);
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    assert!(s.is_clean());
    let b = s.branch.unwrap();
    assert_eq!(b.head.as_deref(), Some("main"));
    assert_eq!(b.oid, Some(repo.rev_parse("HEAD")));
}

#[tokio::test]
async fn real_changes() {
    let repo = FixtureRepo::linear(2);
    std::fs::write(repo.path().join("f1.txt"), "changed\n").unwrap();
    std::fs::write(repo.path().join("new.txt"), "n\n").unwrap();
    repo.git(&["add", "new.txt"]);
    std::fs::write(repo.path().join("loose.txt"), "l\n").unwrap();
    repo.git(&["mv", "f2.txt", "g2.txt"]);
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    assert_eq!(paths(s.unstaged()), ["f1.txt"]);
    assert_eq!(paths(s.untracked()), ["loose.txt"]);
    let mut staged: Vec<_> = s.staged().collect();
    staged.sort_by(|a, b| a.path.cmp(&b.path));
    assert_eq!(staged.len(), 2);
    assert_eq!((staged[0].path.as_str(), staged[0].staged), ("g2.txt", FileState::Renamed));
    assert_eq!(staged[0].orig_path.as_deref(), Some("f2.txt"));
    assert_eq!((staged[1].path.as_str(), staged[1].staged), ("new.txt", FileState::Added));
}

#[tokio::test]
async fn real_conflict() {
    let repo = FixtureRepo::merge();
    repo.git(&["checkout", "-q", "-b", "other"]);
    repo.commit_file("f1.txt", "other\n", "other edit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("f1.txt", "main\n", "main edit");
    let out = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["merge", "other"])
        .output()
        .unwrap();
    assert!(!out.status.success());
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    assert_eq!(paths(s.conflicted()), ["f1.txt"]);
    assert_eq!(s.staged().count() + s.unstaged().count(), 0);
    repo.git(&["merge", "--abort"]);
}

#[tokio::test]
async fn unborn_branch() {
    let repo = FixtureRepo::empty();
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    let b = s.branch.clone().unwrap();
    assert_eq!(b.oid, None);
    assert_eq!(b.head.as_deref(), Some("main"));
    assert!(s.is_clean());
}

#[tokio::test]
async fn detached_head() {
    let repo = FixtureRepo::linear(2);
    repo.git(&["checkout", "-q", "--detach"]);
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    assert_eq!(s.branch.unwrap().head, None);
}

#[tokio::test]
async fn upstream_ahead() {
    let repo = FixtureRepo::linear(1);
    repo.git(&["checkout", "-q", "-b", "topic"]);
    repo.git(&["branch", "--set-upstream-to=main"]);
    repo.commit_file("t.txt", "t\n", "topic commit");
    let s = status(&repo.runner(), repo.path()).await.unwrap();
    let b = s.branch.unwrap();
    assert_eq!(b.upstream.as_deref(), Some("main"));
    assert_eq!((b.ahead, b.behind), (1, 0));
}
