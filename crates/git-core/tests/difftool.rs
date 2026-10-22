//! Tests for `ops::difftool`.
#![allow(clippy::unwrap_used)] // tests

use git_core::RunOpts;
use git_core::fixtures::FixtureRepo;
use git_core::ops::difftool::{DifftoolError, empty_tree_oid, open_difftool};

fn dirty() -> FixtureRepo {
    let r = FixtureRepo::linear(1);
    r.commit_file("d.txt", "a\n", "d");
    std::fs::write(r.path().join("d.txt"), "b\n").unwrap();
    r
}

#[tokio::test]
async fn runs_the_configured_tool() {
    let r = dirty();
    let out = tempfile::tempdir().unwrap();
    // Forward slashes: git runs the command through its own sh, also on Windows.
    let marker = out.path().join("marker.txt").to_string_lossy().replace('\\', "/");
    let cmd = format!("echo \"$REMOTE\" > \"{marker}\"");
    open_difftool(&r.runner(), r.path(), "d.txt", false, None, &cmd).await.unwrap();
    assert!(std::fs::read_to_string(&marker).unwrap().contains("d.txt"));
}

#[tokio::test]
async fn staged_and_rev_variants_run() {
    let r = dirty();
    r.git(&["add", "d.txt"]);
    let out = tempfile::tempdir().unwrap();
    let marker = out.path().join("m.txt").to_string_lossy().replace('\\', "/");
    let cmd = format!("echo x > \"{marker}\"");
    open_difftool(&r.runner(), r.path(), "d.txt", true, None, &cmd).await.unwrap();
    assert!(std::path::Path::new(&marker).exists());
    std::fs::remove_file(&marker).unwrap();
    open_difftool(&r.runner(), r.path(), "d.txt", false, Some("HEAD"), &cmd).await.unwrap();
    assert!(std::path::Path::new(&marker).exists());
}

#[tokio::test]
async fn rejects_bad_input_and_failing_tools() {
    let r = dirty();
    let run = r.runner();
    let e = open_difftool(&run, r.path(), "d.txt", false, Some("--output=x"), "true").await;
    assert!(matches!(e, Err(DifftoolError::InvalidRevision(_))));
    let e = open_difftool(&run, r.path(), "d.txt", false, None, "  ").await;
    assert!(matches!(e, Err(DifftoolError::NoTool)));
    let e = open_difftool(&run, r.path(), "d.txt", false, None, "gb_no_such_tool_xyz").await;
    assert!(matches!(e, Err(DifftoolError::Git(_))));
}

#[tokio::test]
async fn commit_is_compared_with_its_first_parent() {
    let r = FixtureRepo::linear(1);
    r.commit_file("d.txt", "one\n", "add");
    let second = r.commit_file("d.txt", "two\n", "edit");
    let out = tempfile::tempdir().unwrap();
    let marker = out.path().join("m.txt").to_string_lossy().replace('\\', "/");
    // Records both sides' content.
    let cmd = format!("cat \"$LOCAL\" \"$REMOTE\" > \"{marker}\"");
    open_difftool(&r.runner(), r.path(), "d.txt", false, Some(&second), &cmd).await.unwrap();
    let got = std::fs::read_to_string(&marker).unwrap().replace("\r\n", "\n");
    assert_eq!(got, "one\ntwo\n");

    let first = r.git(&["log", "--format=%H", "--diff-filter=A", "--", "d.txt"]);
    open_difftool(&r.runner(), r.path(), "d.txt", false, Some(first.trim()), &cmd).await.unwrap();
    let got = std::fs::read_to_string(&marker).unwrap().replace("\r\n", "\n");
    assert!(got.ends_with("one\n"));
}

#[tokio::test]
async fn root_commit_uses_the_empty_tree() {
    let r = FixtureRepo::linear(1);
    let root = r.git(&["rev-list", "--max-parents=0", "HEAD"]).trim().to_string();
    let file = r.git(&["ls-tree", "-r", "--name-only", &root]).lines().next().unwrap().to_string();
    let out = tempfile::tempdir().unwrap();
    let marker = out.path().join("m.txt").to_string_lossy().replace('\\', "/");
    let cmd = format!("echo ran > \"{marker}\"");
    open_difftool(&r.runner(), r.path(), &file, false, Some(&root), &cmd).await.unwrap();
    assert!(std::path::Path::new(&marker).exists());
}

#[tokio::test]
async fn empty_tree_oid_is_the_sha1_empty_tree() {
    let r = FixtureRepo::linear(1);
    let oid = empty_tree_oid(&r.runner(), r.path()).await.unwrap();
    assert_eq!(oid, "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
}

#[tokio::test]
async fn empty_tree_oid_in_a_sha256_repo() {
    let dir = tempfile::tempdir().unwrap();
    let runner = git_core::fixtures::isolated_runner(dir.path());
    let init = runner
        .run(dir.path(), &["init", "--quiet", "--object-format=sha256"], RunOpts::default())
        .await;
    if init.is_err() {
        #[allow(clippy::print_stderr)] // test skip notice
        {
            eprintln!("skipped: git does not support --object-format=sha256");
        }
        return;
    }
    let oid = empty_tree_oid(&runner, dir.path()).await.unwrap();
    assert_eq!(oid, "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321");
}
