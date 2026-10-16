//! Tests for `ops::ignore`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use std::path::PathBuf;

use git_core::fixtures::FixtureRepo;
use git_core::ops::ignore::ignored;

#[tokio::test]
async fn filters_ignored_paths() {
    let fx = FixtureRepo::linear(1);
    std::fs::write(fx.path().join(".gitignore"), "target/\n").unwrap();
    let runner = fx.runner();
    let paths: Vec<PathBuf> =
        ["target/x", "src/a", "target/deep/y"].iter().map(Into::into).collect();
    let got = ignored(&runner, fx.path(), &paths).await.unwrap();
    assert_eq!(got, vec![PathBuf::from("target/x"), PathBuf::from("target/deep/y")]);
    let none = ignored(&runner, fx.path(), &paths[1..2]).await.unwrap();
    assert!(none.is_empty());
    assert!(ignored(&runner, fx.path(), &[]).await.unwrap().is_empty());
}
