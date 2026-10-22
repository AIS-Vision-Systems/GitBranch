import {
  openClone,
  openCreateBranch,
  openCreateTag,
  openPull,
  openPush,
  openSettings,
  openStashPush,
} from "../features/dialogs/open";
import { useGraphStore } from "../state/graph";
import { useOpsStore } from "../state/ops";
import type { Command } from "../state/palette";
import { remotesOf, useRemotesStore } from "../state/remotes";
import { useReposStore } from "../state/repos";
import { useUpdaterStore } from "../state/updater";

const FETCH_ALL = { remote: null, prune: true, tags: false };

/** Build the palette entries for the current app state. Commands needing a repo are omitted without one. */
export function buildCommands(): Command[] {
  const repos = useReposStore.getState();
  const cmds: Command[] = [
    { id: "open", title: "Open repository", shortcut: "Ctrl+O", run: () => repos.openViaDialog() },
    { id: "clone", title: "Clone repository", shortcut: "Ctrl+Shift+C", run: () => openClone() },
    { id: "settings", title: "Open settings", shortcut: "Ctrl+,", run: () => openSettings() },
    {
      id: "check-updates",
      title: "Check for updates",
      run: () => useUpdaterStore.getState().check({ manual: true }),
    },
    { id: "new-tab", title: "New tab", shortcut: "Ctrl+T", run: () => repos.newTab() },
  ];
  if (repos.open.length > 1) {
    cmds.push({
      id: "next-tab",
      title: "Next tab",
      shortcut: "Ctrl+PageDown",
      run: () => repos.nextTab(1),
    });
  }
  const current = repos.open.find((r) => r.repoId === repos.currentId);
  if (current === undefined) return cmds;
  const repoId = current.repoId;

  const g = useGraphStore.getState().byRepo[repoId];
  const hasRemotes = remotesOf(useRemotesStore.getState(), repoId).length > 0;
  const headOid = g?.refs?.head.oid ?? null;
  const ops = useOpsStore.getState();
  if (hasRemotes) {
    cmds.push(
      {
        id: "fetch",
        title: "Fetch all remotes",
        shortcut: "Ctrl+Shift+F",
        run: () => void ops.fetch(repoId, FETCH_ALL),
      },
      { id: "pull", title: "Pull", shortcut: "Ctrl+Shift+L", run: () => openPull(repoId) },
      { id: "push", title: "Push", shortcut: "Ctrl+Shift+P", run: () => openPush(repoId) },
    );
  }
  if (headOid !== null) {
    cmds.push(
      {
        id: "branch",
        title: "Create branch",
        run: () => openCreateBranch(repoId, headOid, "HEAD"),
      },
      { id: "tag", title: "Create tag", run: () => openCreateTag(repoId, headOid, "HEAD") },
    );
  }
  if ((g?.status?.entries.length ?? 0) > 0) {
    cmds.push({ id: "stash", title: "Stash changes", run: () => openStashPush(repoId) });
  }
  cmds.push({
    id: "filter",
    title: "Focus commit filter",
    shortcut: "Ctrl+F",
    run: () => useGraphStore.getState().openFilterBar(repoId),
  });
  for (const r of g?.refs?.refs ?? []) {
    if (r.kind !== "localBranch" || r.isHead) continue;
    cmds.push({
      id: `checkout:${r.name}`,
      title: `Checkout branch: ${r.name}`,
      run: () => void ops.checkout(repoId, r.name),
    });
  }
  return cmds;
}
