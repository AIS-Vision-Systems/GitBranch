//! Tests for `ops::commit`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::ops::commit::{CommitArgs, TemplateSource, commit, commit_template, head_message};
use git_core::repo::discover;

fn args(msg: &str) -> CommitArgs {
    CommitArgs {
        message: msg.into(),
        amend: false,
        signoff: false,
        allow_empty: false,
        no_verify: false,
    }
}

#[tokio::test]
async fn commit_returns_new_head() {
    let r = FixtureRepo::linear(2);
    std::fs::write(r.path().join("n.txt"), "n\n").unwrap();
    r.git(&["add", "n.txt"]);
    let oid =
        commit(&r.runner(), r.path(), &args("add n\n\n# ignored comment\nbody")).await.unwrap();
    assert_eq!(oid, r.rev_parse("HEAD"));
    assert_eq!(r.git(&["log", "-1", "--format=%s"]), "add n");
    assert_eq!(r.git(&["rev-list", "--count", "HEAD"]), "3");
}

#[tokio::test]
async fn hash_subject_survives_cleanup() {
    let r = FixtureRepo::linear(2);
    let a = CommitArgs { allow_empty: true, ..args("#12 fix\n\n# kept too\n\n\n") };
    commit(&r.runner(), r.path(), &a).await.unwrap();
    assert_eq!(r.git(&["log", "-1", "--format=%s"]), "#12 fix");
    assert!(head_message(&r.runner(), r.path()).await.unwrap().contains("# kept too"));
}

#[tokio::test]
async fn template_strips_comment_block() {
    let r = FixtureRepo::linear(2);
    let run = r.runner();
    let info = discover(&run, r.path()).await.unwrap();
    let text = "Merge branch 'x'\n\n# Please enter a commit message to explain why.\n# Lines starting with '#' will be ignored.\n\n";
    std::fs::write(info.git_dir.join("MERGE_MSG"), text).unwrap();
    let t = commit_template(&run, &info).await.unwrap().unwrap();
    assert_eq!(t.message, "Merge branch 'x'");
}

#[tokio::test]
async fn nothing_staged_fails_unless_allow_empty() {
    let r = FixtureRepo::linear(2);
    assert!(commit(&r.runner(), r.path(), &args("x")).await.is_err());
    let a = CommitArgs { allow_empty: true, ..args("empty") };
    commit(&r.runner(), r.path(), &a).await.unwrap();
    assert_eq!(r.git(&["rev-list", "--count", "HEAD"]), "3");
}

#[tokio::test]
async fn amend_replaces_head() {
    let r = FixtureRepo::linear(2);
    let before = r.rev_parse("HEAD");
    let a = CommitArgs { amend: true, ..args("reworded") };
    let oid = commit(&r.runner(), r.path(), &a).await.unwrap();
    assert_ne!(oid, before);
    assert_eq!(r.git(&["rev-list", "--count", "HEAD"]), "2");
    assert_eq!(head_message(&r.runner(), r.path()).await.unwrap(), "reworded");
}

#[tokio::test]
async fn signoff_adds_trailer() {
    let r = FixtureRepo::linear(2);
    let a = CommitArgs { signoff: true, allow_empty: true, ..args("signed") };
    commit(&r.runner(), r.path(), &a).await.unwrap();
    assert!(r.git(&["log", "-1", "--format=%B"]).contains("Signed-off-by:"));
}

#[tokio::test]
async fn templates() {
    let r = FixtureRepo::linear(2);
    let run = r.runner();
    let info = discover(&run, r.path()).await.unwrap();
    assert_eq!(commit_template(&run, &info).await.unwrap(), None);

    let tpl = r.path().join("tpl.txt");
    std::fs::write(&tpl, "from template\n").unwrap();
    r.git(&["config", "commit.template", tpl.to_str().unwrap()]);
    let t = commit_template(&run, &info).await.unwrap().unwrap();
    assert_eq!((t.message.as_str(), t.source), ("from template", TemplateSource::ConfigTemplate));

    std::fs::write(info.git_dir.join("SQUASH_MSG"), "squash\n").unwrap();
    let t = commit_template(&run, &info).await.unwrap().unwrap();
    assert_eq!(t.source, TemplateSource::SquashMsg);

    std::fs::write(info.git_dir.join("MERGE_MSG"), "Merge x\n").unwrap();
    let t = commit_template(&run, &info).await.unwrap().unwrap();
    assert_eq!((t.message.as_str(), t.source), ("Merge x", TemplateSource::MergeMsg));
}

#[tokio::test]
async fn head_message_reads_subject_and_handles_unborn() {
    let r = FixtureRepo::linear(2);
    assert_eq!(head_message(&r.runner(), r.path()).await.unwrap(), "c2");
    let e = FixtureRepo::empty();
    assert_eq!(head_message(&e.runner(), e.path()).await.unwrap(), "");
}
