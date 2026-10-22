//! `git clone` with progress and cancellation.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::ops::remote::{OpCtx, valid_branch_arg};
use crate::parse::progress::parse_progress_line;
use crate::refname::has_http_userinfo;
use crate::{GitError, GitErrorKind, GitRunner, RunOpts};

/// Timeout for a clone: far longer than other network operations, repositories can be large.
pub const CLONE_TIMEOUT: Duration = Duration::from_secs(3600);

/// What to clone and where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneArgs {
    /// Source URL or local path.
    pub url: String,
    /// Absolute destination directory; must not exist or be empty.
    pub dest: String,
    /// Branch to check out (`--branch`).
    pub branch: Option<String>,
    /// Shallow clone depth (`--depth`).
    pub depth: Option<u32>,
    /// Also clone submodules (`--recurse-submodules`).
    pub recurse_submodules: bool,
}

/// The `git clone` argv for `args`; the URL and destination come after `--`.
pub fn clone_argv(args: &CloneArgs) -> Vec<String> {
    let mut v: Vec<String> = vec!["clone".into(), "--progress".into()];
    if let Some(b) = &args.branch {
        v.extend(["--branch".into(), b.clone()]);
    }
    if let Some(d) = args.depth {
        v.extend(["--depth".into(), d.to_string()]);
    }
    if args.recurse_submodules {
        v.push("--recurse-submodules".into());
    }
    v.extend(["--".into(), args.url.clone(), args.dest.clone()]);
    v
}

fn invalid(what: &str) -> GitError {
    GitError {
        kind: GitErrorKind::ExitCode(129),
        stderr: format!("invalid clone argument: {what}"),
        args: Vec::new(),
    }
}

/// Whether `dest` is missing or an empty directory.
pub fn dest_is_free(dest: &Path) -> bool {
    match std::fs::read_dir(dest) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => !dest.exists(),
    }
}

/// Clones `args.url` into `args.dest` and returns the destination.
///
/// On failure or cancellation the destination is removed again if this call created it.
///
/// # Errors
/// [`GitError`] on invalid arguments, a non-free destination, or any git failure
/// ([`GitErrorKind::Cancelled`] when cancelled).
pub async fn clone(r: &GitRunner, args: &CloneArgs, ctx: &OpCtx) -> Result<PathBuf, GitError> {
    if args.url.is_empty() || args.url.starts_with('-') || args.url.chars().any(char::is_control) {
        return Err(invalid("url"));
    }
    if has_http_userinfo(&args.url) {
        return Err(GitError {
            kind: GitErrorKind::ExitCode(129),
            stderr: "credentials in URL are not allowed; the token lives in the keyring".into(),
            args: Vec::new(),
        });
    }
    if args.branch.as_deref().is_some_and(|b| !valid_branch_arg(b)) {
        return Err(invalid("branch"));
    }
    if args.depth == Some(0) {
        return Err(invalid("depth"));
    }
    let dest = PathBuf::from(&args.dest);
    if !dest.is_absolute() {
        return Err(invalid("destination"));
    }
    if !dest_is_free(&dest) {
        return Err(GitError {
            kind: GitErrorKind::ExitCode(128),
            stderr: "destination already exists and is not empty".into(),
            args: Vec::new(),
        });
    }
    let Some(parent) = dest.parent() else { return Err(invalid("destination")) };
    if !parent.is_dir() {
        return Err(GitError {
            kind: GitErrorKind::ExitCode(129),
            stderr: format!("parent directory {} does not exist", parent.display()),
            args: Vec::new(),
        });
    }
    // `create_dir` fails if `dest` appeared meanwhile, closing the check-then-act race.
    let created = if dest.exists() {
        false
    } else {
        std::fs::create_dir(&dest).map_err(|e| GitError {
            kind: GitErrorKind::ExitCode(128),
            stderr: format!("cannot create {}: {e}", dest.display()),
            args: Vec::new(),
        })?;
        true
    };

    let mut sink = |line: &str| {
        if let Some(p) = parse_progress_line(line) {
            (ctx.progress)(p);
        }
    };
    let opts = RunOpts::network(CLONE_TIMEOUT);
    let argv = clone_argv(args);
    // Boxed: the streaming future is large.
    let res = Box::pin(r.run_streaming(parent, &argv, opts, &mut sink, &ctx.cancel)).await;
    match res {
        Ok(_) => Ok(dest),
        Err(mut e) => {
            if !cleanup(&dest, created).await {
                if !e.stderr.is_empty() && !e.stderr.ends_with('\n') {
                    e.stderr.push('\n');
                }
                e.stderr.push_str("partial clone left at ");
                e.stderr.push_str(&dest.display().to_string());
            }
            Err(e)
        }
    }
}

/// Timeout for listing remote branches (interactive: the clone dialog waits for it).
pub const LS_REMOTE_TIMEOUT: Duration = Duration::from_secs(20);

/// Branches of a remote, for the clone dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHeads {
    /// Branch `HEAD` points to on the remote, when advertised.
    pub default_branch: Option<String>,
    /// All branch names, sorted, with the default branch first.
    pub branches: Vec<String>,
}

/// Parses `git ls-remote --symref <url> HEAD refs/heads/*` output.
///
/// Branch names that are not valid UTF-8 are decoded lossily.
pub fn parse_ls_remote(bytes: &[u8]) -> RemoteHeads {
    let text = String::from_utf8_lossy(bytes);
    let mut default_branch = None;
    let mut branches: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
            if let Some((name, target)) = rest.split_once('\t') {
                if target == "HEAD" {
                    default_branch = Some(name.to_string());
                }
            }
        } else if let Some((_oid, name)) = line.split_once('\t') {
            if let Some(b) = name.strip_prefix("refs/heads/") {
                branches.push(b.to_string());
            }
        }
    }
    branches.sort();
    branches.dedup();
    if let Some(d) = &default_branch {
        if let Some(pos) = branches.iter().position(|b| b == d) {
            let first = branches.remove(pos);
            branches.insert(0, first);
        }
    }
    RemoteHeads { default_branch, branches }
}

/// Whether `url` is a remote spec `list_remote_heads` accepts: `scheme://...`, `ext::...` (left
/// to git, which refuses it), scp-like `[user@]host:path`, or an absolute local path. Bare words
/// and relative paths are rejected so they cannot resolve against the working directory or a
/// `remote.<name>` entry of the global configuration.
fn valid_remote_spec(url: &str) -> bool {
    if Path::new(url).is_absolute() || url.contains("://") || url.starts_with("ext::") {
        return true;
    }
    match url.split_once(':') {
        // A one-letter host is a Windows drive (`C:foo`), not a host.
        Some((host, path)) => {
            let host = host.rsplit('@').next().unwrap_or(host);
            host.len() > 1
                && !host.contains('/')
                && !host.contains('\\')
                && !path.is_empty()
                && !path.starts_with(':')
        }
        None => false,
    }
}

/// Lists the branches of the remote at `url` (`git ls-remote --symref`).
///
/// Uses the same URL checks and askpass bridge as [`clone`], so private GitHub repositories
/// work, but never prompts (Git Credential Manager is told to stay non-interactive); the `ext::`
/// transport is refused. `cancel` kills git and fails with [`GitErrorKind::Cancelled`].
///
/// # Errors
/// [`GitError`] on an invalid URL or any git failure (unreachable, auth, timeout, cancelled).
pub async fn list_remote_heads(
    r: &GitRunner,
    url: &str,
    cancel: &CancellationToken,
) -> Result<RemoteHeads, GitError> {
    if url.is_empty() || url.starts_with('-') || url.chars().any(char::is_control) {
        return Err(invalid("url"));
    }
    if has_http_userinfo(url) {
        return Err(GitError {
            kind: GitErrorKind::ExitCode(129),
            stderr: "credentials in URL are not allowed; the token lives in the keyring".into(),
            args: Vec::new(),
        });
    }
    if !valid_remote_spec(url) {
        return Err(invalid("url (expected scheme://..., user@host:path or an absolute path)"));
    }
    let argv = [
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "credential.interactive=false",
        "ls-remote",
        "--symref",
        "--",
        url,
        "HEAD",
        "refs/heads/*",
    ];
    let cwd = std::env::temp_dir();
    let mut opts = RunOpts::network(LS_REMOTE_TIMEOUT);
    opts.env.push(("GCM_INTERACTIVE".into(), "never".into()));
    opts.env.push(("GIT_CEILING_DIRECTORIES".into(), cwd.to_string_lossy().into_owned()));
    // Dropping the run future kills the child.
    let out = tokio::select! {
        res = r.run(&cwd, &argv, opts) => res?,
        () = cancel.cancelled() => {
            return Err(GitError {
                kind: GitErrorKind::Cancelled,
                stderr: "cancelled".into(),
                args: Vec::new(),
            });
        }
    };
    Ok(parse_ls_remote(&out.stdout))
}

/// Removes the partial clone (the directory if `created`, else only its contents), retrying
/// because on Windows `index-pack` may still hold files right after the kill. Returns success.
async fn cleanup(dest: &Path, created: bool) -> bool {
    for attempt in 0..5 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let ok = if created {
            std::fs::remove_dir_all(dest).is_ok() || !dest.exists()
        } else {
            empty_dir(dest).is_ok()
        };
        if ok {
            return true;
        }
    }
    false
}

fn empty_dir(dir: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() && !path.is_symlink() {
            std::fs::remove_dir_all(&path)?;
        } else {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ls_remote() {
        let out = b"ref: refs/heads/main\tHEAD\n1111\trefs/heads/zeta\n2222\trefs/heads/main\n3333\trefs/heads/dev/x\n";
        let h = parse_ls_remote(out);
        assert_eq!(h.default_branch.as_deref(), Some("main"));
        assert_eq!(h.branches, ["main", "dev/x", "zeta"]);
        let empty = parse_ls_remote(b"");
        assert_eq!(empty, RemoteHeads { default_branch: None, branches: vec![] });
        // HEAD line (non --heads) and tags are ignored.
        let h = parse_ls_remote(b"aaaa\tHEAD\nbbbb\trefs/tags/v1\ncccc\trefs/heads/a\n");
        assert_eq!(h.default_branch, None);
        assert_eq!(h.branches, ["a"]);
    }

    #[test]
    fn argv_shape_and_no_credentials() {
        let a = CloneArgs {
            url: "https://example.invalid/r.git".into(),
            dest: "/tmp/r".into(),
            branch: Some("dev".into()),
            depth: Some(1),
            recurse_submodules: true,
        };
        assert_eq!(
            clone_argv(&a),
            [
                "clone",
                "--progress",
                "--branch",
                "dev",
                "--depth",
                "1",
                "--recurse-submodules",
                "--",
                "https://example.invalid/r.git",
                "/tmp/r"
            ]
        );
        let plain = CloneArgs { branch: None, depth: None, recurse_submodules: false, ..a };
        assert_eq!(clone_argv(&plain)[..3], ["clone", "--progress", "--"]);
    }
}
