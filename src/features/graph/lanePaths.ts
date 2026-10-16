import type { EdgeKind, Row } from "../../ipc/types";
import { CURVE_R, LANE_W, PALETTE, ROW_H } from "./constants";

export interface LanePath {
  d: string;
  color: number;
  kind: EdgeKind | "incoming";
}

export const laneX = (lane: number): number => lane * LANE_W + LANE_W / 2;
export const colorIndex = (color: number): number => color % PALETTE;

const CY = ROW_H / 2;
/** Control-point offset of a cubic approximating a quarter circle. */
const K = 1 - 0.5523;
const R = CURVE_R;

/** Leaves the lane vertically, bends with radius R and arrives horizontally at the node. */
function mergeInPath(fx: number, nx: number): string {
  const dir = nx > fx ? 1 : -1;
  const y0 = CY - R;
  const ex = fx + dir * R;
  return `M ${fx} 0 L ${fx} ${y0} C ${fx} ${y0 + R * (1 - K)} ${fx + dir * R * K} ${CY} ${ex} ${CY} L ${nx} ${CY}`;
}

/** Leaves the node horizontally, bends with radius R and continues vertically down the new lane. */
function branchOutPath(nx: number, tx: number): string {
  const dir = tx > nx ? 1 : -1;
  const sx = tx - dir * R;
  return `M ${nx} ${CY} L ${sx} ${CY} C ${sx + dir * R * (1 - K)} ${CY} ${tx} ${CY + R * K} ${tx} ${CY + R} L ${tx} ${ROW_H}`;
}

/**
 * Path strings for one row, following the edge convention in ARCHITECTURE.md:
 * edges run from the top of the row to its bottom; the node lane draws its top
 * half only when `hasIncoming`.
 */
export function lanePaths(row: Row, hasIncoming: boolean): LanePath[] {
  const out: LanePath[] = [];
  const nx = laneX(row.lane);
  if (hasIncoming) {
    out.push({ d: `M ${nx} 0 L ${nx} ${CY}`, color: row.color, kind: "incoming" });
  }
  for (const e of row.edges) {
    const fx = laneX(e.fromLane);
    const tx = laneX(e.toLane);
    switch (e.kind) {
      case "straight":
        out.push({
          d:
            e.fromLane === row.lane
              ? `M ${nx} ${CY} L ${nx} ${ROW_H}`
              : `M ${fx} 0 L ${fx} ${ROW_H}`,
          color: e.color,
          kind: e.kind,
        });
        break;
      case "mergeIn":
        out.push({
          d: mergeInPath(fx, nx),
          color: e.color,
          kind: e.kind,
        });
        break;
      case "branchOut":
        out.push({
          d: branchOutPath(nx, tx),
          color: e.color,
          kind: e.kind,
        });
        break;
    }
  }
  return out;
}

/** Number of lane columns a set of rows needs (at least 1). */
export function laneCount(rows: readonly Row[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.lane > max) max = r.lane;
    for (const e of r.edges) {
      if (e.fromLane > max) max = e.fromLane;
      if (e.toLane > max) max = e.toLane;
    }
  }
  return max + 1;
}
