import type { CommitDetails as Details } from "../../ipc/commit";
import type { RepoId } from "../../ipc/types";
import { formatAbsolute } from "../../lib/time";
import { Avatar } from "../github/Avatar";
import { reportError, useUiStore } from "../../state/ui";
import { countStatuses, statusOf, summaryText } from "../../lib/fileTree";
import { useMemo } from "react";
import { useFileMenu } from "./fileMenu";
import { FileList, type FileListItem } from "./FileList";
import { ExpandLink, FileTree, TreeModeToggle } from "./FileTree";
import { useExpanded, useTreeMode } from "./treeState";
import styles from "./Commit.module.css";

export const SHORT_OID = 7;

/** Stable reference: a commit's tree starts fully collapsed. */
const EMPTY: ReadonlySet<string> = new Set<string>();

async function copyOid(oid: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(oid);
    useUiStore.getState().pushToast({ kind: "success", title: "Commit id copied" });
  } catch (e) {
    reportError(e, "Could not copy to clipboard");
  }
}

export interface CommitDetailsProps {
  repoId: RepoId;
  details: Details;
  files: FileListItem[];
  selectedKey: string | null;
  onSelectFile: (item: FileListItem) => void;
  onSelectParent: (oid: string) => void;
}

export function CommitDetails({
  repoId,
  details: d,
  files,
  selectedKey,
  onSelectFile,
  onSelectParent,
}: CommitDetailsProps) {
  const { onItemMenu, menu } = useFileMenu(repoId);
  const [tree, chooseTree] = useTreeMode();
  const [expanded, setExpanded] = useExpanded(`${repoId}:${d.oid}`, EMPTY);
  const summary = useMemo(() => summaryText(countStatuses(files, statusOf)), [files]);
  const sameAsAuthor =
    d.committerName === d.authorName &&
    d.committerEmail === d.authorEmail &&
    d.committerTime === d.authorTime;
  return (
    <div className={styles["details"]}>
      <header className={styles["header"]}>
        <div className={styles["idRow"]}>
          <code className={styles["oid"]} title={d.oid}>
            {d.oid.slice(0, SHORT_OID)}
          </code>
          <button
            type="button"
            className={styles["copy"]}
            aria-label="Copy commit id"
            onClick={() => void copyOid(d.oid)}
          >
            Copy
          </button>
          {d.parents.length > 0 && (
            <div className={styles["parents"]}>
              <span className={styles["role"]}>{d.parents.length > 1 ? "Parents" : "Parent"}</span>
              {d.parents.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={styles["parent"]}
                  title={p}
                  onClick={() => onSelectParent(p)}
                >
                  {p.slice(0, SHORT_OID)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles["messageBox"]}>
          <h2 className={styles["subject"]}>{d.subject}</h2>
          {d.body !== "" && <pre className={styles["body"]}>{d.body}</pre>}
        </div>
        <div className={styles["authorRow"]}>
          <Avatar name={d.authorName} email={d.authorEmail} size={40} repoId={repoId} />
          <div className={styles["authorInfo"]}>
            <span className={styles["name"]} title={d.authorEmail}>
              {d.authorName}
            </span>
            <span className={styles["date"]}>authored {formatAbsolute(d.authorTime)}</span>
            {!sameAsAuthor && (
              <span className={styles["date"]} title={d.committerEmail}>
                committed by {d.committerName} {formatAbsolute(d.committerTime)}
              </span>
            )}
          </div>
        </div>
        {d.coAuthors.length > 0 && (
          <div className={styles["coAuthors"]}>
            <span className={styles["role"]}>Co-authors:</span>
            {d.coAuthors.map((c) => (
              <span
                key={`${c.name}<${c.email}>`}
                className={styles["chip"]}
                title={`${c.name} <${c.email}>`}
              >
                <Avatar name={c.name} email={c.email} size={18} repoId={repoId} />
                {c.name}
              </span>
            ))}
          </div>
        )}
        <div className={styles["fileHeader"]}>
          <span className={styles["summaryText"]}>{summary}</span>
          <TreeModeToggle tree={tree} onChange={chooseTree} />
          {tree && files.length > 0 && <ExpandLink expanded={expanded} onChange={setExpanded} />}
        </div>
      </header>
      <div className={styles["files"]}>
        {tree && files.length > 0 ? (
          <FileTree
            files={files}
            selectedKey={selectedKey}
            onSelect={onSelectFile}
            onItemMenu={onItemMenu}
            ariaLabel="Changed files"
            expanded={expanded}
            onExpandedChange={setExpanded}
          />
        ) : (
          <FileList
            files={files}
            selectedKey={selectedKey}
            onSelect={onSelectFile}
            onItemMenu={onItemMenu}
          />
        )}
      </div>
      {menu}
    </div>
  );
}
