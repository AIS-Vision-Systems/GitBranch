//! Tests for `ops::tag`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::{FixtureRepo, git_command};
use git_core::ops::tag::{TagArgs, create_tag, delete_tag};

fn args(name: &str, target: &str, message: Option<&str>, force: bool) -> TagArgs {
    TagArgs {
        name: name.into(),
        target: target.into(),
        message: message.map(str::to_string),
        force,
    }
}

#[tokio::test]
async fn lightweight_annotated_force_delete() {
    let fx = FixtureRepo::linear(3);
    let r = fx.runner();
    let p = fx.path();

    create_tag(&r, p, &args("light", "HEAD~1", None, false)).await.unwrap();
    assert_eq!(fx.git(&["cat-file", "-t", "refs/tags/light"]), "commit");
    assert_eq!(fx.rev_parse("light"), fx.rev_parse("HEAD~1"));

    create_tag(&r, p, &args("ann", "HEAD", Some("release notes\n\nbody"), false)).await.unwrap();
    assert_eq!(fx.git(&["cat-file", "-t", "refs/tags/ann"]), "tag");
    assert_eq!(fx.rev_parse("ann^{commit}"), fx.rev_parse("HEAD"));
    assert!(fx.git(&["cat-file", "-p", "refs/tags/ann"]).contains("release notes"));

    assert!(create_tag(&r, p, &args("light", "HEAD", None, false)).await.is_err());
    create_tag(&r, p, &args("light", "HEAD", None, true)).await.unwrap();
    assert_eq!(fx.rev_parse("light"), fx.rev_parse("HEAD"));

    delete_tag(&r, p, "light").await.unwrap();
    let out =
        git_command(p).args(["rev-parse", "-q", "--verify", "refs/tags/light"]).output().unwrap();
    assert!(!out.status.success());
    assert!(delete_tag(&r, p, "light").await.is_err());
}
