//! Tests for `ops::config`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::ops::config::editor_command;

#[tokio::test]
async fn core_editor_is_split_into_argv() {
    let r = FixtureRepo::linear(1);
    r.git(&["config", "core.editor", "'C:/Program Files/X/x.exe' --wait"]);
    let argv = editor_command(&r.runner(), r.path()).await.unwrap().unwrap();
    assert_eq!(argv, ["C:/Program Files/X/x.exe", "--wait"]);
}
