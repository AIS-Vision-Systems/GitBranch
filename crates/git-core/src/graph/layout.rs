//! Lane allocation ("active lanes" sweep) for the commit graph.
//!
//! Each [`Row`] is drawn independently. Coordinates are lanes (columns); a row has a
//! top edge (towards the previous row) and a bottom edge (towards the next row):
//!
//! ```text
//!   lane: 0 1 2
//!         | | |      Straight  from==to: passes through the row, top to bottom
//!         | |/       MergeIn   from=2,to=1: line enters at the TOP of lane 2, ends at the node (lane 1)
//!         | *        node of this row (Row.lane = 1)
//!         |/|\       BranchOut from=1,to=2: leaves the node, ends at the BOTTOM of lane 2
//!         | | |      Straight  from==to==1 (node lane continuing to parents[0])
//! ```
//!
//! * `Straight`: top-to-bottom passthrough on one lane. The node's own lane has one
//!   to `parents[0]` (none for a root). A lane that was already waiting above and is the
//!   target of a `BranchOut` keeps its `Straight` too (the two join at the bottom); only
//!   lanes newly allocated in this row have no `Straight`.
//! * `MergeIn { from_lane: L, to_lane: node }`: another lane that was waiting for this commit.
//! * `BranchOut { from_lane: node, to_lane: L }`: an extra parent, on a new or already waiting lane.
//!
//! Renderer rule for the node lane: draw top-to-center only if `Row.has_incoming`; draw
//! center-to-bottom only if a `Straight`/`BranchOut` edge starts at the node (a root has none).
//!
//! A lane keeps its color from allocation until freed.
//!
//! # Which lane gets the node
//!
//! Several lanes may wait for the same commit. Each lane belongs to a *chain*: a chain starts
//! at a tip (a commit nothing waits for) or at a `BranchOut`, and follows first parents. A lane
//! started by a `BranchOut` is *fresh* until it reaches its target: it stands for the branch
//! that was merged, and its target is that branch's tip. The node goes to
//!
//! 1. the placeholder lane reserved for a stash base (see below), else
//! 2. the fresh lane, so the merged branch keeps its own lane and the first-parent chains that
//!    reach the same commit end sideways into it (a branch "born" from that tip), unless one of
//!    those chains is an ancestor of the fresh lane's chain (the merge pulled an upstream commit
//!    into a downstream branch; the upstream stays put and the fresh lane ends with no commits), else
//! 3. the leftmost waiting lane.
//!
//! Without rule 2 a merged branch whose tip is also the base of a later branch would be drawn
//! on the later branch's lane, and the merge lane would look like an empty branch.
//!
//! # Stashes
//!
//! A stash is a synthetic commit (`Commit::stash`) with its base as the only parent, placed
//! right above the base. Its lane is `dashed`, so every edge on it is drawn dotted. When no
//! lane waits for the base yet, a *placeholder* lane is reserved for the base first, so the
//! stash lands beside the lane the base will take instead of straight above it. A placeholder
//! draws nothing and does not count as incoming.

use serde::{Deserialize, Serialize};

use super::color::ColorAllocator;
use crate::parse::log::Commit;

/// Kind of an [`Edge`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeKind {
    /// Top-to-bottom passthrough on one lane.
    Straight,
    /// A lane joining the node from above.
    MergeIn,
    /// The node leaving downwards to another lane.
    BranchOut,
}

/// A line segment within one row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    /// Lane where the segment starts.
    pub from_lane: u16,
    /// Lane where the segment ends.
    pub to_lane: u16,
    /// Segment kind.
    pub kind: EdgeKind,
    /// Palette index.
    pub color: u8,
    /// Drawn dotted (the lane links a stash to its base).
    #[serde(default)]
    pub dashed: bool,
}

/// One laid-out commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    /// Commit id.
    pub oid: String,
    /// Lane of the node.
    pub lane: u16,
    /// Palette index of the node.
    pub color: u8,
    /// True when the node lane was already waiting for this commit (a line enters the node from
    /// above). False for tips and for a stash base whose only children are stashes: those join
    /// from the side.
    pub has_incoming: bool,
    /// Segments to draw in this row.
    pub edges: Vec<Edge>,
}

/// One occupied lane.
#[derive(Debug, Clone)]
struct Lane {
    /// Commit this lane is waiting for.
    target: String,
    /// Palette index.
    color: u8,
    /// Chain id (unique per allocation).
    chain: u32,
    /// Chains this chain was branched out from, transitively.
    ancestors: Vec<u32>,
    /// Allocated by a `BranchOut` and not yet arrived at its target.
    fresh: bool,
    /// Reserved for a stash base; draws nothing until the base arrives.
    placeholder: bool,
    /// Links a stash to its base; every edge on it is dotted.
    dashed: bool,
}

/// Lane state carried across log chunks (incremental layout).
#[derive(Debug, Clone, Default)]
pub struct LayoutState {
    /// Lanes; `None` = free.
    lanes: Vec<Option<Lane>>,
    palette: ColorAllocator,
    next_chain: u32,
}

#[allow(clippy::cast_possible_truncation)] // lane counts are far below u16::MAX
fn lane_u16(i: usize) -> u16 {
    i as u16
}

impl LayoutState {
    /// Empty state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of lanes currently waiting for a commit.
    #[must_use]
    pub fn active_lanes(&self) -> usize {
        self.lanes.iter().filter(|l| l.is_some()).count()
    }

    fn occupy(
        &mut self,
        target: &str,
        ancestors: Vec<u32>,
        fresh: bool,
        placeholder: bool,
    ) -> usize {
        let lane = Lane {
            target: target.to_owned(),
            color: self.palette.alloc(),
            chain: self.next_chain,
            ancestors,
            fresh,
            placeholder,
            dashed: false,
        };
        self.next_chain = self.next_chain.wrapping_add(1);
        if let Some(i) = self.lanes.iter().position(Option::is_none) {
            self.lanes[i] = Some(lane);
            i
        } else {
            self.lanes.push(Some(lane));
            self.lanes.len() - 1
        }
    }

    fn free(&mut self, lane: usize) {
        if let Some(l) = self.lanes[lane].take() {
            self.palette.release(l.color);
        }
    }

    fn lane(&self, i: usize) -> &Lane {
        self.lanes[i].as_ref().expect("lane index taken from an occupied lane")
    }

    fn position(&self, target: &str) -> Option<usize> {
        self.lanes.iter().position(|l| l.as_ref().is_some_and(|l| l.target == target))
    }

    /// Picks the node lane among the lanes waiting for a commit (see the module docs).
    fn choose(&self, waiting: &[usize]) -> usize {
        if let Some(&p) = waiting.iter().find(|&&i| self.lane(i).placeholder) {
            return p;
        }
        if let Some(&f) = waiting.iter().find(|&&i| self.lane(i).fresh) {
            let upstream = waiting
                .iter()
                .any(|&k| k != f && self.lane(f).ancestors.contains(&self.lane(k).chain));
            if !upstream {
                return f;
            }
        }
        // A stash lane never carries its base (it may sit left of the lane waiting for it).
        waiting.iter().copied().find(|&i| !self.lane(i).dashed).unwrap_or(waiting[0])
    }

    /// Lay out one commit (commits must arrive children before parents).
    pub fn push(&mut self, commit: &Commit) -> Row {
        let oid = commit.oid.as_str();
        let mut edges = Vec::new();

        // A stash sits beside the lane its base will take: reserve that lane first.
        if commit.stash
            && let Some(base) = commit.parents.first()
            && self.position(base).is_none()
        {
            self.occupy(base, Vec::new(), true, true);
        }

        // Lanes waiting for this commit.
        let waiting: Vec<usize> = self
            .lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.as_ref().is_some_and(|l| l.target == oid))
            .map(|(i, _)| i)
            .collect();
        let (lane, has_incoming) = if waiting.is_empty() {
            (self.occupy(oid, Vec::new(), false, false), false)
        } else {
            let l = self.choose(&waiting);
            // A placeholder draws nothing above, so the node has no line to continue.
            let has_incoming = !self.lane(l).placeholder;
            for &m in waiting.iter().filter(|&&m| m != l) {
                let from = self.lane(m);
                if !from.placeholder {
                    edges.push(Edge {
                        from_lane: lane_u16(m),
                        to_lane: lane_u16(l),
                        kind: EdgeKind::MergeIn,
                        color: from.color,
                        dashed: from.dashed,
                    });
                }
                self.free(m);
            }
            (l, has_incoming)
        };
        let (color, chain, ancestors, dashed) = {
            let l = self.lanes[lane].as_mut().expect("node lane is occupied");
            l.fresh = false;
            l.placeholder = false;
            l.dashed = commit.stash;
            // Ancestors are only needed to open lanes for extra parents.
            let anc = if commit.parents.len() > 1 { l.ancestors.clone() } else { Vec::new() };
            (l.color, l.chain, anc, l.dashed)
        };

        // Continue to the first parent on the same lane.
        match commit.parents.first() {
            Some(p) => {
                if let Some(l) = self.lanes[lane].as_mut() {
                    l.target.clone_from(p);
                }
                edges.push(Edge {
                    from_lane: lane_u16(lane),
                    to_lane: lane_u16(lane),
                    kind: EdgeKind::Straight,
                    color,
                    dashed,
                });
            }
            None => self.free(lane),
        }

        // Extra parents.
        let mut branch_targets: Vec<usize> = Vec::new();
        let mut fresh: Vec<usize> = Vec::new();
        for (k, p) in commit.parents.iter().enumerate().skip(1) {
            if commit.parents[..k].contains(p) {
                continue;
            }
            let target = self.position(p).unwrap_or_else(|| {
                let mut anc = ancestors.clone();
                anc.push(chain);
                let l = self.occupy(p, anc, true, false);
                fresh.push(l);
                l
            });
            if !branch_targets.contains(&target) {
                branch_targets.push(target);
                let to = self.lane(target);
                edges.push(Edge {
                    from_lane: lane_u16(lane),
                    to_lane: lane_u16(target),
                    kind: EdgeKind::BranchOut,
                    color: to.color,
                    dashed: to.dashed,
                });
            }
        }

        // Passthroughs for every other occupied lane.
        for (i, l) in self.lanes.iter().enumerate() {
            if let Some(l) = l
                && i != lane
                && !l.placeholder
                && !fresh.contains(&i)
            {
                edges.push(Edge {
                    from_lane: lane_u16(i),
                    to_lane: lane_u16(i),
                    kind: EdgeKind::Straight,
                    color: l.color,
                    dashed: l.dashed,
                });
            }
        }

        while matches!(self.lanes.last(), Some(None)) {
            self.lanes.pop();
        }

        Row { oid: commit.oid.clone(), lane: lane_u16(lane), color, has_incoming, edges }
    }

    /// Lay out a chunk of commits, continuing from the current state.
    pub fn push_all(&mut self, commits: &[Commit]) -> Vec<Row> {
        commits.iter().map(|c| self.push(c)).collect()
    }
}

/// Lay out a full commit list from a fresh state.
#[must_use]
pub fn layout(commits: &[Commit]) -> Vec<Row> {
    LayoutState::new().push_all(commits)
}
