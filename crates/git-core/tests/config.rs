//! Tests for `ops::config`.
#![allow(clippy::unwrap_used)] // tests

use git_core::fixtures::FixtureRepo;
use git_core::ops::config::editor_command;

#[tokio::test]
async fn core_editor_is_split_into_argv() {
    let r = FixtureRepo::linear(1);
    r.git(&["config", "core.editor", "'C:/Program Files/X/x.exe' --wait"]);
    let argv = editor_command(&r.runner(), r.path(), None).await.unwrap().unwrap();
    assert_eq!(argv, ["C:/Program Files/X/x.exe", "--wait"]);
    let argv = editor_command(&r.runner(), r.path(), Some("  ")).await.unwrap().unwrap();
    assert_eq!(argv, ["C:/Program Files/X/x.exe", "--wait"]);
}

#[tokio::test]
async fn override_wins_over_core_editor() {
    let r = FixtureRepo::linear(1);
    r.git(&["config", "core.editor", "vim"]);
    let argv = editor_command(&r.runner(), r.path(), Some("code --wait")).await.unwrap().unwrap();
    assert_eq!(argv, ["code", "--wait"]);
}

mod program {

    use git_core::ops::config::{difftool_cmd_with, resolve_program_in, split_program};
    use std::ffi::OsStr;
    use std::path::PathBuf;

    fn dir() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("tool.cmd"), "").unwrap();
        std::fs::write(d.path().join("plain"), "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perm = std::fs::Permissions::from_mode(0o755);
            std::fs::set_permissions(d.path().join("plain"), perm).unwrap();
        }
        d
    }

    #[test]
    fn resolves_with_pathext() {
        let d = dir();
        let ext = OsStr::new(".COM;.EXE;.BAT;.CMD");
        let got = resolve_program_in("tool", d.path().as_os_str(), Some(ext)).unwrap();
        assert!(got.to_string_lossy().to_lowercase().ends_with("tool.cmd"));
        let got = resolve_program_in("tool.cmd", d.path().as_os_str(), Some(ext)).unwrap();
        assert_eq!(got, d.path().join("tool.cmd"));
        // An extensionless file is not runnable on Windows.
        assert!(resolve_program_in("plain", d.path().as_os_str(), Some(ext)).is_none());
    }

    #[test]
    fn resolves_without_pathext() {
        let d = dir();
        assert!(resolve_program_in("tool", d.path().as_os_str(), None).is_none());
        assert_eq!(
            resolve_program_in("plain", d.path().as_os_str(), None).unwrap(),
            d.path().join("plain")
        );
        let full = d.path().join("plain");
        let got = resolve_program_in(full.to_str().unwrap(), OsStr::new(""), None).unwrap();
        assert_eq!(got, full);
        assert!(resolve_program_in("", d.path().as_os_str(), None).is_none());
    }

    #[test]
    fn splits_program() {
        assert_eq!(split_program("  "), None);
        assert_eq!(split_program(""), None);
        assert_eq!(split_program("meld"), Some(("meld", "")));
        assert_eq!(split_program(" code  --wait  -x "), Some(("code", "--wait  -x")));
    }

    #[test]
    fn difftool_cmd_shapes() {
        let none = |_: &str| None;
        assert_eq!(difftool_cmd_with("meld", none), "meld \"$LOCAL\" \"$REMOTE\"");
        assert_eq!(
            difftool_cmd_with("meld \"$LOCAL\" \"$REMOTE\"", none),
            "meld \"$LOCAL\" \"$REMOTE\""
        );
        assert_eq!(
            difftool_cmd_with("code --wait --diff $LOCAL $REMOTE", none),
            "code --wait --diff $LOCAL $REMOTE"
        );
        let res = |_: &str| Some(PathBuf::from(r"C:\x\code.cmd"));
        let q = if cfg!(windows) { "'C:/x/code.cmd'" } else { r"'C:\x\code.cmd'" };
        assert_eq!(
            difftool_cmd_with("code --wait --diff $LOCAL $REMOTE", res),
            format!("{q} --wait --diff $LOCAL $REMOTE")
        );
        assert_eq!(difftool_cmd_with("code", res), format!("{q} \"$LOCAL\" \"$REMOTE\""));
        // Braced placeholders count; no double append.
        assert_eq!(difftool_cmd_with("x ${LOCAL} ${REMOTE}", none), "x ${LOCAL} ${REMOTE}");
        assert_eq!(difftool_cmd_with("x $MERGED", none), "x $MERGED");
        // A backslash program is rewritten even when it resolves to itself.
        let want = if cfg!(windows) { "'C:/Tools/meld.exe'" } else { r"'C:\Tools\meld.exe'" };
        let same = |p: &str| Some(PathBuf::from(p));
        assert_eq!(
            difftool_cmd_with(r"C:\Tools\meld.exe -x", same),
            format!("{want} -x \"$LOCAL\" \"$REMOTE\"")
        );
        let quote = |_: &str| Some(PathBuf::from("/o'k/m"));
        assert_eq!(difftool_cmd_with("m", quote), r#"'/o'\''k/m' "$LOCAL" "$REMOTE""#);
        // Resolving to the same bare name changes nothing; quoted programs are left alone.
        assert_eq!(difftool_cmd_with("meld", same), "meld \"$LOCAL\" \"$REMOTE\"");
        assert_eq!(difftool_cmd_with("'/a b/m' -d", res), "'/a b/m' -d \"$LOCAL\" \"$REMOTE\"");
    }
}
