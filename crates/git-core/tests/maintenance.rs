//! Tests for `ops::maintenance`.
#![allow(clippy::unwrap_used)] // tests: unwrap is fine

use git_core::fixtures::FixtureRepo;
use git_core::ops::maintenance::{commit_graph_exists, write_commit_graph};

#[tokio::test]
async fn writes_commit_graph() {
    let fx = FixtureRepo::linear(3);
    let runner = fx.runner();
    let info = git_core::repo::discover(&runner, fx.path()).await.unwrap();
    assert!(!commit_graph_exists(&info));
    write_commit_graph(&runner, &info).await.unwrap();
    assert!(commit_graph_exists(&info));
}
