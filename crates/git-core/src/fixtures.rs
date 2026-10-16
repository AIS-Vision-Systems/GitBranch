//! Fixture repositories built with the system `git` in temporary directories.
//!
//! Test support code: failures panic with git's stderr.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::str::FromStr;

use tempfile::TempDir;

use crate::runner::{GitRunner, SCRUB_ENV, git_path_from_env};

/// 2026-01-01T00:00:00Z as a unix timestamp.
const BASE_EPOCH: u64 = 1_767_225_600;

/// Per-repository tick counter so every git invocation gets a strictly later, deterministic
/// date (and therefore deterministic oids) regardless of which tests run in parallel.
fn next_tick(repo: &Path) -> u64 {
    let clock = repo.join(".git").join("gitbranch-clock");
    let n = std::fs::read_to_string(&clock).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    // `.git` does not exist yet during `git init`; that call gets tick 0 and is not a commit.
    let _ = std::fs::write(&clock, (n + 1).to_string());
    n
}

/// Which fixture topology to build.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `git init` only, no commits.
    Empty,
    /// `n` commits on `main`.
    Linear(usize),
    /// `main` with a `--no-ff` merge of `feature`.
    Merge,
    /// `main` with an octopus merge of `a`, `b`, `c`.
    Octopus,
    /// Two commits on `main` plus an unrelated `docs` root.
    Orphan,
    /// Three commits with a lightweight and an annotated tag.
    Tags,
    /// Two commits and one stash entry.
    Stash,
    /// Three commits on `main` pushed to a bare `origin`.
    WithRemote,
    /// One commit on `main` plus the submodule `vendor/lib` (a two-commit sibling repository).
    WithSubmodule,
}

impl FromStr for Kind {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "empty" => Ok(Kind::Empty),
            "linear" => Ok(Kind::Linear(5)),
            "merge" => Ok(Kind::Merge),
            "octopus" => Ok(Kind::Octopus),
            "orphan" => Ok(Kind::Orphan),
            "tags" => Ok(Kind::Tags),
            "stash" => Ok(Kind::Stash),
            "remote" => Ok(Kind::WithRemote),
            "submodule" => Ok(Kind::WithSubmodule),
            _ => match s.strip_prefix("linear:") {
                Some(n) => n
                    .parse::<usize>()
                    .map(Kind::Linear)
                    .map_err(|e| format!("invalid linear count '{n}': {e}")),
                None => Err(format!(
                    "unknown fixture kind '{s}' (empty, linear[:N], merge, octopus, orphan, tags, stash, remote, submodule)"
                )),
            },
        }
    }
}

/// A throwaway repository in a temp dir, deleted on drop.
pub struct FixtureRepo {
    dir: TempDir,
    path: PathBuf,
    remote: Option<PathBuf>,
}

impl FixtureRepo {
    /// Build a fixture of the given kind.
    pub fn new(kind: Kind) -> Self {
        let dir = TempDir::new().expect("fixture: create temp dir");
        if kind == Kind::WithRemote {
            let path = dir.path().join("work");
            let remote = dir.path().join("remote.git");
            std::fs::create_dir(&path).expect("fixture: create work dir");
            init(&path);
            build_with_remote(&path, &remote);
            return Self { dir, path, remote: Some(remote) };
        }
        if kind == Kind::WithSubmodule {
            let path = dir.path().join("work");
            std::fs::create_dir(&path).expect("fixture: create work dir");
            build_in(kind, &path);
            return Self { dir, path, remote: None };
        }
        let path = dir.path().to_path_buf();
        build_in(kind, &path);
        Self { dir, path, remote: None }
    }

    /// Three commits on `main`; `origin` is the bare sibling repository `remote.git`.
    pub fn with_remote() -> Self {
        Self::new(Kind::WithRemote)
    }

    /// Path of the bare `origin` repository (only for [`FixtureRepo::with_remote`]).
    pub fn remote_path(&self) -> &Path {
        self.remote.as_deref().expect("fixture: not a with_remote fixture")
    }

    /// Clones the bare `origin` into the sibling directory `name` with the fixture identity
    /// (to simulate someone else pushing) and returns its path.
    pub fn clone_of(&self, name: &str) -> PathBuf {
        let dest = self.dir.path().join(name);
        let remote = self.remote_path().to_string_lossy().into_owned();
        let dest_s = dest.to_string_lossy().into_owned();
        run(&self.path, &["clone", "-q", &remote, &dest_s]);
        config_identity(&dest);
        dest
    }

    /// Repository with no commits.
    pub fn empty() -> Self {
        Self::new(Kind::Empty)
    }

    /// Repository with `n` linear commits on `main`.
    pub fn linear(n: usize) -> Self {
        Self::new(Kind::Linear(n))
    }

    /// Repository with a two-parent merge commit.
    pub fn merge() -> Self {
        Self::new(Kind::Merge)
    }

    /// Repository with a three-parent octopus merge commit.
    pub fn octopus() -> Self {
        Self::new(Kind::Octopus)
    }

    /// Repository with an unrelated root on branch `docs`.
    pub fn orphan() -> Self {
        Self::new(Kind::Orphan)
    }

    /// Repository with lightweight and annotated tags.
    pub fn tags() -> Self {
        Self::new(Kind::Tags)
    }

    /// One commit plus the submodule `vendor/lib`; its source is the sibling directory `lib`.
    pub fn with_submodule() -> Self {
        Self::new(Kind::WithSubmodule)
    }

    /// Repository with one stash entry.
    pub fn with_stash() -> Self {
        Self::new(Kind::Stash)
    }

    /// Working tree path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Run git in the repo with isolated env; panics with stderr on non-zero exit; returns trimmed stdout.
    pub fn git(&self, args: &[&str]) -> String {
        run(&self.path, args)
    }

    /// Write `name` (relative path, parents created) with `content`, `git add`, commit with `msg`;
    /// returns the new commit oid.
    pub fn commit_file(&self, name: &str, content: &str, msg: &str) -> String {
        commit_file(&self.path, name, content, msg)
    }

    /// A [`GitRunner`] isolated from the user's global/system git config (same isolation as
    /// [`git_command`]), for exercising git-core operations against this fixture.
    pub fn runner(&self) -> GitRunner {
        isolated_runner(&self.path)
    }

    /// Resolve `rev` to an oid.
    pub fn rev_parse(&self, rev: &str) -> String {
        self.git(&["rev-parse", rev])
    }

    /// Keep the directory (for debugging / the example) and return its path.
    pub fn into_path(self) -> PathBuf {
        self.dir.keep()
    }
}

/// A [`GitRunner`] whose spawns ignore the user's global and system git config.
///
/// `dir` only anchors the non-existent config path; it need not be a repository.
pub fn isolated_runner(dir: &Path) -> GitRunner {
    let missing = dir.join("gitbranch-no-such-config").to_string_lossy().into_owned();
    GitRunner::from_env().with_env(vec![
        ("GIT_CONFIG_GLOBAL".into(), missing.clone()),
        ("GIT_CONFIG_SYSTEM".into(), missing),
        ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
    ])
}

/// The git command with isolated env applied (pub so runner tests can reuse the env).
///
/// Global/system config are pointed at non-existent files, identity and dates are fixed, and
/// each call gets a strictly later commit date.
pub fn git_command(repo: &Path) -> Command {
    let missing = repo.join(".git").join("gitbranch-no-such-config");
    let n = next_tick(repo);
    let date = format!("@{} +0000", BASE_EPOCH + n * 60);
    let mut cmd = Command::new(git_path_from_env());
    cmd.current_dir(repo);
    for key in SCRUB_ENV {
        cmd.env_remove(key);
    }
    cmd.env("GIT_CONFIG_GLOBAL", &missing)
        .env("GIT_CONFIG_SYSTEM", &missing)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "GitBranch Test")
        .env("GIT_AUTHOR_EMAIL", "test@gitbranch.invalid")
        .env("GIT_COMMITTER_NAME", "GitBranch Test")
        .env("GIT_COMMITTER_EMAIL", "test@gitbranch.invalid")
        .env("GIT_AUTHOR_DATE", &date)
        .env("GIT_COMMITTER_DATE", &date)
        .env("LC_ALL", "C")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_EDITOR", ":");
    cmd
}

/// Run git in `dir` with the fixture environment; panics on failure; returns trimmed stdout.
pub fn git_in(dir: &Path, args: &[&str]) -> String {
    run(dir, args)
}

/// Write, add and commit `name` in `dir` (any fixture-made repository); returns the commit oid.
pub fn commit_file_in(dir: &Path, name: &str, content: &str, msg: &str) -> String {
    commit_file(dir, name, content, msg)
}

fn run(dir: &Path, args: &[&str]) -> String {
    let out = git_command(dir).args(args).output().expect("fixture: spawn git");
    assert!(
        out.status.success(),
        "fixture: git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn commit_file(dir: &Path, name: &str, content: &str, msg: &str) -> String {
    let file = dir.join(name);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).expect("fixture: create parent dirs");
    }
    std::fs::write(&file, content).expect("fixture: write file");
    run(dir, &["add", "--", name]);
    run(dir, &["commit", "-q", "-m", msg]);
    run(dir, &["rev-parse", "HEAD"])
}

fn init(dir: &Path) {
    run(dir, &["init", "-q", "-b", "main"]);
    config_identity(dir);
}

fn config_identity(dir: &Path) {
    run(dir, &["config", "user.name", "GitBranch Test"]);
    run(dir, &["config", "user.email", "test@gitbranch.invalid"]);
    run(dir, &["config", "commit.gpgsign", "false"]);
    run(dir, &["config", "core.autocrlf", "false"]);
}

/// 3 commits in an initialised `work`, then a bare `bare` set up as `origin` and pushed to.
fn build_with_remote(work: &Path, bare: &Path) {
    linear(work, 3);
    let bare_s = bare.to_string_lossy().into_owned();
    run(work, &["init", "-q", "--bare", "-b", "main", &bare_s]);
    run(work, &["remote", "add", "origin", &bare_s]);
    run(work, &["push", "-q", "-u", "origin", "main"]);
}

fn linear(dir: &Path, n: usize) -> Vec<String> {
    (1..=n)
        .map(|i| commit_file(dir, &format!("f{i}.txt"), &format!("line {i}\n"), &format!("c{i}")))
        .collect()
}

/// Build a fixture of `kind` inside an existing empty directory `dir`.
pub fn build_in(kind: Kind, dir: &Path) {
    init(dir);
    match kind {
        Kind::Empty => {}
        Kind::Linear(n) => {
            linear(dir, n);
        }
        Kind::Merge => {
            linear(dir, 1);
            run(dir, &["checkout", "-q", "-b", "feature"]);
            commit_file(dir, "feat1.txt", "feat 1\n", "feat1");
            commit_file(dir, "feat2.txt", "feat 2\n", "feat2");
            run(dir, &["checkout", "-q", "main"]);
            commit_file(dir, "f2.txt", "line 2\n", "c2");
            run(dir, &["merge", "-q", "--no-ff", "feature", "-m", "merge feature"]);
        }
        Kind::Octopus => {
            linear(dir, 1);
            for b in ["a", "b", "c"] {
                run(dir, &["checkout", "-q", "-b", b, "main"]);
                commit_file(dir, &format!("{b}.txt"), &format!("{b}\n"), &format!("commit {b}"));
            }
            run(dir, &["checkout", "-q", "main"]);
            run(dir, &["merge", "-q", "--no-ff", "a", "b", "c", "-m", "octopus"]);
        }
        Kind::Orphan => {
            linear(dir, 2);
            run(dir, &["checkout", "-q", "--orphan", "docs"]);
            run(dir, &["rm", "-rfq", "."]);
            commit_file(dir, "docs.md", "docs\n", "docs1");
            run(dir, &["checkout", "-q", "main"]);
        }
        Kind::Tags => {
            let oids = linear(dir, 3);
            run(dir, &["tag", "v0.1", &oids[0]]);
            run(dir, &["tag", "-a", "v1.0", "-m", "release 1.0", &oids[2]]);
        }
        Kind::WithRemote => {
            let name =
                dir.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
            build_with_remote(dir, &dir.with_file_name(format!("{name}.remote.git")));
        }
        Kind::WithSubmodule => {
            let name =
                dir.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
            let lib = dir.with_file_name(if name == "work" {
                "lib".into()
            } else {
                format!("{name}.lib")
            });
            std::fs::create_dir_all(&lib).expect("fixture: create lib dir");
            init(&lib);
            linear(&lib, 2);
            linear(dir, 1);
            let lib_s = lib.to_string_lossy().into_owned();
            let add = ["-c", "protocol.file.allow=always", "submodule", "add", "-q", &lib_s];
            run(dir, &[add.as_slice(), &["vendor/lib"]].concat());
            run(dir, &["commit", "-q", "-m", "add submodule"]);
        }
        Kind::Stash => {
            linear(dir, 2);
            std::fs::write(dir.join("f1.txt"), "modified\n").expect("fixture: modify file");
            std::fs::write(dir.join("untracked.txt"), "new\n").expect("fixture: write untracked");
            run(dir, &["stash", "push", "-q", "-u", "-m", "wip"]);
        }
    }
}
