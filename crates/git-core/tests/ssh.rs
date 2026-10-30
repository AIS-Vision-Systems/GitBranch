//! Integration test for `ops::ssh` against a private `ssh-agent`.
//!
//! Uses the OpenSSH tools found on `PATH` (on Windows that is typically Git's MSYS OpenSSH, which
//! avoids the strict ACL checks of the native client). The test skips when they are missing.
#![allow(clippy::unwrap_used, clippy::print_stderr)] // tests; skip notes go to stderr

use std::path::{Path, PathBuf};
use std::process::Command;

use git_core::fixtures::FixtureRepo;
use git_core::ops::ssh::{
    AgentState, SshError, Tools, add_key_with, ssh_report_with, test_remote, use_windows_openssh,
};

struct Agent {
    env: Vec<(String, String)>,
}

impl Agent {
    fn start() -> Option<Self> {
        let out = Command::new("ssh-agent").arg("-s").output().ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).into_owned();
        let grab = |name: &str| {
            let start = text.find(&format!("{name}="))? + name.len() + 1;
            let end = text[start..].find(';')? + start;
            Some(text[start..end].to_string())
        };
        let env = vec![
            ("SSH_AUTH_SOCK".to_string(), grab("SSH_AUTH_SOCK")?),
            ("SSH_AGENT_PID".to_string(), grab("SSH_AGENT_PID")?),
        ];
        Some(Self { env })
    }
}

impl Drop for Agent {
    fn drop(&mut self) {
        let mut cmd = Command::new("ssh-agent");
        cmd.arg("-k");
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        let _ = cmd.output();
    }
}

fn tool_available(name: &str) -> bool {
    Command::new(name).arg("-V").output().is_ok() || Command::new(name).output().is_ok()
}

fn write_askpass(dir: &Path) -> PathBuf {
    let path = dir.join("askpass.sh");
    let script = "#!/bin/sh\ncase \"$1\" in\n  \"Enter passphrase for \"*) printf '%s\n' \"$GITBRANCH_SSH_PASSPHRASE\"; exit 0;;\n  *) exit 1;;\nesac\n";
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

#[tokio::test]
async fn report_and_add_key_with_private_agent() {
    if !tool_available("ssh-keygen") || !tool_available("ssh-add") {
        eprintln!("skipped: OpenSSH tools not installed");
        return;
    }
    let Some(agent) = Agent::start() else {
        eprintln!("skipped: cannot start ssh-agent");
        return;
    };
    let home = tempfile::tempdir().unwrap();
    let ssh_dir = home.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).unwrap();
    let key = ssh_dir.join("id_test");
    let status = Command::new("ssh-keygen")
        .args(["-q", "-t", "ed25519", "-C", "test@gitbranch", "-N", "right-pass", "-f"])
        .arg(&key)
        .status()
        .unwrap();
    assert!(status.success());
    let askpass = write_askpass(home.path());

    let tools = Tools {
        ssh_add: "ssh-add".into(),
        ssh_keygen: "ssh-keygen".into(),
        env: agent.env.clone(),
    };
    let repo = FixtureRepo::linear(1);
    let runner = repo.runner();

    let report = ssh_report_with(&tools, home.path(), &runner, Some(repo.path())).await.unwrap();
    assert_eq!(report.agent, AgentState::Ready { keys: 0 });
    assert_eq!(report.keys.len(), 1);
    let k = &report.keys[0];
    assert!(k.encrypted && !k.loaded);
    assert_eq!(k.kind, "ED25519");
    assert_eq!(k.comment, "test@gitbranch");
    assert!(k.fingerprint.starts_with("SHA256:"));

    let err = add_key_with(&tools, &key, Some("wrong-pass"), &askpass).await.unwrap_err();
    assert!(matches!(err, SshError::BadPassphrase), "{err:?}");
    let err = add_key_with(&tools, &key, None, &askpass).await.unwrap_err();
    assert!(matches!(err, SshError::BadPassphrase), "{err:?}");

    add_key_with(&tools, &key, Some("right-pass"), &askpass).await.unwrap();
    let report = ssh_report_with(&tools, home.path(), &runner, Some(repo.path())).await.unwrap();
    assert_eq!(report.agent, AgentState::Ready { keys: 1 });
    assert!(report.keys[0].loaded);

    // Unreachable agent.
    let mut dead = tools.clone();
    dead.env = vec![(
        "SSH_AUTH_SOCK".into(),
        home.path().join("nope.sock").to_string_lossy().into_owned(),
    )];
    let report = ssh_report_with(&dead, home.path(), &runner, None).await.unwrap();
    assert_eq!(report.agent, AgentState::Unreachable);
    let err = add_key_with(&dead, &key, Some("right-pass"), &askpass).await.unwrap_err();
    assert!(matches!(err, SshError::NoAgent), "{err:?}");
}

fn file_url(p: &Path) -> String {
    let p = p.to_string_lossy().replace('\\', "/");
    if p.starts_with('/') { format!("file://{p}") } else { format!("file:///{p}") }
}

#[tokio::test]
async fn test_remote_succeeds_on_a_file_remote_and_fails_on_unknown() {
    let origin = FixtureRepo::linear(1);
    let work = FixtureRepo::linear(1);
    let runner = work.runner();
    test_remote(&runner, work.path(), &file_url(origin.path())).await.unwrap();
    let missing = origin.path().join("does-not-exist");
    let err = test_remote(&runner, work.path(), &file_url(&missing)).await.unwrap_err();
    assert_ne!(err.stderr, "");
    assert!(test_remote(&runner, work.path(), "").await.is_err());
}

#[tokio::test]
async fn use_windows_openssh_writes_global_config_on_windows_only() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path().join("gitconfig");
    let runner = FixtureRepo::linear(1)
        .runner()
        .with_env(vec![("GIT_CONFIG_GLOBAL".into(), cfg.to_string_lossy().into_owned())]);
    let res = use_windows_openssh(&runner).await;
    if cfg!(windows) {
        res.unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(text.contains("sshCommand"), "{text}");
        assert!(text.to_lowercase().contains("/system32/openssh/ssh.exe"), "{text}");
        assert!(!text.contains("\\\\"), "{text}");
    } else {
        assert!(matches!(res.unwrap_err(), SshError::Failed(_)));
        assert!(!cfg.exists());
    }
}
