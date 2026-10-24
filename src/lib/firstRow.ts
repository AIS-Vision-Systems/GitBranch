import { WIP_OID } from "../state/graph";

/** The oid to select when nothing is selected: the WIP row when shown, else the first commit. */
export function firstRowOid(hasWip: boolean, rows: readonly { oid: string }[]): string | null {
  if (hasWip) return WIP_OID;
  return rows[0]?.oid ?? null;
}
