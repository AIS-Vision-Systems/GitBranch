//! Launch handling: repository path on the command line, single-instance forwarding.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[cfg(desktop)]
use tauri::{AppHandle, Emitter, Manager};

/// Event emitted to the UI when a second launch asks to open a repository.
/// Payload: [`OpenRepoRequest`] (`{ path: string }`).
#[cfg(desktop)]
pub const OPEN_REPO_EVENT: &str = "open-repo-request";

/// Payload of [`OPEN_REPO_EVENT`].
#[cfg(desktop)]
#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenRepoRequest {
    /// Absolute path of an existing directory.
    pub path: String,
}

/// Repository path given on this process's own command line, consumed once by the UI.
#[derive(Default)]
pub struct LaunchPath(pub Mutex<Option<String>>);

/// First argument after `args[0]` that is an existing directory (relative ones resolve against
/// `cwd`); arguments starting with `-` are ignored. The result is always absolute
/// (`std::path::absolute` also handles drive-relative `D:foo`). Touches the filesystem, so never
/// call it on the event-loop thread (a dead UNC share can hang `is_dir`).
pub fn repo_path_from_args(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.is_empty())
        .filter_map(|a| std::path::absolute(cwd.join(a)).ok())
        .find(|p| p.is_dir())
}

/// Focus the main window at once, then resolve the path off the event loop and hand it to the UI:
/// stored in [`LaunchPath`] (so `take_launch_path` can drain it if the webview listener was not
/// ready yet) and emitted as [`OPEN_REPO_EVENT`]. The UI must tolerate seeing the same path via
/// both routes (opening an already-open repo just activates its tab).
#[cfg(desktop)]
pub fn on_second_instance(app: &AppHandle, args: &[String], cwd: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
    let (app, args, cwd) = (app.clone(), args.to_vec(), PathBuf::from(cwd));
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = repo_path_from_args(&args, &cwd) else { return };
        let path = path.to_string_lossy().into_owned();
        if let Some(state) = app.try_state::<LaunchPath>()
            && let Ok(mut slot) = state.0.lock()
        {
            *slot = Some(path.clone());
        }
        if let Err(e) = app.emit(OPEN_REPO_EVENT, OpenRepoRequest { path }) {
            tracing::warn!("could not emit {OPEN_REPO_EVENT}: {e}");
        }
    });
}

/// Path passed to the first instance on its command line, if any. Returns it once.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // tauri::State is passed by value to commands
pub fn take_launch_path(state: tauri::State<'_, LaunchPath>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

/// Computes the launch path from the process's own arguments.
pub fn initial_launch_path() -> LaunchPath {
    let args: Vec<String> = std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect();
    let cwd = std::env::current_dir().unwrap_or_default();
    let path = repo_path_from_args(&args, &cwd).map(|p| p.to_string_lossy().into_owned());
    LaunchPath(Mutex::new(path))
}

#[cfg(test)]
mod tests {
    use super::repo_path_from_args;

    fn a(v: &[&str]) -> Vec<String> {
        v.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn absolute_dir() {
        let t = tempfile::tempdir().expect("tempdir");
        let d = t.path().to_string_lossy().into_owned();
        let got = repo_path_from_args(&a(&["gb", &d]), std::path::Path::new("."));
        assert_eq!(got.as_deref(), Some(t.path()));
    }

    #[test]
    fn relative_dir_and_flags() {
        let t = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(t.path().join("repo")).expect("fs");
        let got = repo_path_from_args(&a(&["gb", "--foo", "-x", "repo"]), t.path());
        assert_eq!(got, Some(t.path().join("repo")));
    }

    #[test]
    fn result_is_absolute_for_dotted_relative_args() {
        let t = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir(t.path().join("repo")).expect("fs");
        let got = repo_path_from_args(&a(&["gb", "./repo"]), t.path()).expect("dir");
        assert!(got.is_absolute());
    }

    #[test]
    fn none_cases() {
        let t = tempfile::tempdir().expect("tempdir");
        std::fs::write(t.path().join("file"), "x").expect("fs");
        assert!(repo_path_from_args(&a(&["gb"]), t.path()).is_none());
        assert!(repo_path_from_args(&a(&["gb", "file", "missing", "-"]), t.path()).is_none());
        // argv[0] is never treated as a path
        let d = t.path().to_string_lossy().into_owned();
        assert!(repo_path_from_args(&a(&[&d]), t.path()).is_none());
    }
}
