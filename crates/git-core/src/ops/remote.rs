//! Remote operations: configure remotes, fetch, pull and push.
//!
//! Callers (the Tauri commands) must reject names starting with `-`; where git accepts `--` the
//! name is placed after it as a second line of defence. `--force` is never used anywhere:
//! forced pushes go through `--force-with-lease`.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::parse::ParseError;
pub use crate::parse::remote::{PushedRef, Remote};
use crate::parse::remote::{parse_push_porcelain, parse_remotes};
use crate::refname::is_valid_branch_name;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Timeout for network operations (D-012); progress and cancellation arrive with item 3.3.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(600);

/// Failure of [`list_remotes`].
#[derive(Debug, thiserror::Error)]
pub enum RemoteError {
    /// A git invocation failed.
    #[error(transparent)]
    Git(#[from] GitError),
    /// Output of git could not be parsed.
    #[error(transparent)]
    Parse(#[from] ParseError),
}

/// Lists configured remotes sorted by name.
///
/// # Errors
/// [`RemoteError`] if git fails or its output is malformed.
pub async fn list_remotes(runner: &GitRunner, repo: &Path) -> Result<Vec<Remote>, RemoteError> {
    let args = ["config", "-z", "--get-regexp", r"^remote\..*\.(url|pushurl)$"];
    match runner.run(repo, &args, RunOpts::default()).await {
        Ok(out) => Ok(parse_remotes(&out.stdout)?),
        // Exit 1: no matching keys, i.e. no remotes.
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

/// Adds remote `name` with fetch URL `url`.
///
/// # Errors
/// [`GitError`] if the name is invalid or taken.
pub async fn add_remote(
    runner: &GitRunner,
    repo: &Path,
    name: &str,
    url: &str,
) -> Result<(), GitError> {
    runner.run(repo, &["remote", "add", "--", name, url], RunOpts::default()).await?;
    Ok(())
}

/// Removes remote `name` with its remote-tracking branches.
///
/// # Errors
/// [`GitError`] if the remote does not exist.
pub async fn remove_remote(runner: &GitRunner, repo: &Path, name: &str) -> Result<(), GitError> {
    runner.run(repo, &["remote", "remove", "--", name], RunOpts::default()).await?;
    Ok(())
}

/// Renames remote `old` to `new`.
///
/// # Errors
/// [`GitError`] if `old` is missing or `new` is invalid/taken.
pub async fn rename_remote(
    runner: &GitRunner,
    repo: &Path,
    old: &str,
    new: &str,
) -> Result<(), GitError> {
    runner.run(repo, &["remote", "rename", "--", old, new], RunOpts::default()).await?;
    Ok(())
}

/// What to fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchArgs {
    /// One remote, or `None` for all remotes.
    pub remote: Option<String>,
    /// Delete remote-tracking branches that no longer exist on the remote.
    pub prune: bool,
    /// Also fetch all tags.
    pub tags: bool,
}

/// The `git fetch` argv for `args`.
pub fn fetch_argv(args: &FetchArgs) -> Vec<String> {
    let mut v: Vec<String> = vec!["fetch".into(), "--no-progress".into()];
    if args.prune {
        v.push("--prune".into());
    }
    if args.tags {
        v.push("--tags".into());
    }
    match &args.remote {
        Some(remote) => v.extend(["--".into(), remote.clone()]),
        None => v.push("--all".into()),
    }
    v
}

/// Fetches from one remote or all of them.
///
/// # Errors
/// [`GitError`] on network, authentication or unknown-remote failures.
pub async fn fetch(runner: &GitRunner, repo: &Path, args: &FetchArgs) -> Result<(), GitError> {
    let opts = RunOpts::network(NETWORK_TIMEOUT);
    runner.run(repo, &fetch_argv(args), opts).await?;
    Ok(())
}

/// How `pull` integrates the upstream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    /// No flag: git decides from `pull.rebase` / `pull.ff`.
    Config,
    /// `--ff-only`.
    FfOnly,
    /// `--rebase`.
    Rebase,
    /// `--no-rebase` (merge).
    Merge,
}

/// What to pull.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullArgs {
    /// Remote to pull from; `None` uses the upstream of the current branch.
    pub remote: Option<String>,
    /// Remote branch; only used together with `remote`.
    pub branch: Option<String>,
    /// Integration mode.
    pub mode: PullMode,
}

/// Outcome of a successful pull.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    /// Whether HEAD moved.
    pub changed: bool,
}

/// The `git pull` argv for `args`.
pub fn pull_argv(args: &PullArgs) -> Vec<String> {
    let mut v: Vec<String> = vec!["pull".into(), "--no-progress".into()];
    match args.mode {
        PullMode::Config => {}
        PullMode::FfOnly => v.push("--ff-only".into()),
        PullMode::Rebase => v.push("--rebase".into()),
        PullMode::Merge => v.push("--no-rebase".into()),
    }
    if let Some(remote) = &args.remote {
        v.extend(["--".into(), remote.clone()]);
        if let Some(branch) = &args.branch {
            v.push(branch.clone());
        }
    }
    v
}

async fn head_oid(runner: &GitRunner, repo: &Path) -> Option<String> {
    let args = ["rev-parse", "--verify", "--quiet", "HEAD"];
    let out = runner.run(repo, &args, RunOpts::default()).await.ok()?;
    Some(out.stdout_str().trim().to_string())
}

/// Whether `s` is safe as the branch operand of push/pull: a plain branch name, so it cannot be a
/// refspec (`+main` forces, `:main` deletes, `main:other` writes another ref).
pub fn valid_branch_arg(s: &str) -> bool {
    !s.starts_with('+') && is_valid_branch_name(s)
}

fn invalid_branch_arg() -> GitError {
    GitError {
        kind: GitErrorKind::ExitCode(129),
        stderr: "invalid branch argument".into(),
        args: Vec::new(),
    }
}

/// Fetches and integrates the upstream into the current branch.
///
/// A conflicting merge/rebase fails with [`GitErrorKind::Conflict`] and leaves the operation in
/// progress; a non-fast-forwardable `--ff-only` fails with an exit-code error.
///
/// # Errors
/// [`GitError`] on network, authentication, conflict or integration failures.
pub async fn pull(
    runner: &GitRunner,
    repo: &Path,
    args: &PullArgs,
) -> Result<PullResult, GitError> {
    if args.branch.as_deref().is_some_and(|b| !valid_branch_arg(b)) {
        return Err(invalid_branch_arg());
    }
    let before = head_oid(runner, repo).await;
    let opts = RunOpts::network(NETWORK_TIMEOUT);
    runner.run(repo, &pull_argv(args), opts).await?;
    let after = head_oid(runner, repo).await;
    Ok(PullResult { changed: before != after })
}

async fn config_value(
    runner: &GitRunner,
    repo: &Path,
    key: &str,
) -> Result<Option<String>, GitError> {
    match runner.run(repo, &["config", "--get", key], RunOpts::default()).await {
        Ok(out) => Ok(Some(out.stdout_str().trim().to_ascii_lowercase())),
        Err(e) if e.kind == GitErrorKind::ExitCode(1) => Ok(None),
        Err(e) => Err(e),
    }
}

async fn current_branch(runner: &GitRunner, repo: &Path) -> Option<String> {
    let out = runner
        .run(repo, &["symbolic-ref", "--short", "-q", "HEAD"], RunOpts::default())
        .await
        .ok()?;
    Some(out.stdout_str().trim().to_string()).filter(|b| !b.is_empty())
}

/// The pull mode implied by `pull.rebase` / `pull.ff`.
///
/// `pull.rebase` true/merges/interactive gives [`PullMode::Rebase`]; `pull.ff=only` gives
/// [`PullMode::FfOnly`]; otherwise [`PullMode::Merge`].
///
/// # Errors
/// [`GitError`] if git cannot read the configuration.
pub async fn default_pull_mode(runner: &GitRunner, repo: &Path) -> Result<PullMode, GitError> {
    let branch_key = current_branch(runner, repo).await.map(|b| format!("branch.{b}.rebase"));
    let mut rebase = None;
    if let Some(key) = branch_key {
        rebase = config_value(runner, repo, &key).await?;
    }
    if rebase.is_none() {
        rebase = config_value(runner, repo, "pull.rebase").await?;
    }
    // An empty value (`rebase` without `=`) means true.
    if rebase.is_some_and(|v| {
        matches!(
            v.as_str(),
            "" | "true" | "1" | "yes" | "on" | "merges" | "interactive" | "i" | "m"
        )
    }) {
        return Ok(PullMode::Rebase);
    }
    if config_value(runner, repo, "pull.ff").await?.as_deref() == Some("only") {
        return Ok(PullMode::FfOnly);
    }
    Ok(PullMode::Merge)
}

/// What to push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushArgs {
    /// Remote to push to.
    pub remote: String,
    /// Branch to push; `None` pushes per `push.default`.
    pub branch: Option<String>,
    /// Remote branch to update when it differs from `branch` (`<branch>:<remote_branch>`);
    /// ignored without `branch`.
    #[serde(default)]
    pub remote_branch: Option<String>,
    /// Set the branch's upstream (`--set-upstream`).
    pub set_upstream: bool,
    /// Push all tags too.
    pub tags: bool,
    /// Allow a non-fast-forward update if the remote still has the commit we last saw.
    pub force_with_lease: bool,
}

/// Outcome of a successful push.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    /// Per-ref results from `--porcelain`.
    pub refs: Vec<PushedRef>,
}

/// The `git push` argv for `args`. Never contains `--force`.
pub fn push_argv(args: &PushArgs) -> Vec<String> {
    let mut v: Vec<String> = vec!["push".into(), "--porcelain".into(), "--no-progress".into()];
    if args.set_upstream {
        v.push("--set-upstream".into());
    }
    if args.tags {
        v.push("--tags".into());
    }
    if args.force_with_lease {
        v.push("--force-with-lease".into());
        v.push("--force-if-includes".into());
    }
    v.extend(["--".into(), args.remote.clone()]);
    if let Some(branch) = &args.branch {
        match &args.remote_branch {
            Some(target) if target != branch => v.push(format!("{branch}:{target}")),
            _ => v.push(branch.clone()),
        }
    }
    v
}

/// Pushes to a remote.
///
/// # Errors
/// [`GitError`]; a refused ref update is [`GitErrorKind::Rejected`] with the rejected refs in
/// `stderr`.
pub async fn push(
    runner: &GitRunner,
    repo: &Path,
    args: &PushArgs,
) -> Result<PushResult, GitError> {
    if args.branch.as_deref().is_some_and(|b| !valid_branch_arg(b))
        || args.remote_branch.as_deref().is_some_and(|b| !valid_branch_arg(b))
    {
        return Err(invalid_branch_arg());
    }
    let opts = RunOpts::network(NETWORK_TIMEOUT);
    let out = runner.run(repo, &push_argv(args), opts).await?;
    Ok(PushResult { refs: parse_push_porcelain(&out.stdout) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argv_builders_never_force() {
        let mut all = Vec::new();
        for remote in [None, Some("origin".to_string())] {
            for flag in [false, true] {
                all.push(fetch_argv(&FetchArgs {
                    remote: remote.clone(),
                    prune: flag,
                    tags: flag,
                }));
                for mode in [PullMode::Config, PullMode::FfOnly, PullMode::Rebase, PullMode::Merge]
                {
                    let args = PullArgs { remote: remote.clone(), branch: Some("b".into()), mode };
                    all.push(pull_argv(&args));
                }
                all.push(push_argv(&PushArgs {
                    remote: "origin".into(),
                    branch: remote.clone(),
                    remote_branch: None,
                    set_upstream: flag,
                    tags: flag,
                    force_with_lease: flag,
                }));
            }
        }
        for argv in all {
            assert!(!argv.iter().any(|a| a == "--force" || a == "-f"), "{argv:?}");
        }
    }

    #[test]
    fn branch_arg_rejects_refspecs() {
        for ok in ["main", "feat/x", "v1.0"] {
            assert!(valid_branch_arg(ok), "{ok}");
        }
        for bad in ["+main", ":main", "main:other", "", "-x", "+", "a b"] {
            assert!(!valid_branch_arg(bad), "{bad}");
        }
    }

    #[test]
    fn argv_shapes() {
        let f = FetchArgs { remote: None, prune: true, tags: false };
        assert_eq!(fetch_argv(&f), ["fetch", "--no-progress", "--prune", "--all"]);
        let f = FetchArgs { remote: Some("up".into()), prune: false, tags: true };
        assert_eq!(fetch_argv(&f), ["fetch", "--no-progress", "--tags", "--", "up"]);
        let p =
            PullArgs { remote: Some("o".into()), branch: Some("m".into()), mode: PullMode::Rebase };
        assert_eq!(pull_argv(&p), ["pull", "--no-progress", "--rebase", "--", "o", "m"]);
        let p = PullArgs { remote: None, branch: Some("m".into()), mode: PullMode::Config };
        assert_eq!(pull_argv(&p), ["pull", "--no-progress"]);
        let p = PushArgs {
            remote: "o".into(),
            branch: Some("m".into()),
            remote_branch: Some("r".into()),
            set_upstream: true,
            tags: false,
            force_with_lease: true,
        };
        assert_eq!(
            push_argv(&p),
            [
                "push",
                "--porcelain",
                "--no-progress",
                "--set-upstream",
                "--force-with-lease",
                "--force-if-includes",
                "--",
                "o",
                "m:r"
            ]
        );
    }
}
