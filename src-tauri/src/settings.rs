//! Persisted application settings (`settings.json` next to `recent.json`).

use std::path::{Path, PathBuf};

use git_core::parse::diff::DiffOptions;
use serde::{Deserialize, Serialize};

use crate::AppError;

/// Largest accepted number of diff context lines.
pub const MAX_CONTEXT_LINES: u32 = 100;
/// Shortest and longest accepted auto-fetch interval in seconds; 0 turns auto-fetch off (D-042).
pub const AUTO_FETCH_SECS: std::ops::RangeInclusive<u32> = 5..=3600;

/// Keeps 0 (off) and clamps any other interval into [`AUTO_FETCH_SECS`].
fn clamp_auto_fetch(secs: u32) -> u32 {
    if secs == 0 { 0 } else { secs.clamp(*AUTO_FETCH_SECS.start(), *AUTO_FETCH_SECS.end()) }
}

/// How `pull` integrates remote changes by default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PullStrategy {
    /// Follow git's own `pull.rebase` / `pull.ff` configuration.
    #[default]
    Config,
    /// Merge.
    Merge,
    /// Rebase.
    Rebase,
    /// Fast-forward only.
    FfOnly,
}

/// User preferences. Missing fields take their defaults, so older files keep loading.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Path of the git executable; `None` uses `GITBRANCH_GIT` or `git` on `PATH`. Read at startup.
    pub git_path: Option<String>,
    /// Default pull strategy.
    pub pull_strategy: PullStrategy,
    /// Context lines in diffs (0..=100).
    pub diff_context_lines: u32,
    /// Ignore whitespace when diffing (`-w`).
    pub diff_ignore_whitespace: bool,
    /// Editor command overriding `core.editor`, `$VISUAL` and `$EDITOR`.
    pub editor: Option<String>,
    /// Terminal command overriding the platform default; the work tree is the cwd.
    pub terminal: Option<String>,
    /// External diff tool command (`$LOCAL` / `$REMOTE` placeholders).
    pub difftool: Option<String>,
    /// Check for a new release at startup.
    pub auto_update_check: bool,
    /// Seconds between silent fetches of the shown repo; 0 disables them.
    pub auto_fetch_seconds: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            git_path: None,
            pull_strategy: PullStrategy::Config,
            diff_context_lines: 3,
            diff_ignore_whitespace: false,
            editor: None,
            terminal: None,
            difftool: None,
            auto_update_check: true,
            auto_fetch_seconds: 10,
        }
    }
}

fn blank_to_none(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl Settings {
    /// Normalises user input: blank strings become `None`, context lines are clamped, and a set
    /// `git_path` must be an existing file.
    ///
    /// # Errors
    /// `settings.invalid_git_path` when `git_path` is not a file.
    pub fn validated(mut self) -> Result<Self, AppError> {
        self.git_path = blank_to_none(self.git_path);
        self.editor = blank_to_none(self.editor);
        self.terminal = blank_to_none(self.terminal);
        self.difftool = blank_to_none(self.difftool);
        self.diff_context_lines = self.diff_context_lines.min(MAX_CONTEXT_LINES);
        self.auto_fetch_seconds = clamp_auto_fetch(self.auto_fetch_seconds);
        if let Some(p) = &self.git_path {
            let path = Path::new(p);
            if !path.is_absolute() {
                return Err(AppError::new(
                    "settings.invalid_git_path",
                    format!("Git path must be absolute: {p}"),
                ));
            }
            if !path.is_file() {
                return Err(AppError::new(
                    "settings.invalid_git_path",
                    format!("Git executable not found: {p}"),
                ));
            }
        }
        Ok(self)
    }

    /// The diff options these settings select.
    pub fn diff_options(&self) -> DiffOptions {
        DiffOptions {
            context: self.diff_context_lines.min(MAX_CONTEXT_LINES),
            ignore_whitespace: self.diff_ignore_whitespace,
        }
    }

    /// The configured git executable if it still exists as a file.
    pub fn usable_git_path(&self) -> Option<PathBuf> {
        let p = self.git_path.as_deref()?;
        let path = PathBuf::from(p);
        if path.is_file() {
            Some(path)
        } else {
            tracing::warn!("configured git path is not a file, using the default git: {p}");
            None
        }
    }
}

/// Loads settings; a missing or corrupt file gives the defaults. Never fails.
pub fn load(file: &Path) -> Settings {
    match std::fs::read(file) {
        Ok(b) => match serde_json::from_slice::<Settings>(&b) {
            Ok(mut s) => {
                s.diff_context_lines = s.diff_context_lines.min(MAX_CONTEXT_LINES);
                s.auto_fetch_seconds = clamp_auto_fetch(s.auto_fetch_seconds);
                s
            }
            Err(e) => {
                let bad = file.with_extension("json.bad");
                tracing::warn!(
                    "ignoring corrupt settings file ({e}); keeping a copy at {}",
                    bad.display()
                );
                if let Err(e) = std::fs::copy(file, &bad) {
                    tracing::warn!("could not back up the corrupt settings file: {e}");
                }
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests: unwrap is fine
mod tests {
    use super::*;

    #[test]
    fn defaults_and_partial_files() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("settings.json");
        assert_eq!(load(&f), Settings::default());
        std::fs::write(&f, br#"{"diffContextLines": 10, "pullStrategy": "ffOnly"}"#).unwrap();
        let s = load(&f);
        assert_eq!(s.diff_context_lines, 10);
        assert_eq!(s.pull_strategy, PullStrategy::FfOnly);
        assert_eq!(s.git_path, None);
        std::fs::write(&f, b"{nope").unwrap();
        assert_eq!(load(&f), Settings::default());
        assert_eq!(std::fs::read(d.path().join("settings.json.bad")).unwrap(), b"{nope");
        std::fs::write(&f, br#"{"diffContextLines": 4000000}"#).unwrap();
        assert_eq!(load(&f).diff_context_lines, MAX_CONTEXT_LINES);
    }

    #[test]
    fn auto_update_check_defaults_on_and_round_trips() {
        assert!(Settings::default().auto_update_check);
        let old: Settings = serde_json::from_str(r#"{"diffContextLines": 5}"#).unwrap();
        assert!(old.auto_update_check);
        let off: Settings = serde_json::from_str(r#"{"autoUpdateCheck": false}"#).unwrap();
        assert!(!off.auto_update_check);
        let json = serde_json::to_string(&off).unwrap();
        assert!(json.contains(r#""autoUpdateCheck":false"#));
    }

    #[test]
    fn auto_fetch_defaults_to_ten_seconds_and_is_clamped() {
        assert_eq!(Settings::default().auto_fetch_seconds, 10);
        let old: Settings = serde_json::from_str(r#"{"diffContextLines": 5}"#).unwrap();
        assert_eq!(old.auto_fetch_seconds, 10);
        let secs = |n: u32| Settings { auto_fetch_seconds: n, ..Settings::default() };
        assert_eq!(secs(0).validated().unwrap().auto_fetch_seconds, 0);
        assert_eq!(secs(1).validated().unwrap().auto_fetch_seconds, 5);
        assert_eq!(secs(90).validated().unwrap().auto_fetch_seconds, 90);
        assert_eq!(secs(99_999).validated().unwrap().auto_fetch_seconds, 3600);
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("settings.json");
        std::fs::write(&f, br#"{"autoFetchSeconds": 2}"#).unwrap();
        assert_eq!(load(&f).auto_fetch_seconds, 5);
    }

    #[test]
    fn validation_normalises() {
        let s = Settings {
            editor: Some("   ".into()),
            difftool: Some(" meld ".into()),
            diff_context_lines: 500,
            ..Settings::default()
        }
        .validated()
        .unwrap();
        assert_eq!(s.editor, None);
        assert_eq!(s.difftool.as_deref(), Some("meld"));
        assert_eq!(s.diff_context_lines, 100);
        let rel = Settings { git_path: Some("git".into()), ..Settings::default() };
        assert_eq!(rel.validated().unwrap_err().code, "settings.invalid_git_path");
        let bad = Settings { git_path: Some("/definitely/not/git".into()), ..Settings::default() };
        assert_eq!(bad.validated().unwrap_err().code, "settings.invalid_git_path");
        let blank = Settings { git_path: Some(" ".into()), ..Settings::default() };
        assert_eq!(blank.validated().unwrap().git_path, None);
    }

    #[test]
    fn existing_git_path_is_accepted() {
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("git");
        std::fs::write(&exe, b"").unwrap();
        let s =
            Settings { git_path: Some(exe.to_string_lossy().into_owned()), ..Settings::default() };
        let s = s.validated().unwrap();
        assert_eq!(s.usable_git_path(), Some(exe));
    }
}
