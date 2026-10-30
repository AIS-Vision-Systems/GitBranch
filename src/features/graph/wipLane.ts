import type { Commit, Row } from "../../ipc/types";

/** Where the working-tree row sits and how its dashed connector reaches HEAD. */
export interface WipPlacement {
  lane: number;
  color: number;
  /** The connector reaches HEAD (false: HEAD is not loaded). */
  connected: boolean;
  /** Lane of the connector through the rows above HEAD (null: none, HEAD is the first commit row). */
  throughLane: number | null;
  /** The connector bends into HEAD's node from `lane` (HEAD has real commits above it). */
  joinsFromSide: boolean;
}

function occupies(row: Row, lane: number): boolean {
  return row.lane === lane || row.edges.some((e) => e.fromLane === lane || e.toLane === lane);
}

/**
 * Places the WIP row. With HEAD first (or only stashes above it) it stays on HEAD's lane, as before.
 * Otherwise the commits above HEAD belong to other branches, so the WIP row takes the first lane right
 * of HEAD that is free from the top down to HEAD, and its connector runs down that lane and bends
 * into HEAD's node: the changes read as HEAD's, not as the first row's branch.
 */
export function wipPlacement(
  rows: readonly Row[],
  commits: readonly Commit[],
  headRow: number | undefined,
): WipPlacement {
  const head = headRow !== undefined ? rows[headRow] : undefined;
  if (headRow === undefined || head === undefined) {
    return { lane: 0, color: 0, connected: false, throughLane: null, joinsFromSide: false };
  }
  const base = { color: head.color, connected: true };
  let onlyStashes = true;
  for (let i = 0; i < headRow; i++) if (commits[i]?.stash !== true) onlyStashes = false;
  if (onlyStashes) {
    return {
      ...base,
      lane: head.lane,
      throughLane: headRow > 0 ? head.lane : null,
      joinsFromSide: false,
    };
  }
  let lane = head.lane + 1;
  const above = rows.slice(0, headRow + 1);
  while (above.some((r) => occupies(r, lane))) lane++;
  return { ...base, lane, throughLane: lane, joinsFromSide: true };
}
