/** Registry ids of the Phase 2 custom dialogs. */
export const DIALOG = {
  createBranch: "branch.create",
  renameBranch: "branch.rename",
  setUpstream: "branch.upstream",
  stashPush: "stash.push",
  createTag: "tag.create",
  reset: "history.reset",
  merge: "merge.merge",
  rebase: "merge.rebase",
  branchDrop: "merge.branchDrop",
} as const;
