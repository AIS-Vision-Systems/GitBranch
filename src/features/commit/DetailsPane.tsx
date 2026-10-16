import { useEffect, useMemo } from "react";
import type { RepoId } from "../../ipc/types";
import { useDetailsStore } from "../../state/details";
import { EMPTY_GRAPH, useGraphStore, WIP_OID } from "../../state/graph";
import { DiffView } from "../diff/DiffView";
import { CommitDetails } from "./CommitDetails";
import { FileList, type FileListItem } from "./FileList";
import { commitItems, wipItems } from "./items";
import styles from "./Commit.module.css";

export function DetailsPane({ repoId }: { repoId: RepoId }) {
  const selectedOid = useGraphStore((s) => s.selectedOid);
  const select = useGraphStore((s) => s.select);
  const status = useGraphStore((s) => (s.byRepo[repoId] ?? EMPTY_GRAPH).status);
  const details = useDetailsStore((s) => s.details);
  const loadingDetails = useDetailsStore((s) => s.loadingDetails);
  const selectedFile = useDetailsStore((s) => s.selectedFile);
  const diff = useDetailsStore((s) => s.diff);
  const loadingDiff = useDetailsStore((s) => s.loadingDiff);
  const view = useDetailsStore((s) => s.view);
  const setView = useDetailsStore((s) => s.setView);
  const loadDetails = useDetailsStore((s) => s.loadDetails);
  const selectFile = useDetailsStore((s) => s.selectFile);
  const clear = useDetailsStore((s) => s.clear);

  useEffect(() => {
    if (selectedOid === null) clear();
    else if (selectedOid === WIP_OID) clear();
    else void loadDetails(repoId, selectedOid);
  }, [repoId, selectedOid, loadDetails, clear]);

  const entries = status?.entries;
  const wip = useMemo(() => (entries === undefined ? [] : wipItems(entries)), [entries]);
  const commitFiles = useMemo(() => (details === null ? [] : commitItems(details)), [details]);

  const selectedKey = useMemo(() => {
    if (selectedFile === null) return null;
    const t = selectedFile.target;
    return t.kind === "commit" ? `c:${t.path}` : `${t.kind}:${t.path}`;
  }, [selectedFile]);

  const onSelectFile = (item: FileListItem): void => {
    void selectFile(repoId, item.target, item.label);
  };

  let top;
  if (selectedOid === null) {
    top = <p className={styles["placeholder"]}>Select a commit</p>;
  } else if (selectedOid === WIP_OID) {
    top = (
      <>
        <p className={styles["placeholder"]}>Working tree</p>
        <FileList files={wip} selectedKey={selectedKey} onSelect={onSelectFile} />
      </>
    );
  } else if (details === null) {
    top = <p className={styles["placeholder"]}>{loadingDetails ? "Loading…" : "No details"}</p>;
  } else {
    top = (
      <CommitDetails
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
      <div className={styles["top"]}>{top}</div>
      {selectedFile !== null && (
        <DiffView
          diff={diff}
          loading={loadingDiff}
          label={selectedFile.label}
          view={view}
          onViewChange={setView}
        />
      )}
    </div>
  );
}
