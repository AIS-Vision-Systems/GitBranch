import type { Commit, Refs, Row, Status } from "../ipc/types";

export function commit(
  oid: string,
  parents: string[] = [],
  subject = `commit ${oid}`,
  over: Partial<Commit> = {},
): Commit {
  return {
    oid,
    parents,
    authorName: "Ann",
    authorEmail: "ann@example.com",
    authorTime: 1_700_000_000,
    committerTime: 1_700_000_000,
    subject,
    stash: false,
    ...over,
  };
}

export function row(oid: string, over: Partial<Row> = {}): Row {
  return { oid, lane: 0, color: 0, hasIncoming: true, edges: [], ...over };
}

export const noRefs: Refs = { head: { oid: null, branch: null, detached: false }, refs: [] };
export const cleanStatus: Status = { branch: null, entries: [] };
