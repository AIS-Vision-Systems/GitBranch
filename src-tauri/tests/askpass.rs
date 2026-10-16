//! Askpass mode of the app binary: only the deterministic (keyring-independent) paths.

use std::process::Command;

#[test]
fn unknown_host_prompt_exits_1_with_no_output() {
    let out = Command::new(env!("CARGO_BIN_EXE_gitbranch"))
        .env("GITBRANCH_ASKPASS", "1")
        .arg("Password for 'https://example.com': ")
        .output()
        .expect("run gitbranch");
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
}

#[test]
fn userinfo_and_port_prompt_exits_1() {
    // User-info and a port in the URL must still parse as a prompt (and be refused: not github.com).
    let out = Command::new(env!("CARGO_BIN_EXE_gitbranch"))
        .env("GITBRANCH_ASKPASS", "1")
        .arg("Username for 'https://token@gitlab.com:8443': ")
        .output()
        .expect("run gitbranch");
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
}
