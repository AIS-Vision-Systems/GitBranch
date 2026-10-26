import { WIP_OID } from "../state/graph";

/**
 * The oid to select when nothing is selected: the WIP row when shown, else the first commit
 * that is not a stash row (right after `git stash` the first row is the stash, not HEAD).
 */
export function firstRowOid(
  hasWip: boolean,
  rows: readonly { oid: string; stash?: boolean }[],
): string | null {
  if (hasWip) return WIP_OID;
  return rows.find((r) => r.stash !== true)?.oid ?? rows[0]?.oid ?? null;
}
