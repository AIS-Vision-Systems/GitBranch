//! Tests for `ops::blame`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::FixtureRepo;
use git_core::ops::blame::blame;
use git_core::parse::blame::BlameError;

fn commit_as(r: &FixtureRepo, author: &str, name: &str, content: &str, msg: &str) -> String {
    std::fs::write(r.path().join(name), content).unwrap();
    r.git(&["add", "--", name]);
    let a = format!("{author} <{author}@x.invalid>");
    r.git(&["commit", "-q", "--author", &a, "-m", msg]);
    r.rev_parse("HEAD")
}

#[tokio::test]
async fn blames_lines_across_authors_and_merges_hunks() {
    let r = FixtureRepo::empty();
    let c1 = commit_as(&r, "Ann", "f.txt", "a\nb\nc\nd\n", "first");
    let c2 = commit_as(&r, "Bob", "f.txt", "a\nB\nC\nd\n", "second");
    let b = blame(&r.runner(), r.path(), "f.txt", None).await.unwrap();
    assert_eq!(b.lines, ["a", "B", "C", "d"]);
    let got: Vec<_> =
        b.hunks.iter().map(|h| (h.oid.as_str(), h.start_line, h.line_count)).collect();
    assert_eq!(got, [(&c1[..], 1, 1), (&c2[..], 2, 2), (&c1[..], 4, 1)]);
    assert_eq!(b.hunks[0].author, "Ann");
    assert_eq!(b.hunks[1].author, "Bob");
    assert_eq!(b.hunks[1].summary, "second");
    assert_eq!(b.hunks[2].summary, "first");
    assert!(b.hunks[0].boundary && !b.hunks[1].boundary);
    assert!(b.hunks[0].author_time > 0);
    assert_eq!(b.hunks[1].path, "f.txt");
}

#[tokio::test]
async fn rev_parameter_blames_older_version() {
    let r = FixtureRepo::empty();
    let c1 = commit_as(&r, "Ann", "f.txt", "a\nb\n", "first");
    commit_as(&r, "Bob", "f.txt", "a\nX\n", "second");
    let b = blame(&r.runner(), r.path(), "f.txt", Some(&c1)).await.unwrap();
    assert_eq!(b.lines, ["a", "b"]);
    assert_eq!(b.hunks.len(), 1);
    assert_eq!(b.hunks[0].oid, c1);
    assert_eq!(b.hunks[0].line_count, 2);
}

#[tokio::test]
async fn working_tree_edit_is_not_committed_yet() {
    let r = FixtureRepo::empty();
    commit_as(&r, "Ann", "f.txt", "a\nb\nc\n", "first");
    std::fs::write(r.path().join("f.txt"), "a\nlocal\nc\n").unwrap();
    let b = blame(&r.runner(), r.path(), "f.txt", None).await.unwrap();
    assert_eq!(b.hunks.len(), 3);
    assert_eq!(b.hunks[1].author, "Not Committed Yet");
    assert!(b.hunks[1].oid.bytes().all(|c| c == b'0'));
    assert_eq!((b.hunks[1].start_line, b.hunks[1].line_count), (2, 1));
    assert_eq!(b.hunks[0].author, "Ann");
}

#[tokio::test]
async fn path_with_spaces() {
    let r = FixtureRepo::empty();
    commit_as(&r, "Ann", "my file.txt", "x\ny\n", "spaced");
    let b = blame(&r.runner(), r.path(), "my file.txt", None).await.unwrap();
    assert_eq!(b.lines, ["x", "y"]);
    assert_eq!(b.hunks[0].path, "my file.txt");
}

#[tokio::test]
async fn missing_and_untracked_files_error() {
    let r = FixtureRepo::linear(2);
    assert!(blame(&r.runner(), r.path(), "nope.txt", None).await.is_err());
    std::fs::write(r.path().join("untracked.txt"), "u\n").unwrap();
    assert!(blame(&r.runner(), r.path(), "untracked.txt", None).await.is_err());
}

#[tokio::test]
async fn unsafe_rev_is_rejected() {
    let r = FixtureRepo::linear(1);
    for rev in ["--contents=x", "", "a b"] {
        let e = blame(&r.runner(), r.path(), "c1.txt", Some(rev)).await.unwrap_err();
        assert!(matches!(e, BlameError::InvalidRevision(_)), "{rev:?}: {e}");
    }
}

#[tokio::test]
async fn rename_reports_original_path() {
    let r = FixtureRepo::empty();
    let c1 = commit_as(&r, "Ann", "old.txt", "a\nb\nc\n", "first");
    r.git(&["mv", "old.txt", "new.txt"]);
    r.git(&["commit", "-q", "-m", "rename"]);
    let b = blame(&r.runner(), r.path(), "new.txt", None).await.unwrap();
    assert_eq!(b.hunks.len(), 1);
    assert_eq!(b.hunks[0].oid, c1);
    assert_eq!(b.hunks[0].path, "old.txt");
}

#[tokio::test]
async fn empty_file_has_no_hunks() {
    let r = FixtureRepo::empty();
    commit_as(&r, "Ann", "e.txt", "", "empty");
    let b = blame(&r.runner(), r.path(), "e.txt", None).await.unwrap();
    assert!(b.hunks.is_empty() && b.lines.is_empty());
}

#[tokio::test]
async fn path_starting_with_dash() {
    let r = FixtureRepo::empty();
    let c = commit_as(&r, "Ann", "-dash.txt", "x\n", "dash");
    let b = blame(&r.runner(), r.path(), "-dash.txt", None).await.unwrap();
    assert_eq!(b.hunks[0].oid, c);
    assert_eq!(b.hunks[0].path, "-dash.txt");
}
