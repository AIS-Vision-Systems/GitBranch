//! Tests for `parse::diff`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::parse::diff::{DiffTarget, LineKind, file_diff, parse_unified};

const SAMPLE: &str = "diff --git a/old name.txt b/new name.txt
similarity index 80%
rename from old name.txt
rename to new name.txt
index 1111111..2222222 100644
--- a/old name.txt\t
+++ b/new name.txt\t
@@ -1,3 +1,3 @@ fn one
 keep
-gone
+added
 tail
@@ -10 +10,2 @@
-last
\\ No newline at end of file
+last
+more
";

#[test]
fn parses_hand_written_diff() {
    let d = parse_unified(SAMPLE.as_bytes()).unwrap();
    assert_eq!(d.old_path.as_deref(), Some("old name.txt"));
    assert_eq!(d.new_path.as_deref(), Some("new name.txt"));
    assert!(!d.binary);
    assert_eq!(d.hunks.len(), 2);
    let h = &d.hunks[0];
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 3, 1, 3));
    assert_eq!(h.header, "fn one");
    let v: Vec<_> = h.lines.iter().map(|l| (l.kind, l.old_no, l.new_no)).collect();
    assert_eq!(
        v,
        [
            (LineKind::Context, Some(1), Some(1)),
            (LineKind::Del, Some(2), None),
            (LineKind::Add, None, Some(2)),
            (LineKind::Context, Some(3), Some(3)),
        ]
    );
    assert_eq!(h.lines[1].text, "gone");
    let h2 = &d.hunks[1];
    assert_eq!((h2.old_start, h2.old_lines, h2.new_start, h2.new_lines), (10, 1, 10, 2));
    assert_eq!(h2.header, "");
    assert!(h2.lines[0].no_newline);
    assert!(!h2.lines[1].no_newline);
    assert_eq!(h2.lines[2].new_no, Some(11));
}

#[test]
fn empty_and_quoted_and_modes() {
    assert_eq!(parse_unified(b"").unwrap(), git_core::parse::diff::FileDiff::default());
    let q = "diff --git \"a/t\\tab \\\"q\\\".txt\" \"b/t\\tab \\\"q\\\".txt\"\nold mode 100644\nnew mode 100755\n";
    let d = parse_unified(q.as_bytes()).unwrap();
    assert_eq!(d.old_path.as_deref(), Some("t\tab \"q\".txt"));
    assert_eq!(d.new_path, d.old_path);
    assert_eq!(d.old_mode.as_deref(), Some("100644"));
    assert_eq!(d.new_mode.as_deref(), Some("100755"));
    assert!(d.hunks.is_empty());
    assert!(parse_unified(b"@@ nope\n").is_err());
}

#[tokio::test]
async fn commit_target_numbering() {
    let repo = FixtureRepo::linear(2);
    repo.commit_file("f1.txt", "a\nb\nc\nd\n", "base");
    let oid = repo.commit_file("f1.txt", "a\nB\nc\nd\ne\n", "edit");
    let t = DiffTarget::Commit { oid, path: "f1.txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
    let h = &d.hunks[0];
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (1, 4, 1, 5));
    let got: Vec<_> =
        h.lines.iter().map(|l| (l.kind, l.text.as_str(), l.old_no, l.new_no)).collect();
    assert_eq!(
        got,
        [
            (LineKind::Context, "a", Some(1), Some(1)),
            (LineKind::Del, "b", Some(2), None),
            (LineKind::Add, "B", None, Some(2)),
            (LineKind::Context, "c", Some(3), Some(3)),
            (LineKind::Context, "d", Some(4), Some(4)),
            (LineKind::Add, "e", None, Some(5)),
        ]
    );
    assert_eq!(d.new_path.as_deref(), Some("f1.txt"));
}

#[tokio::test]
async fn staged_and_unstaged() {
    let repo = FixtureRepo::linear(1);
    std::fs::write(repo.path().join("f1.txt"), "line 1\nstaged\n").unwrap();
    repo.git(&["add", "f1.txt"]);
    std::fs::write(repo.path().join("f1.txt"), "line 1\nstaged\nworking\n").unwrap();
    let r = repo.runner();
    let s =
        file_diff(&r, repo.path(), &DiffTarget::Staged { path: "f1.txt".into() }).await.unwrap();
    assert_eq!(s.hunks[0].lines.last().unwrap().text, "staged");
    assert_eq!(s.hunks[0].lines.last().unwrap().kind, LineKind::Add);
    let u =
        file_diff(&r, repo.path(), &DiffTarget::Unstaged { path: "f1.txt".into() }).await.unwrap();
    assert_eq!(u.hunks[0].lines.last().unwrap().text, "working");
    assert_eq!(u.hunks[0].lines.last().unwrap().new_no, Some(3));
}

#[tokio::test]
async fn untracked_synthetic() {
    let repo = FixtureRepo::linear(1);
    std::fs::write(repo.path().join("new.txt"), "x\ny").unwrap();
    let r = repo.runner();
    let d = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: "new.txt".into() })
        .await
        .unwrap();
    assert_eq!(d.old_path, None);
    assert_eq!(d.new_path.as_deref(), Some("new.txt"));
    let h = &d.hunks[0];
    assert_eq!((h.old_start, h.old_lines, h.new_start, h.new_lines), (0, 0, 1, 2));
    assert!(h.lines.iter().all(|l| l.kind == LineKind::Add));
    assert!(!h.lines[0].no_newline && h.lines[1].no_newline);
    std::fs::write(repo.path().join("bin.dat"), [1u8, 0, 2]).unwrap();
    let b = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: "bin.dat".into() })
        .await
        .unwrap();
    assert!(b.binary && b.hunks.is_empty());
    let bad = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: "../x".into() }).await;
    assert!(bad.is_err());
}

#[tokio::test]
async fn binary_commit() {
    let repo = FixtureRepo::linear(1);
    std::fs::write(repo.path().join("b.bin"), [0u8, 1, 2, 3]).unwrap();
    repo.git(&["add", "b.bin"]);
    repo.git(&["commit", "-q", "-m", "bin"]);
    let t = DiffTarget::Commit { oid: repo.rev_parse("HEAD"), path: "b.bin".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert!(d.binary);
    assert!(d.hunks.is_empty());
    assert_eq!(d.old_path, None);
    assert_eq!(d.new_path.as_deref(), Some("b.bin"));
}

#[tokio::test]
async fn space_and_utf8_paths_merge_and_root() {
    let repo = FixtureRepo::linear(1);
    repo.commit_file("dir/my file é.txt", "one\n", "add");
    let oid = repo.commit_file("dir/my file é.txt", "one\ntwo\n", "edit");
    let t = DiffTarget::Commit { oid, path: "dir/my file é.txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert_eq!(d.new_path.as_deref(), Some("dir/my file é.txt"));
    assert_eq!(d.hunks[0].lines.len(), 2);

    let m = FixtureRepo::merge();
    let t = DiffTarget::Commit { oid: m.rev_parse("HEAD"), path: "feat1.txt".into() };
    let d = file_diff(&m.runner(), m.path(), &t).await.unwrap();
    assert_eq!(d.hunks[0].lines[0].text, "feat 1");

    let r = FixtureRepo::orphan();
    let t = DiffTarget::Commit { oid: r.rev_parse("docs"), path: "docs.md".into() };
    let d = file_diff(&r.runner(), r.path(), &t).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
}

#[tokio::test]
async fn untracked_rejects_escapes_and_non_files() {
    let repo = FixtureRepo::linear(1);
    let r = repo.runner();
    for p in [r"\Windows\win.ini", "/etc/x", "C:foo", "../x", "./f1.txt", "", "a/../f1.txt"] {
        let res = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: p.into() }).await;
        assert!(res.is_err(), "{p} should be rejected");
    }
    std::fs::create_dir(repo.path().join("sub")).unwrap();
    let res = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: "sub".into() }).await;
    assert!(res.is_err());
    let big = std::fs::File::create(repo.path().join("big.txt")).unwrap();
    big.set_len(8 * 1024 * 1024 + 1).unwrap();
    let d = file_diff(&r, repo.path(), &DiffTarget::Untracked { path: "big.txt".into() })
        .await
        .unwrap();
    assert!(d.too_large && d.hunks.is_empty() && !d.binary);
}

#[tokio::test]
async fn conflicted_file_is_combined() {
    let repo = FixtureRepo::merge();
    repo.commit_file("c.txt", "base\n", "base c");
    repo.git(&["checkout", "-q", "-b", "side"]);
    repo.commit_file("c.txt", "side\n", "side c");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_file("c.txt", "main\n", "main c");
    let r = repo.runner();
    let merged = r.run(repo.path(), &["merge", "side"], git_core::runner::RunOpts::default()).await;
    assert!(merged.is_err());
    let t = DiffTarget::Unstaged { path: "c.txt".into() };
    let d = file_diff(&r, repo.path(), &t).await.unwrap();
    assert!(d.combined && d.hunks.is_empty());
    repo.git(&["merge", "--abort"]);
}

#[tokio::test]
async fn merge_commit_diffs_against_first_parent() {
    let repo = FixtureRepo::merge();
    let m = repo.rev_parse("HEAD");
    let t = DiffTarget::Commit { oid: m.clone(), path: "feat2.txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
    let expect = repo.git(&["diff", &format!("{m}^1"), &m, "--", "feat2.txt"]);
    assert_eq!(d, parse_unified(expect.as_bytes()).unwrap());
    // Changed only on the first-parent side: absent from the diff against it.
    let t = DiffTarget::Commit { oid: m, path: "f2.txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert!(d.hunks.is_empty());
}

#[tokio::test]
async fn literal_pathspec() {
    let repo = FixtureRepo::linear(1);
    repo.commit_file("a[1].txt", "x\n", "add");
    repo.commit_file("a1.txt", "y\n", "add other");
    let oid = repo.commit_file("a[1].txt", "x\nz\n", "edit");
    let t = DiffTarget::Commit { oid, path: "a[1].txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert_eq!(d.new_path.as_deref(), Some("a[1].txt"));
    assert_eq!(d.hunks[0].lines.len(), 2);
    std::fs::write(repo.path().join("a[1].txt"), "x\nz\nw\n").unwrap();
    let t = DiffTarget::Unstaged { path: "a[1].txt".into() };
    let d = file_diff(&repo.runner(), repo.path(), &t).await.unwrap();
    assert_eq!(d.hunks.len(), 1);
}

#[test]
fn unquote_c_escapes() {
    let q = r#""a/x\a\b\f\r\v\\\"\303\251\8.txt""#;
    let sample = format!("diff --git {q} {q}\n--- {q}\n+++ b/y\n");
    let d = parse_unified(sample.as_bytes()).unwrap();
    assert_eq!(d.old_path.as_deref(), Some("x\u{7}\u{8}\u{c}\r\u{b}\\\"\u{e9}8.txt"));
}
