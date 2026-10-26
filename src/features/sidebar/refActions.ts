import type { Ref, RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { refMenu } from "../graph/menus";
import type { MenuContext } from "../graph/menus";
import type { MenuItem } from "../shell/ContextMenu";

/** Menu items for `ref`, built at event time (no subscription needed). */
export function menuItemsFor(repoId: RepoId, ref: Ref): MenuItem[] {
  const g = useGraphStore.getState().byRepo[repoId];
  const i = g?.byOid.get(ref.target);
  const commit = (i === undefined ? undefined : g?.commits[i]) ?? {
    oid: ref.target,
    parents: [],
    authorName: "",
    authorEmail: "",
    authorTime: 0,
    committerTime: 0,
    subject: "",
    stash: false,
  };
  const ctx: MenuContext = {
    repoId,
    commit,
    refs: [ref],
    head: g?.refs?.head ?? null,
    inProgress: (g?.inProgress ?? null) !== null,
  };
  return refMenu(ctx, ref);
}

/** Runs exactly the "Checkout" item of the ref context menu (respecting its disabled state). */
export function checkoutRef(repoId: RepoId, ref: Ref): void {
  const item = menuItemsFor(repoId, ref).find((m) => m.kind === "item" && m.id === "checkout");
  if (item?.kind === "item" && item.disabled !== true) item.onSelect();
}
