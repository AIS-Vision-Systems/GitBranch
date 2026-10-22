//! External terminal launcher candidates (argv only, never a shell string).

use std::path::Path;

use git_core::ops::config::split_words;

/// Terminal argv candidates in priority order. The caller spawns the first whose program exists,
/// with the work tree as the current directory.
pub fn terminal_candidates(
    override_cmd: Option<&str>,
    work: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    if let Some(words) = override_cmd.and_then(split_words).filter(|w| !w.is_empty()) {
        out.push(words);
    }
    out.extend(platform_candidates(work, env));
    out
}

#[cfg(windows)]
fn platform_candidates(_work: &Path, _env: &dyn Fn(&str) -> Option<String>) -> Vec<Vec<String>> {
    vec![vec!["wt.exe".into(), "-d".into(), ".".into()], vec!["cmd.exe".into()]]
}

#[cfg(not(windows))]
fn platform_candidates(work: &Path, env: &dyn Fn(&str) -> Option<String>) -> Vec<Vec<String>> {
    let w = work.to_string_lossy().into_owned();
    let mut v = Vec::new();
    if let Some(t) = env("TERMINAL").filter(|t| !t.trim().is_empty()) {
        if let Some(words) = split_words(&t).filter(|w| !w.is_empty()) {
            v.push(words);
        }
    }
    v.push(vec!["x-terminal-emulator".into()]);
    v.push(vec!["gnome-terminal".into(), format!("--working-directory={w}")]);
    v.push(vec!["konsole".into(), "--workdir".into(), w]);
    v.push(vec!["xterm".into()]);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn override_comes_first_and_is_split() {
        let c = terminal_candidates(Some("alacritty --class 'my term'"), Path::new("/w"), &no_env);
        assert_eq!(c[0], vec!["alacritty", "--class", "my term"]);
        assert!(c.len() > 1);
    }

    #[test]
    fn blank_or_unterminated_override_is_skipped() {
        let base = terminal_candidates(None, Path::new("/w"), &no_env);
        assert_eq!(terminal_candidates(Some("  "), Path::new("/w"), &no_env), base);
        assert_eq!(terminal_candidates(Some("a 'b"), Path::new("/w"), &no_env), base);
    }

    #[cfg(windows)]
    #[test]
    fn windows_defaults() {
        let c = terminal_candidates(None, Path::new("/w"), &no_env);
        assert_eq!(c, vec![vec!["wt.exe", "-d", "."], vec!["cmd.exe"]]);
    }

    #[cfg(not(windows))]
    #[test]
    fn linux_defaults_and_terminal_env() {
        let env = |k: &str| (k == "TERMINAL").then(|| "kitty -1".to_string());
        let c = terminal_candidates(None, Path::new("/w"), &env);
        assert_eq!(c[0], vec!["kitty", "-1"]);
        assert_eq!(c[1], vec!["x-terminal-emulator"]);
        assert_eq!(c[2], vec!["gnome-terminal", "--working-directory=/w"]);
        assert_eq!(c[3], vec!["konsole", "--workdir", "/w"]);
        assert_eq!(c[4], vec!["xterm"]);
        let c = terminal_candidates(None, Path::new("/w"), &no_env);
        assert_eq!(c[0], vec!["x-terminal-emulator"]);
    }
}
