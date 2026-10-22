import { useCallback, type MouseEvent, type ReactNode } from "react";
import type { RepoId } from "../../ipc/types";
import { NO_FILTER, useGraphStore } from "../../state/graph";
import { useUiStore } from "../../state/ui";
import { ContextMenu, type MenuItem } from "../shell/ContextMenu";
import { useContextMenu } from "../shell/useContextMenu";
import type { FileListItem } from "./FileList";

/** Show the graph filtered to commits touching `path`. */
export function showFileHistory(repoId: RepoId, path: string): void {
  const g = useGraphStore.getState();
  void g.setFilter(repoId, { ...(g.filters[repoId] ?? NO_FILTER), path });
  g.openFilterBar(repoId);
  useUiStore.getState().showGraph();
}

/** Revision a file's blame refers to: the commit for commit files, else the working tree. */
export function blameRev(item: FileListItem): string | undefined {
  return item.target.kind === "commit" ? item.target.oid : undefined;
}

export function fileMenuItems(repoId: RepoId, item: FileListItem): MenuItem[] {
  const deleted = item.kind === "deleted";
  const untracked = item.target.kind === "untracked";
  const rev = blameRev(item);
  const newInIndex = item.target.kind === "staged" && item.kind === "added";
  return [
    {
      kind: "item",
      id: "blame",
      label: item.target.kind === "staged" ? "Blame (working tree)" : "Blame",
      disabled: deleted || untracked || newInIndex,
      onSelect: () => useUiStore.getState().showBlame(repoId, item.path, rev),
    },
    {
      kind: "item",
      id: "history",
      label: "File history",
      disabled: untracked,
      onSelect: () => showFileHistory(repoId, item.path),
    },
  ];
}

/** Context menu for file rows: `onItemMenu` goes on the list, `menu` is rendered once. */
export function useFileMenu(repoId: RepoId): {
  onItemMenu: (e: MouseEvent, item: FileListItem) => void;
  menu: ReactNode;
} {
  const ctx = useContextMenu<FileListItem>();
  const { open } = ctx;
  const onItemMenu = useCallback((e: MouseEvent, item: FileListItem) => open(e, item), [open]);
  const menu =
    ctx.menu !== null ? (
      <ContextMenu
        x={ctx.menu.x}
        y={ctx.menu.y}
        items={fileMenuItems(repoId, ctx.menu.data)}
        onClose={ctx.close}
      />
    ) : null;
  return { onItemMenu, menu };
}
