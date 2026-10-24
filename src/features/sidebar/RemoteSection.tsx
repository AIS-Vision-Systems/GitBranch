import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo } from "react";
import type { Remote } from "../../ipc/remote";
import type { RepoId } from "../../ipc/types";
import { Cloud, Plus } from "../../lib/icons";
import { hostOf, webUrlOf } from "../../lib/remoteUrl";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { reportError, useUiStore } from "../../state/ui";
import { openEditRemote, openRemotes } from "../dialogs/open";
import { useRemoteAvatar } from "../github/remoteAvatar";
import type { MenuItem } from "../shell/ContextMenu";
import { BranchTree } from "./BranchTreeView";
import { buildRemoteModel, useRemoteCount } from "./counts";
import { SidebarSection } from "./SidebarSection";
import styles from "./Sidebar.module.css";

async function copyRemoteUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    useUiStore.getState().pushToast({ kind: "success", title: "Remote link copied" });
  } catch (e) {
    reportError(e, "Could not copy to clipboard");
  }
}

function remoteMenu(repoId: RepoId, remote: Remote): MenuItem[] {
  const web = webUrlOf(remote.fetchUrl);
  const items: MenuItem[] = [
    {
      kind: "item",
      id: "edit",
      label: `Edit ${remote.name}…`,
      onSelect: () => openEditRemote(repoId, remote.name),
    },
  ];
  if (web !== null) {
    items.push({
      kind: "item",
      id: "open-web",
      label: hostOf(web) === "github.com" ? "Open on GitHub" : "Open in browser",
      onSelect: () => {
        void openUrl(web).catch((e: unknown) => reportError(e, "Could not open the browser"));
      },
    });
  }
  items.push(
    {
      kind: "item",
      id: "copy-link",
      label: "Copy URL",
      onSelect: () => void copyRemoteUrl(remote.fetchUrl),
    },
    { kind: "separator" },
    {
      kind: "item",
      id: "remove",
      label: `Remove ${remote.name}`,
      danger: true,
      // The ops action asks for confirmation itself.
      onSelect: () => void useOpsStore.getState().removeRemote(repoId, remote.name),
    },
  );
  return items;
}

function RemoteIcon({ repoId, name }: { repoId: RepoId; name: string }) {
  const src = useRemoteAvatar(repoId, name);
  if (src === null) {
    return <Cloud size={14} aria-hidden data-icon="remote" className={styles["treeFolder"]} />;
  }
  return <img className={styles["remoteAvatar"]} src={src} alt="" draggable={false} />;
}

export function RemoteSection({ repoId, query = "" }: { repoId: RepoId; query?: string }) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs?.refs);
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const count = useRemoteCount(repoId, query);
  const q = query.trim().toLowerCase();
  const filtering = q !== "";

  const remoteByName = useMemo(() => new Map(remotes.map((r) => [r.name, r])), [remotes]);

  const { nodes, expand } = useMemo(() => buildRemoteModel(refs, remotes, q), [refs, remotes, q]);

  return (
    <SidebarSection
      id="remote"
      icon={<Cloud size={14} />}
      title="Remote"
      count={count}
      actions={
        <button
          type="button"
          className={styles["headerAction"]}
          aria-label="Add remote…"
          title="Add remote…"
          onClick={() => openRemotes(repoId)}
        >
          <Plus size={14} aria-hidden />
        </button>
      }
    >
      {nodes.length === 0 ? (
        <div className={styles["sectionNote"]}>{filtering ? "No matches" : "No remotes"}</div>
      ) : (
        <BranchTree
          repoId={repoId}
          nodes={nodes}
          expand={expand}
          folderIcon={(f, level) =>
            level === 1 ? <RemoteIcon repoId={repoId} name={f.name} /> : undefined
          }
          folderMenu={(f, level) => {
            const remote = level === 1 ? remoteByName.get(f.name) : undefined;
            return remote === undefined ? null : remoteMenu(repoId, remote);
          }}
        />
      )}
    </SidebarSection>
  );
}
