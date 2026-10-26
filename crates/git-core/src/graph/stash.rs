//! Stash entries as synthetic commits in the graph input.

use std::collections::HashMap;

use crate::parse::log::Commit;
use crate::parse::stash::StashEntry;

/// Inserts one synthetic commit per stash right above its base commit (newest stash first,
/// i.e. ascending `index`). Stashes whose base is not in `commits` are left out: the
/// function runs per log chunk with the full stash list, so they land in the chunk that
/// holds their base.
#[must_use]
pub fn with_stashes(commits: Vec<Commit>, stashes: &[StashEntry]) -> Vec<Commit> {
    if stashes.is_empty() {
        return commits;
    }
    let mut by_base: HashMap<&str, Vec<&StashEntry>> = HashMap::new();
    for s in stashes {
        by_base.entry(s.base.as_str()).or_default().push(s);
    }
    for list in by_base.values_mut() {
        list.sort_by_key(|s| s.index);
    }
    let mut out = Vec::with_capacity(commits.len() + stashes.len());
    for c in commits {
        if let Some(list) = by_base.get(c.oid.as_str()) {
            out.extend(list.iter().map(|s| Commit {
                oid: s.oid.clone(),
                parents: vec![s.base.clone()],
                author_name: s.author_name.clone(),
                author_email: s.author_email.clone(),
                author_time: s.time,
                committer_time: s.time,
                subject: s.message.clone(),
                stash: true,
            }));
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(oid: &str) -> Commit {
        Commit {
            oid: oid.into(),
            parents: Vec::new(),
            author_name: "a".into(),
            author_email: "a@x".into(),
            author_time: 0,
            committer_time: 0,
            subject: oid.into(),
            stash: false,
        }
    }

    fn stash(index: usize, oid: &str, base: &str) -> StashEntry {
        StashEntry {
            index,
            oid: oid.into(),
            base: base.into(),
            branch: Some("main".into()),
            message: format!("On main: {oid}"),
            time: 42,
            author_name: "Ada".into(),
            author_email: "ada@x".into(),
        }
    }

    fn oids(v: &[Commit]) -> Vec<&str> {
        v.iter().map(|c| c.oid.as_str()).collect()
    }

    #[test]
    fn no_stashes_is_identity() {
        let v = vec![commit("c1"), commit("c0")];
        assert_eq!(with_stashes(v.clone(), &[]), v);
    }

    #[test]
    fn one_stash_above_its_base() {
        let v =
            with_stashes(vec![commit("c2"), commit("c1"), commit("c0")], &[stash(0, "s0", "c1")]);
        assert_eq!(oids(&v), ["c2", "s0", "c1", "c0"]);
        let s = &v[1];
        assert!(s.stash);
        assert_eq!(s.parents, ["c1"]);
        assert_eq!((s.author_name.as_str(), s.author_email.as_str()), ("Ada", "ada@x"));
        assert_eq!((s.author_time, s.committer_time), (42, 42));
        assert_eq!(s.subject, "On main: s0");
        assert!(!v[0].stash);
    }

    #[test]
    fn two_stashes_on_one_base_keep_index_order() {
        let list = [stash(1, "s1", "c1"), stash(0, "s0", "c1")];
        let v = with_stashes(vec![commit("c1"), commit("c0")], &list);
        assert_eq!(oids(&v), ["s0", "s1", "c1", "c0"]);
    }

    #[test]
    fn stash_with_absent_base_is_skipped() {
        let v = with_stashes(vec![commit("c1")], &[stash(0, "s0", "zzz")]);
        assert_eq!(oids(&v), ["c1"]);
    }

    #[test]
    fn stash_on_first_commit_of_chunk() {
        let v = with_stashes(vec![commit("c1"), commit("c0")], &[stash(0, "s0", "c1")]);
        assert_eq!(oids(&v), ["s0", "c1", "c0"]);
    }
}
