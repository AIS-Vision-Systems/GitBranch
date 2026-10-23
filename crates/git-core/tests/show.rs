//! Tests for `parse::show`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::parse::show::{ChangeKind, commit_details, parse_name_status};

#[test]
fn parses_name_status_bytes() {
    let raw = b"A\0a.txt\0M\0dir/m.txt\0D\0d.txt\0R087\0old.txt\0new.txt\0C050\0src.txt\0cp.txt\0T\0t.txt\0";
    let v = parse_name_status(raw).unwrap();
    let kinds: Vec<_> = v.iter().map(|f| f.kind).collect();
    assert_eq!(
        kinds,
        [
            ChangeKind::Added,
            ChangeKind::Modified,
            ChangeKind::Deleted,
            ChangeKind::Renamed,
            ChangeKind::Copied,
            ChangeKind::TypeChanged
        ]
    );
    assert_eq!(v[3].path, "new.txt");
    assert_eq!(v[3].orig_path.as_deref(), Some("old.txt"));
    assert_eq!(v[3].similarity, Some(87));
    assert_eq!(v[4].similarity, Some(50));
    assert_eq!(v[1].orig_path, None);
    assert!(parse_name_status(b"R087\0old\0").is_err());
    assert!(parse_name_status(b"").unwrap().is_empty());
}

#[tokio::test]
async fn linear_head_details() {
    let repo = FixtureRepo::linear(3);
    let head = repo.rev_parse("HEAD");
    let d = commit_details(&repo.runner(), repo.path(), &head).await.unwrap();
    let fmt = repo.git(&["log", "-1", "--format=%an|%ae|%at|%cn|%ce|%ct|%s|%P"]);
    let got = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        d.author_name,
        d.author_email,
        d.author_time,
        d.committer_name,
        d.committer_email,
        d.committer_time,
        d.subject,
        d.parents.join(" ")
    );
    assert_eq!(got, fmt);
    assert_eq!(d.oid, head);
    assert_eq!(d.body, "");
    assert_eq!(d.files.len(), 1);
    assert_eq!(d.files[0].path, "f3.txt");
    assert_eq!(d.files[0].kind, ChangeKind::Added);
}

#[tokio::test]
async fn modified_file_and_body() {
    let repo = FixtureRepo::linear(2);
    repo.commit_file("f1.txt", "changed\n", "tweak\n\nbody line 1\nbody line 2\n");
    let d = commit_details(&repo.runner(), repo.path(), "HEAD").await.unwrap();
    assert_eq!(d.subject, "tweak");
    assert_eq!(d.body, "body line 1\nbody line 2");
    assert_eq!(d.files[0].kind, ChangeKind::Modified);
}

#[tokio::test]
async fn merge_lists_first_parent_files() {
    let repo = FixtureRepo::merge();
    let head = repo.rev_parse("HEAD");
    let d = commit_details(&repo.runner(), repo.path(), &head).await.unwrap();
    assert_eq!(d.parents.len(), 2);
    let mut paths: Vec<_> = d.files.iter().map(|f| f.path.as_str()).collect();
    paths.sort_unstable();
    assert_eq!(paths, ["feat1.txt", "feat2.txt"]);
    assert!(d.files.iter().all(|f| f.kind == ChangeKind::Added));
}

#[tokio::test]
async fn orphan_root_lists_added_files() {
    let repo = FixtureRepo::orphan();
    let root = repo.rev_parse("docs");
    let d = commit_details(&repo.runner(), repo.path(), &root).await.unwrap();
    assert!(d.parents.is_empty());
    assert_eq!(d.files.len(), 1);
    assert_eq!(d.files[0].path, "docs.md");
    assert_eq!(d.files[0].kind, ChangeKind::Added);
}

#[tokio::test]
async fn rename_detected() {
    let repo = FixtureRepo::linear(1);
    repo.git(&["mv", "f1.txt", "renamed.txt"]);
    repo.git(&["commit", "-q", "-m", "mv"]);
    let d = commit_details(&repo.runner(), repo.path(), "HEAD").await.unwrap();
    assert_eq!(d.files[0].kind, ChangeKind::Renamed);
    assert_eq!(d.files[0].orig_path.as_deref(), Some("f1.txt"));
    assert_eq!(d.files[0].similarity, Some(100));
}

#[tokio::test]
async fn unknown_oid_errors() {
    let repo = FixtureRepo::linear(1);
    assert!(commit_details(&repo.runner(), repo.path(), "deadbeef").await.is_err());
}

#[tokio::test]
async fn co_authors_parsed_and_stripped() {
    let repo = FixtureRepo::linear(1);
    let plain = commit_details(&repo.runner(), repo.path(), &repo.rev_parse("HEAD")).await.unwrap();
    assert!(plain.co_authors.is_empty());
    repo.git(&[
        "commit",
        "--allow-empty",
        "-m",
        "Subject\n\nBody text\n\nCo-authored-by: Ann <ann@example.com>\nCo-authored-by: Bob Builder <bob@example.com>",
    ]);
    let d = commit_details(&repo.runner(), repo.path(), &repo.rev_parse("HEAD")).await.unwrap();
    let got: Vec<_> = d.co_authors.iter().map(|c| (c.name.as_str(), c.email.as_str())).collect();
    assert_eq!(got, [("Ann", "ann@example.com"), ("Bob Builder", "bob@example.com")]);
    assert_eq!(d.body, "Body text");
}
#[tokio::test]
async fn co_authors_crlf_and_lowercase_key() {
    let repo = FixtureRepo::linear(1);
    repo.git(&[
        "commit",
        "--allow-empty",
        "--cleanup=verbatim",
        "-m",
        "Subject\r\n\r\nBody text\r\n\r\nco-authored-by: Cy <cy@example.com>\r\n",
    ]);
    let d = commit_details(&repo.runner(), repo.path(), &repo.rev_parse("HEAD")).await.unwrap();
    let got: Vec<_> = d.co_authors.iter().map(|c| (c.name.as_str(), c.email.as_str())).collect();
    assert_eq!(got, [("Cy", "cy@example.com")]);
    assert_eq!(d.body, "Body text");
}
