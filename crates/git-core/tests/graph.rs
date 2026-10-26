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
        stash: false,
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

    // (f) has_incoming is false exactly for commits that are not a parent of any earlier
    // non-stash row (stashes join their base from the side).
    let mut parents_seen: BTreeSet<&str> = BTreeSet::new();
    for (c, row) in commits.iter().zip(&rows) {
        assert_eq!(
            row.has_incoming,
            parents_seen.contains(c.oid.as_str()),
            "has_incoming {}",
            c.oid
        );
        if !c.stash {
            parents_seen.extend(c.parents.iter().map(String::as_str));
        }
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

/// `oid <- parents...` lines into commits (children first).
fn chain(spec: &[(&str, &[&str])]) -> Vec<Commit> {
    spec.iter()
        .map(|(o, ps)| commit((*o).to_owned(), ps.iter().map(|p| (*p).to_owned()).collect()))
        .collect()
}

fn lane_of(rows: &[Row], oid: &str) -> u16 {
    rows.iter().find(|r| r.oid == oid).unwrap().lane
}

/// Stacked pull requests: `fb` was branched from the tip of `fa` and both were merged into main.
/// The tip of `fa` must stay on the lane opened by its merge, so `fb`'s lane ends sideways into it
/// instead of the merge lane looking like an empty branch.
#[test]
fn merged_tip_keeps_the_merge_lane() {
    let c = chain(&[
        ("m2", &["m1", "fb2"]),
        ("m1", &["m0", "fa2"]),
        ("fb2", &["fb1"]),
        ("fb1", &["fa2"]),
        ("fa2", &["fa1"]),
        ("fa1", &["m0"]),
        ("m0", &[]),
    ]);
    check_all(&c);
    let rows = layout(&c);
    assert_eq!(lane_of(&rows, "fb2"), 1);
    assert_eq!(lane_of(&rows, "fa2"), 2, "fa2 stays on the lane opened by m1");
    assert_eq!(lane_of(&rows, "fa1"), 2);
    assert_eq!(lane_of(&rows, "m0"), 0);
    let fa2 = rows.iter().find(|r| r.oid == "fa2").unwrap();
    assert!(
        fa2.edges.iter().any(|e| e.kind == EdgeKind::MergeIn && e.from_lane == 1 && e.to_lane == 2),
        "fb's lane ends into fa2"
    );
}

/// Main merged into a feature branch, then the feature merged back: main keeps lane 0 and the
/// lane opened for the pulled-in commit ends with no commits of its own.
#[test]
fn upstream_commit_stays_on_its_lane() {
    let c = chain(&[
        ("m3", &["m2", "f2"]),
        ("f2", &["f1", "m1"]),
        ("m2", &["m1"]),
        ("f1", &["m0"]),
        ("m1", &["m0"]),
        ("m0", &[]),
    ]);
    check_all(&c);
    let rows = layout(&c);
    for oid in ["m3", "m2", "m1", "m0"] {
        assert_eq!(lane_of(&rows, oid), 0, "{oid} on main's lane");
    }
    assert_eq!(lane_of(&rows, "f2"), 1);
    assert_eq!(lane_of(&rows, "f1"), 1);
}

/// A merge whose second parent is on its own first-parent chain draws an empty side lane.
#[test]
fn empty_branch_merge_keeps_main_straight() {
    let c = chain(&[("m2", &["m1", "m0"]), ("m1", &["m0"]), ("m0", &[])]);
    check_all(&c);
    let rows = layout(&c);
    assert_eq!(lane_of(&rows, "m1"), 0);
    assert_eq!(lane_of(&rows, "m0"), 0);
}

/// A stash sits beside the lane its base takes, linked by dotted edges.
#[test]
fn stash_beside_its_base() {
    let mut c = chain(&[("s1", &["m1"]), ("s0", &["m1"]), ("m1", &["m0"]), ("m0", &[])]);
    c[0].stash = true;
    c[1].stash = true;
    check_all(&c);
    let rows = layout(&c);
    assert_eq!(lane_of(&rows, "s1"), 1);
    assert_eq!(lane_of(&rows, "s0"), 2);
    assert_eq!(lane_of(&rows, "m1"), 0, "the base takes the lane reserved for it");
    assert_eq!(lane_of(&rows, "m0"), 0);
    assert!(rows[0].edges.iter().all(|e| e.dashed), "stash edges are dotted");
    assert!(rows[0].edges.iter().all(|e| e.from_lane != 0), "placeholder draws nothing");
    let m1 = &rows[2];
    assert!(!m1.has_incoming, "stashes join from the side, nothing continues from above");
    let merges: Vec<&git_core::graph::Edge> =
        m1.edges.iter().filter(|e| e.kind == EdgeKind::MergeIn).collect();
    assert_eq!(merges.len(), 2);
    assert!(merges.iter().all(|e| e.dashed && e.to_lane == 0));
    assert!(m1.edges.iter().filter(|e| e.kind == EdgeKind::Straight).all(|e| !e.dashed));
    let mut st = LayoutState::new();
    st.push_all(&c);
    assert_eq!(st.active_lanes(), 0);
}

/// A stash on a commit some lane already waits for takes a free lane next to it.
#[test]
fn stash_on_a_waited_commit() {
    let mut c = chain(&[("m2", &["m1"]), ("s0", &["m1"]), ("m1", &["m0"]), ("m0", &[])]);
    c[1].stash = true;
    check_all(&c);
    let rows = layout(&c);
    assert_eq!(lane_of(&rows, "s0"), 1);
    assert_eq!(lane_of(&rows, "m1"), 0);
    assert_eq!(rows[1].edges.len(), 2, "stash lane plus the passthrough of main");
}

/// A stash allocated left of the lane waiting for its base never carries the base.
#[test]
fn stash_lane_never_carries_its_base() {
    let mut c = chain(&[
        ("t", &["t0"]),
        ("m2", &["m1"]),
        ("t0", &[]),
        ("s", &["m1"]),
        ("m1", &["m0"]),
        ("m0", &[]),
    ]);
    c[3].stash = true;
    check_all(&c);
    let rows = layout(&c);
    assert_eq!(lane_of(&rows, "s"), 0, "the freed lane left of main");
    assert_eq!(lane_of(&rows, "m1"), 1, "the base stays on the waiting lane");
    assert_eq!(lane_of(&rows, "m0"), 1);
    let m1 = &rows[4];
    assert!(m1.has_incoming);
    assert!(m1.edges.iter().all(|e| e.dashed == (e.kind == EdgeKind::MergeIn)));
}
