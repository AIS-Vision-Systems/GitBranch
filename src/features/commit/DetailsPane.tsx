import { useEffect, useMemo } from "react";
import type { RepoId } from "../../ipc/types";
import { useDetailsStore } from "../../state/details";
import { EMPTY_GRAPH, useGraphStore, WIP_OID } from "../../state/graph";
import { pullsOf, usePullsStore } from "../../state/pulls";
import { PullDetailView } from "../github/PullDetailView";
import { CommitDetails } from "./CommitDetails";
import type { FileListItem } from "./FileList";
import { commitItems, wipItems } from "./items";
import { WipPane } from "./WipPane";
import styles from "./Commit.module.css";

export function DetailsPane({ repoId }: { repoId: RepoId }) {
  const selectedOid = useGraphStore((s) => s.selectedOid);
  const select = useGraphStore((s) => s.select);
  const status = useGraphStore((s) => (s.byRepo[repoId] ?? EMPTY_GRAPH).status);
  const details = useDetailsStore((s) => s.details);
  const loadingDetails = useDetailsStore((s) => s.loadingDetails);
  const selectedFile = useDetailsStore((s) => s.selectedFile);
  const loadDetails = useDetailsStore((s) => s.loadDetails);
  const selectFile = useDetailsStore((s) => s.selectFile);
  const clear = useDetailsStore((s) => s.clear);

  useEffect(() => {
    if (selectedOid === null) clear();
    else if (selectedOid === WIP_OID) clear();
    else void loadDetails(repoId, selectedOid);
  }, [repoId, selectedOid, loadDetails, clear]);

  const pullSelected = usePullsStore((s) => pullsOf(s, repoId).selected !== null);

  const entries = status?.entries;
  const wip = useMemo(() => (entries === undefined ? [] : wipItems(entries)), [entries]);
  const commitFiles = useMemo(() => (details === null ? [] : commitItems(details)), [details]);

  const selectedKey = useMemo(() => {
    if (selectedFile === null) return null;
    const t = selectedFile.target;
    return t.kind === "commit" ? `c:${t.path}` : `${t.kind}:${t.path}`;
  }, [selectedFile]);

  // A fully staged/unstaged/discarded file leaves its section: drop its now-empty diff.
  useEffect(() => {
    if (selectedOid !== WIP_OID || selectedKey === null || entries === undefined) return;
    if (!wip.some((i) => i.key === selectedKey)) clear();
  }, [selectedOid, selectedKey, wip, entries, clear]);

  const onSelectFile = (item: FileListItem): void => {
    void selectFile(repoId, item.target, item.label);
  };

  if (pullSelected) {
    return (
      <div className={styles["pane"]}>
        <div className={styles["top"]}>
          <PullDetailView repoId={repoId} />
        </div>
      </div>
    );
  }

  let top;
  let fixed = false;
  if (selectedOid === null) {
    top = <p className={styles["placeholder"]}>Select a commit</p>;
  } else if (selectedOid === WIP_OID) {
    top = <WipPane repoId={repoId} items={wip} selectedKey={selectedKey} onSelect={onSelectFile} />;
  } else if (details === null) {
    top = <p className={styles["placeholder"]}>{loadingDetails ? "Loading…" : "No details"}</p>;
  } else {
    fixed = true;
    top = (
      <CommitDetails
        repoId={repoId}
        details={details}
        files={commitFiles}
        selectedKey={selectedKey}
        onSelectFile={onSelectFile}
        onSelectParent={select}
      />
    );
  }

  return (
    <div className={styles["pane"]}>
      <div className={fixed ? `${styles["top"]} ${styles["topFixed"]}` : styles["top"]}>{top}</div>
    </div>
  );
}
