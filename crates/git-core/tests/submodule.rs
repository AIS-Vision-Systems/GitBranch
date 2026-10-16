//! Tests for `ops::submodule` on fixture repositories.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::{FixtureRepo, git_in};
use git_core::ops::submodule::{SubmoduleState, list_submodules};

const ALLOW: [&str; 2] = ["-c", "protocol.file.allow=always"];

#[tokio::test]
async fn clean_submodule_has_url_and_oid() {
    let fx = FixtureRepo::with_submodule();
    let subs = list_submodules(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(subs.len(), 1);
    let s = &subs[0];
    assert_eq!(s.path, "vendor/lib");
    assert_eq!(s.state, SubmoduleState::Clean);
    assert!(s.url.as_deref().is_some_and(|u| u.contains("lib")), "{:?}", s.url);
    assert_eq!(
        s.head_oid.as_deref(),
        Some(git_in(&fx.path().join("vendor/lib"), &["rev-parse", "HEAD"]).as_str())
    );
}

#[tokio::test]
async fn moved_head_is_modified() {
    let fx = FixtureRepo::with_submodule();
    git_in(&fx.path().join("vendor/lib"), &["checkout", "-q", "HEAD~1"]);
    let subs = list_submodules(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(subs[0].state, SubmoduleState::Modified);
}

#[tokio::test]
async fn deinit_is_uninitialized() {
    let fx = FixtureRepo::with_submodule();
    fx.git(&["submodule", "deinit", "-f", "vendor/lib"]);
    let subs = list_submodules(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].state, SubmoduleState::Uninitialized);
    assert!(subs[0].head_oid.is_some());
    assert!(subs[0].url.is_some());
}

#[tokio::test]
async fn no_submodules_is_empty() {
    let fx = FixtureRepo::linear(2);
    assert!(list_submodules(&fx.runner(), fx.path()).await.unwrap().is_empty());
}

#[tokio::test]
async fn path_with_space_and_parentheses() {
    let fx = FixtureRepo::linear(1);
    let lib = FixtureRepo::linear(2);
    let lib_s = lib.path().to_string_lossy().into_owned();
    let mut args = ALLOW.to_vec();
    args.extend(["submodule", "add", "-q", &lib_s, "my lib (v2)"]);
    fx.git(&args);
    let subs = list_submodules(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].path, "my lib (v2)");
    assert_eq!(subs[0].state, SubmoduleState::Clean);
    assert!(subs[0].url.is_some());
}

#[tokio::test]
async fn gitlink_without_gitmodules_is_listed() {
    let fx = FixtureRepo::linear(1);
    let inner = fx.path().join("embedded");
    std::fs::create_dir(&inner).unwrap();
    git_in(&inner, &["init", "-q"]);
    std::fs::write(inner.join("f.txt"), "x").unwrap();
    git_in(&inner, &["add", "f.txt"]);
    git_in(&inner, &["commit", "-q", "-m", "inner"]);
    fx.git(&["add", "embedded"]);
    let subs = list_submodules(&fx.runner(), fx.path()).await.unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0].path, "embedded");
    assert_eq!(subs[0].state, SubmoduleState::Uninitialized);
    assert_eq!(subs[0].url, None);
    assert_eq!(subs[0].describe, None);
    assert_eq!(subs[0].head_oid.as_deref(), Some(git_in(&inner, &["rev-parse", "HEAD"]).as_str()));
}
