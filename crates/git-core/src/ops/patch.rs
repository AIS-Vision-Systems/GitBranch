//! Hunk- and line-level staging, unstaging and discarding through `git apply` (D-019).

use std::fmt::Write as _;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::parse::diff::{DiffError, DiffOptions, DiffTarget, FileDiff, LineKind, file_diff_with};
use crate::{GitError, GitRunner, RunOpts};

/// A hunk (or some of its lines) picked in the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkSelection {
    /// The diff the hunk was shown in.
    pub target: DiffTarget,
    /// Index into `FileDiff.hunks`.
    pub hunk_index: usize,
    /// Header of the hunk when shown; used to detect stale diffs.
    pub hunk_header: String,
    /// Indices into `Hunk.lines` of the add/del lines to include; `None` = whole hunk.
    pub lines: Option<Vec<usize>>,
}

/// What to do with the selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchOp {
    /// Apply an unstaged selection to the index.
    Stage,
    /// Remove a staged selection from the index.
    Unstage,
    /// Revert an unstaged selection in the work tree.
    Discard,
}

/// Error from [`apply_selection`].
#[derive(Debug, thiserror::Error)]
pub enum PatchError {
    /// git failed (including `apply` rejecting the patch).
    #[error(transparent)]
    Git(#[from] GitError),
    /// The fresh diff could not be read.
    #[error(transparent)]
    Diff(#[from] DiffError),
    /// The hunk no longer matches what the UI showed.
    #[error("the file changed since the diff was shown")]
    Stale,
    /// The selection cannot be turned into a patch.
    #[error("invalid selection: {0}")]
    Invalid(String),
}

/// Builds a forward patch for one hunk of `diff`, optionally restricted to some line indices.
///
/// Unselected `-` lines become context and unselected `+` lines are dropped, so the patch applies
/// to the diff's *old* side.
///
/// # Errors
/// [`PatchError::Invalid`] for binary/combined/too-large diffs, a bad index, or an empty selection.
pub fn build_patch(
    diff: &FileDiff,
    hunk_index: usize,
    lines: Option<&[usize]>,
) -> Result<String, PatchError> {
    build(diff, hunk_index, lines, false)
}

/// `reverse` builds a patch for `git apply -R`: it must match the diff's *new* side, so
/// unselected `+` lines become context and unselected `-` lines are dropped.
fn build(
    diff: &FileDiff,
    hunk_index: usize,
    lines: Option<&[usize]>,
    reverse: bool,
) -> Result<String, PatchError> {
    let bad = |m: &str| PatchError::Invalid(m.to_string());
    if diff.binary {
        return Err(bad("binary files cannot be applied by hunk"));
    }
    if diff.too_large {
        return Err(bad("file too large"));
    }
    if diff.combined {
        return Err(bad("combined diffs cannot be applied by hunk"));
    }
    let hunk = diff.hunks.get(hunk_index).ok_or_else(|| bad("hunk index out of range"))?;
    if let Some(sel) = lines {
        if sel.iter().any(|&i| i >= hunk.lines.len()) {
            return Err(bad("line index out of range"));
        }
    }
    let (old, new) = (diff.old_path.as_deref(), diff.new_path.as_deref());
    let name = new.or(old).ok_or_else(|| bad("diff has no path"))?;
    let (a, b) = (old.unwrap_or(name), new.unwrap_or(name));

    if lines.is_some() && (old.is_none() || new.is_none()) {
        return Err(bad("select the whole file for added or deleted files"));
    }
    if [a, b].iter().any(|p| p.contains(['"', '\\', '\t', '\n'])) {
        return Err(bad("paths with quotes, backslashes or control characters are not supported"));
    }

    let (mut oc, mut nc, mut selected) = (0u32, 0u32, 0usize);
    let mut rebuilt = Vec::with_capacity(hunk.lines.len());
    for (i, l) in hunk.lines.iter().enumerate() {
        let picked = lines.is_none_or(|s| s.contains(&i));
        let marker = match l.kind {
            LineKind::Context => ' ',
            LineKind::Add if picked => '+',
            LineKind::Del if picked => '-',
            LineKind::Add if reverse => ' ',
            LineKind::Del if !reverse => ' ',
            LineKind::Add | LineKind::Del => continue,
        };
        if l.kind != LineKind::Context && picked {
            selected += 1;
        }
        if marker != '+' {
            oc += 1;
        }
        if marker != '-' {
            nc += 1;
        }
        rebuilt.push((marker, l));
    }
    let mut body = String::new();
    let last = rebuilt.len().saturating_sub(1);
    for (n, (marker, l)) in rebuilt.iter().enumerate() {
        if l.no_newline && *marker == ' ' && l.kind != LineKind::Context && n != last {
            return Err(bad("the selection would put a line without a final newline mid-hunk"));
        }
        body.push(*marker);
        body.push_str(&l.text);
        body.push('\n');
        if l.no_newline {
            body.push_str("\\ No newline at end of file\n");
        }
    }
    if lines.is_some() && selected == 0 {
        return Err(bad("nothing selected"));
    }

    let mut out = format!("diff --git a/{a} b/{b}\n");
    if old.is_none() {
        let _ = writeln!(out, "new file mode {}", diff.new_mode.as_deref().unwrap_or("100644"));
        out.push_str("--- /dev/null\n");
    } else {
        let _ = writeln!(out, "--- a/{a}");
    }
    if new.is_none() {
        out.push_str("+++ /dev/null\n");
    } else {
        let _ = writeln!(out, "+++ b/{b}");
    }
    let _ = writeln!(out, "@@ -{},{oc} +{},{nc} @@", hunk.old_start, hunk.new_start);
    out.push_str(&body);
    Ok(out)
}

/// Applies `op` to the selected hunk/lines.
///
/// Stage and Discard need an `Unstaged` target, Unstage a `Staged` one. The diff is re-read and
/// its hunk header compared with `sel.hunk_header` first.
///
/// # Errors
/// [`PatchError`]: `Stale` when the file changed, `Invalid` for unusable selections, `Git` when
/// `git apply` rejects the patch.
pub async fn apply_selection(
    runner: &GitRunner,
    repo: &Path,
    sel: &HunkSelection,
    op: PatchOp,
) -> Result<(), PatchError> {
    apply_selection_with(runner, repo, sel, op, &DiffOptions::default()).await
}

/// Like [`apply_selection`], re-reading the diff with the same [`DiffOptions`] the UI displayed so
/// hunk indices and headers match.
///
/// # Errors
/// Same as [`apply_selection`].
pub async fn apply_selection_with(
    runner: &GitRunner,
    repo: &Path,
    sel: &HunkSelection,
    op: PatchOp,
    options: &DiffOptions,
) -> Result<(), PatchError> {
    let ok = matches!(
        (&sel.target, op),
        (DiffTarget::Unstaged { .. }, PatchOp::Stage | PatchOp::Discard)
            | (DiffTarget::Staged { .. }, PatchOp::Unstage)
    );
    if !ok {
        return Err(PatchError::Invalid("target does not match the operation".into()));
    }
    if options.ignore_whitespace {
        return Err(PatchError::Invalid(
            "hunk and line operations are unavailable while 'ignore whitespace' is on".into(),
        ));
    }
    let diff = file_diff_with(runner, repo, &sel.target, options).await?;
    match diff.hunks.get(sel.hunk_index) {
        Some(h) if h.header == sel.hunk_header => {}
        None if diff.binary || diff.combined || diff.too_large => {}
        Some(_) | None => return Err(PatchError::Stale),
    }
    let reverse = op != PatchOp::Stage;
    let patch = build(&diff, sel.hunk_index, sel.lines.as_deref(), reverse)?;
    let mut args = vec!["apply"];
    match op {
        PatchOp::Stage => args.push("--cached"),
        PatchOp::Unstage => args.extend(["--cached", "-R"]),
        PatchOp::Discard => args.push("-R"),
    }
    args.extend(["--recount", "--whitespace=nowarn"]);
    if options.context == 0 {
        // Zero-context hunks have no anchoring context lines.
        args.push("--unidiff-zero");
    }
    let opts = RunOpts {
        stdin: Some(patch.into_bytes()),
        env: vec![("GIT_LITERAL_PATHSPECS".into(), "1".into())],
        ..RunOpts::default()
    };
    runner.run(repo, &args, opts).await?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // tests
mod tests {
    use super::*;
    use crate::parse::diff::parse_unified;

    const D: &str = "diff --git a/f.txt b/f.txt
index 1..2 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,4 @@ ctx
 a
-b
+B
 c
-d
+D
\\ No newline at end of file
";

    #[test]
    fn whole_hunk_round_trip_text() {
        let d = parse_unified(D.as_bytes()).unwrap();
        let p = build_patch(&d, 0, None).unwrap();
        let want = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n-d\n+D\n\\ No newline at end of file\n";
        assert_eq!(p, want);
    }

    #[test]
    fn partial_selection_recounts() {
        let d = parse_unified(D.as_bytes()).unwrap();
        // lines: 0 a, 1 -b, 2 +B, 3 c, 4 -d, 5 +D. Select only "+B".
        let p = build_patch(&d, 0, Some(&[2])).unwrap();
        assert!(p.contains("@@ -1,4 +1,5 @@\n a\n b\n+B\n c\n d\n"), "{p}");
        // Select only "-b": +B and +D dropped, -d becomes context.
        let p = build_patch(&d, 0, Some(&[1])).unwrap();
        assert!(p.contains("@@ -1,4 +1,3 @@\n a\n-b\n c\n d\n"), "{p}");
        assert!(matches!(build_patch(&d, 0, Some(&[0])), Err(PatchError::Invalid(_))));
        assert!(matches!(build_patch(&d, 1, None), Err(PatchError::Invalid(_))));
    }

    #[test]
    fn no_newline_marker_follows_its_line() {
        let d = parse_unified(D.as_bytes()).unwrap();
        let p = build_patch(&d, 0, Some(&[5])).unwrap();
        assert!(p.ends_with("+D\n\\ No newline at end of file\n"), "{p}");
        // Dropped "+D" drops its marker too.
        let p = build_patch(&d, 0, Some(&[1])).unwrap();
        assert!(!p.contains("No newline"), "{p}");
    }

    const NEW_FILE: &str = "diff --git a/n.txt b/n.txt
new file mode 100644
index 0000000..1
--- /dev/null
+++ b/n.txt
@@ -0,0 +1,2 @@
+x
+y
";

    #[test]
    fn partial_selection_on_new_file_is_invalid() {
        let d = parse_unified(NEW_FILE.as_bytes()).unwrap();
        assert!(build_patch(&d, 0, None).is_ok());
        let err = build_patch(&d, 0, Some(&[0])).unwrap_err();
        assert!(err.to_string().contains("select the whole file"), "{err}");
    }

    #[test]
    fn unselected_no_newline_deletion_mid_hunk_is_invalid() {
        let text = "diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,2 @@
 a
-b
\\ No newline at end of file
+B
\\ No newline at end of file
";
        let d = parse_unified(text.as_bytes()).unwrap();
        // "-b" would become context but is followed by "+B".
        assert!(matches!(build_patch(&d, 0, Some(&[2])), Err(PatchError::Invalid(_))));
        assert!(build_patch(&d, 0, Some(&[1])).is_ok());
        assert!(build_patch(&d, 0, None).is_ok());
    }

    #[test]
    fn unselected_no_newline_deletion_at_the_end_is_fine() {
        let text = "diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,1 @@
 a
-b
-c
\\ No newline at end of file
";
        let d = parse_unified(text.as_bytes()).unwrap();
        // Select only "-b": "c" stays as the last context line, marker included.
        let p = build_patch(&d, 0, Some(&[1])).unwrap();
        assert!(p.ends_with("-b\n c\n\\ No newline at end of file\n"), "{p}");
    }

    #[test]
    fn paths_needing_quoting_are_invalid() {
        for bad in ["q\"x.txt", "a\\b.txt", "a\tb.txt", "a\nb.txt"] {
            let mut d = parse_unified(D.as_bytes()).unwrap();
            d.old_path = Some(bad.into());
            d.new_path = Some(bad.into());
            assert!(matches!(build_patch(&d, 0, None), Err(PatchError::Invalid(_))), "{bad:?}");
        }
    }
}
