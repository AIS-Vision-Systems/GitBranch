//! Parser for git's `--progress` stderr lines (`Receiving objects:  45% (123/273), 1.20 MiB | ...`).

/// One parsed progress line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Progress {
    /// Phase name without the `remote: ` prefix, e.g. `Receiving objects`.
    pub phase: String,
    /// Percentage 0..=100 when git printed one.
    pub pct: Option<u8>,
    /// Objects/files done so far (`123` in `(123/273)`, or the bare count of `Enumerating objects: 5`).
    pub current: Option<u64>,
    /// Total objects/files (`273` in `(123/273)`).
    pub total: Option<u64>,
    /// The line, trimmed and without the `remote: ` prefix.
    pub raw: String,
}

fn leading_number(s: &str) -> Option<(u64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((s[..end].parse().ok()?, &s[end..]))
}

/// Parses one stderr line of `git fetch/pull/push/clone --progress`.
///
/// Recognises `<Phase>: <n>% (<cur>/<total>)...` and `<Phase>: <n>[,...]` (a bare count, as in
/// `Enumerating objects: 5, done.`). Anything else (including `fatal:`/`error:` lines) is `None`.
pub fn parse_progress_line(line: &str) -> Option<Progress> {
    let line = line.trim();
    let line = line.strip_prefix("remote:").map_or(line, str::trim_start);
    let (phase, rest) = line.split_once(':')?;
    let phase = phase.trim();
    // Phases are capitalised words ("Receiving objects"); this rules out `fatal:`, `error:`, urls.
    if !phase.starts_with(|c: char| c.is_ascii_uppercase())
        || !phase.chars().all(|c| c.is_ascii_alphabetic() || c == ' ')
    {
        return None;
    }
    let rest = rest.trim_start();
    let (n, after) = leading_number(rest)?;
    let (pct, current, total) = if let Some(after) = after.strip_prefix('%') {
        let pct = u8::try_from(n.min(100)).ok()?;
        let counts = after.trim_start().strip_prefix('(').and_then(|a| {
            let (cur, a) = leading_number(a)?;
            let (tot, _) = leading_number(a.strip_prefix('/')?)?;
            Some((cur, tot))
        });
        (Some(pct), counts.map(|c| c.0), counts.map(|c| c.1))
    } else if after.is_empty() || after.starts_with(',') {
        (None, Some(n), None)
    } else {
        return None;
    };
    Some(Progress { phase: phase.to_string(), pct, current, total, raw: line.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(line: &str) -> Progress {
        parse_progress_line(line).unwrap_or_else(|| panic!("no progress in {line:?}"))
    }

    #[test]
    fn receiving_objects() {
        let r = p("Receiving objects:  45% (123/273), 1.20 MiB | 2.00 MiB/s");
        assert_eq!(r.phase, "Receiving objects");
        assert_eq!((r.pct, r.current, r.total), (Some(45), Some(123), Some(273)));
        assert!(r.raw.starts_with("Receiving objects:  45%"));
    }

    #[test]
    fn done_lines_and_remote_prefix() {
        let r = p("Resolving deltas: 100% (3/3), done.");
        assert_eq!((r.phase.as_str(), r.pct, r.total), ("Resolving deltas", Some(100), Some(3)));
        let r = p("remote: Counting objects: 100% (5/5), done.");
        assert_eq!((r.phase.as_str(), r.pct, r.current), ("Counting objects", Some(100), Some(5)));
        assert_eq!(r.raw, "Counting objects: 100% (5/5), done.");
        assert_eq!(p("remote: Compressing objects:  50% (1/2)").phase, "Compressing objects");
        assert_eq!(
            p("Writing objects: 100% (3/3), 250 bytes | 250.00 KiB/s, done.").pct,
            Some(100)
        );
        assert_eq!(p("Unpacking objects: 100% (3/3), 1.2 KiB | 300 KiB/s, done.").total, Some(3));
        assert_eq!(p("Updating files:  50% (10/20)").current, Some(10));
        assert_eq!(p("Checking out files: 100% (20/20), done.").phase, "Checking out files");
    }

    #[test]
    fn bare_count() {
        let r = p("Enumerating objects: 5, done.");
        assert_eq!(
            (r.phase.as_str(), r.pct, r.current, r.total),
            ("Enumerating objects", None, Some(5), None)
        );
    }

    #[test]
    fn non_progress_lines() {
        for l in [
            "",
            "fatal: not a git repository",
            "error: failed to push some refs to 'x'",
            "From file:///tmp/x",
            "   abc..def  main -> origin/main",
            "Total 3 (delta 0), reused 0 (delta 0)",
            "remote: Resolving deltas: abc",
            "To https://host:8080/x",
        ] {
            assert_eq!(parse_progress_line(l), None, "{l:?}");
        }
    }
}
