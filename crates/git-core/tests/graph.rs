//! Graph layout property and performance tests.
#![allow(clippy::unwrap_used, clippy::print_stderr, clippy::cast_possible_truncation)] // test code
use std::collections::{BTreeSet, HashMap};
use std::time::Instant;

use git_core::fixtures::FixtureRepo;
use git_core::graph::layout::layout;
use git_core::graph::{EdgeKind, LayoutState, Row};
use git_core::parse::log::{Commit, LogQuery, log_page};

fn commit(oid: String, parents: Vec<String>) -> Commit {
    Commit {
        oid,
        parents,
        author_name: String::new(),
        author_email: String::new(),
        author_time: 0,
        committer_time: 0,
        subject: String::new(),
    }
}

fn synthetic(n: usize, seed: u64) -> Vec<Commit> {
    const A: u64 = 6_364_136_223_846_793_005;
    const C: u64 = 1_442_695_040_888_963_407;
    let mut s = seed.wrapping_mul(A).wrapping_add(C);
    let mut next = move || {
        s = s.wrapping_mul(A).wrapping_add(C);
        s >> 33
    };
    let name = |i: usize| format!("{i:040x}");
    (0..n)
        .map(|i| {
            let mut parents = Vec::new();
            if i + 1 < n {
                let mut pick = || {
                    let r = usize::try_from(next() % 50).unwrap();
                    i + 1 + r.min(n - i - 2)
                };
                parents.push(name(pick()));
                if pick() % 10 == 0 {
                    let p = name(pick());
                    if !parents.contains(&p) {
                        parents.push(p);
                    }
                }
            }
            commit(name(i), parents)
        })
        .collect()
}

async fn load(r: &FixtureRepo) -> Vec<Commit> {
    log_page(&r.runner(), r.path(), &LogQuery::default()).await.unwrap().commits
}

fn grow(lanes: &mut Vec<Vec<String>>, n: usize) {
    if lanes.len() <= n {
        lanes.resize(n + 1, Vec::new());
    }
}

/// Rebuild (child, parent) pairs purely from the edges.
fn simulate(rows: &[Row]) -> BTreeSet<(String, String)> {
    let mut lanes: Vec<Vec<String>> = Vec::new();
    let mut out = BTreeSet::new();
    for row in rows {
        grow(&mut lanes, usize::from(row.lane));
        let mut consumed = vec![usize::from(row.lane)];
        for e in &row.edges {
            if e.kind == EdgeKind::MergeIn {
                assert_eq!(e.to_lane, row.lane);
                consumed.push(usize::from(e.from_lane));
            }
        }
        for l in consumed {
            grow(&mut lanes, l);
            for child in lanes[l].drain(..) {
                out.insert((child, row.oid.clone()));
            }
        }
        for e in &row.edges {
            match e.kind {
                EdgeKind::Straight if e.from_lane == row.lane => {
                    lanes[usize::from(e.to_lane)].push(row.oid.clone());
                }
                EdgeKind::BranchOut => {
                    grow(&mut lanes, usize::from(e.to_lane));
                    lanes[usize::from(e.to_lane)].push(row.oid.clone());
                }
                _ => {}
            }
        }
    }
    out
}

fn check_all(commits: &[Commit]) {
    let rows = layout(commits);
    assert_eq!(rows.len(), commits.len());

    // (a) parents strictly below children.
    let pos: HashMap<&str, usize> =
        commits.iter().enumerate().map(|(i, c)| (c.oid.as_str(), i)).collect();
    for (i, c) in commits.iter().enumerate() {
        for p in &c.parents {
            assert!(pos[p.as_str()] > i, "parent above child");
        }
    }

    // (b) relation recoverable from edges.
    let expect: BTreeSet<(String, String)> =
        commits.iter().flat_map(|c| c.parents.iter().map(|p| (c.oid.clone(), p.clone()))).collect();
    assert_eq!(simulate(&rows), expect);

    // (c) no overlapping bottoms; (d) colors stable along lanes.
    let mut bottom: HashMap<u16, u8> = HashMap::new();
    for row in &rows {
        let (mut straights, mut branches) = (BTreeSet::new(), BTreeSet::new());
        for e in &row.edges {
            match e.kind {
                EdgeKind::Straight => {
                    assert!(straights.insert(e.to_lane), "two Straight on one lane in {}", row.oid);
                }
                EdgeKind::BranchOut => {
                    assert!(branches.insert(e.to_lane), "two BranchOut on one lane in {}", row.oid);
                }
                EdgeKind::MergeIn => {}
            }
        }
        if let Some(c) = bottom.get(&row.lane) {
            assert_eq!(*c, row.color, "node color differs from lane color");
        }
        for e in &row.edges {
            if matches!(e.kind, EdgeKind::Straight | EdgeKind::MergeIn)
                && let Some(c) = bottom.get(&e.from_lane)
            {
                assert_eq!(*c, e.color, "lane color changed mid-segment");
            }
        }
        bottom.clear();
        for e in &row.edges {
            if matches!(e.kind, EdgeKind::Straight | EdgeKind::BranchOut) {
                bottom.insert(e.to_lane, e.color);
            }
        }
    }

    // (f) has_incoming is false exactly for commits that are not a parent of any earlier row.
    let mut parents_seen: BTreeSet<&str> = BTreeSet::new();
    for (c, row) in commits.iter().zip(&rows) {
        assert_eq!(
            row.has_incoming,
            parents_seen.contains(c.oid.as_str()),
            "has_incoming {}",
            c.oid
        );
        parents_seen.extend(c.parents.iter().map(String::as_str));
    }

    // (e) incremental == batch.
    let mut st = LayoutState::new();
    let inc: Vec<Row> = commits.chunks(2).flat_map(|ch| st.push_all(ch)).collect();
    assert_eq!(inc, rows);
}

#[tokio::test]
async fn fixtures_properties() {
    let repos = [
        FixtureRepo::linear(5),
        FixtureRepo::merge(),
        FixtureRepo::octopus(),
        FixtureRepo::orphan(),
        FixtureRepo::tags(),
        FixtureRepo::with_stash(),
    ];
    for r in &repos {
        let commits = load(r).await;
        assert_ne!(commits, [] as [git_core::parse::log::Commit; 0]);
        check_all(&commits);
    }
}

#[test]
fn synthetic_properties() {
    check_all(&synthetic(5_000, 1));
}

#[test]
fn lanes_are_released() {
    let mut st = LayoutState::new();
    st.push_all(&synthetic(2_000, 3));
    assert_eq!(st.active_lanes(), 0);
}

#[test]
fn perf_100k() {
    let c = synthetic(100_000, 7);
    let t = Instant::now();
    let rows = layout(&c);
    let ms = t.elapsed().as_millis();
    eprintln!("layout 100k commits: {ms} ms");
    assert_eq!(rows.len(), 100_000);
    if cfg!(not(debug_assertions)) {
        assert!(ms < 300, "layout took {ms} ms");
    }
}
