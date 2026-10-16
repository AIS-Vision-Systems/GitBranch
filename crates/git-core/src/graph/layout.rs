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
    /// True when some lane was waiting for this commit (a line enters the node from above).
    pub has_incoming: bool,
    /// Segments to draw in this row.
    pub edges: Vec<Edge>,
}

/// Lane state carried across log chunks (incremental layout).
#[derive(Debug, Clone, Default)]
pub struct LayoutState {
    /// Target oid each lane is waiting for; `None` = free.
    lanes: Vec<Option<String>>,
    /// Color of each lane (meaningful while occupied).
    colors: Vec<u8>,
    palette: ColorAllocator,
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

    fn occupy(&mut self, target: &str) -> usize {
        let color = self.palette.alloc();
        if let Some(i) = self.lanes.iter().position(Option::is_none) {
            self.lanes[i] = Some(target.to_owned());
            self.colors[i] = color;
            i
        } else {
            self.lanes.push(Some(target.to_owned()));
            self.colors.push(color);
            self.lanes.len() - 1
        }
    }

    fn free(&mut self, lane: usize) {
        self.lanes[lane] = None;
        self.palette.release(self.colors[lane]);
    }

    /// Lay out one commit (commits must arrive children before parents).
    pub fn push(&mut self, commit: &Commit) -> Row {
        let oid = commit.oid.as_str();
        let mut edges = Vec::new();

        // Lanes waiting for this commit.
        let waiting: Vec<usize> = self
            .lanes
            .iter()
            .enumerate()
            .filter(|(_, t)| t.as_deref() == Some(oid))
            .map(|(i, _)| i)
            .collect();
        let has_incoming = !waiting.is_empty();
        let lane = if let Some((&l, rest)) = waiting.split_first() {
            for &m in rest {
                edges.push(Edge {
                    from_lane: lane_u16(m),
                    to_lane: lane_u16(l),
                    kind: EdgeKind::MergeIn,
                    color: self.colors[m],
                });
                self.free(m);
            }
            l
        } else {
            self.occupy(oid)
        };
        let color = self.colors[lane];

        // Continue to the first parent on the same lane.
        match commit.parents.first() {
            Some(p) => {
                self.lanes[lane] = Some(p.clone());
                edges.push(Edge {
                    from_lane: lane_u16(lane),
                    to_lane: lane_u16(lane),
                    kind: EdgeKind::Straight,
                    color,
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
            let existing = self.lanes.iter().position(|t| t.as_deref() == Some(p.as_str()));
            let target = existing.unwrap_or_else(|| {
                let l = self.occupy(p);
                fresh.push(l);
                l
            });
            if !branch_targets.contains(&target) {
                branch_targets.push(target);
                edges.push(Edge {
                    from_lane: lane_u16(lane),
                    to_lane: lane_u16(target),
                    kind: EdgeKind::BranchOut,
                    color: self.colors[target],
                });
            }
        }

        // Passthroughs for every other occupied lane.
        for (i, t) in self.lanes.iter().enumerate() {
            if t.is_some() && i != lane && !fresh.contains(&i) {
                edges.push(Edge {
                    from_lane: lane_u16(i),
                    to_lane: lane_u16(i),
                    kind: EdgeKind::Straight,
                    color: self.colors[i],
                });
            }
        }

        while matches!(self.lanes.last(), Some(None)) {
            self.lanes.pop();
            self.colors.pop();
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
