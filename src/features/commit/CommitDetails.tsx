import type { CommitDetails as Details } from "../../ipc/commit";
import { formatAbsolute } from "../../lib/time";
import { reportError, useUiStore } from "../../state/ui";
import { FileList, type FileListItem } from "./FileList";
import styles from "./Commit.module.css";

export const SHORT_OID = 7;

function Person({
  role,
  name,
  email,
  time,
}: {
  role: string;
  name: string;
  email: string;
  time: number;
}) {
  return (
    <div className={styles["person"]}>
      <span className={styles["role"]}>{role}</span>
      <span className={styles["name"]} title={email}>
        {name}
      </span>
      <span className={styles["date"]}>{formatAbsolute(time)}</span>
    </div>
  );
}

async function copyOid(oid: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(oid);
    useUiStore.getState().pushToast({ kind: "success", title: "Commit id copied" });
  } catch (e) {
    reportError(e, "Could not copy to clipboard");
  }
}

export interface CommitDetailsProps {
  details: Details;
  files: FileListItem[];
  selectedKey: string | null;
  onSelectFile: (item: FileListItem) => void;
  onSelectParent: (oid: string) => void;
}

export function CommitDetails({
  details: d,
  files,
  selectedKey,
  onSelectFile,
  onSelectParent,
}: CommitDetailsProps) {
  const sameAsAuthor =
    d.committerName === d.authorName &&
    d.committerEmail === d.authorEmail &&
    d.committerTime === d.authorTime;
  return (
    <div className={styles["details"]}>
      <header className={styles["header"]}>
        <h2 className={styles["subject"]}>{d.subject}</h2>
        {d.body !== "" && <pre className={styles["body"]}>{d.body}</pre>}
        <Person role="Author" name={d.authorName} email={d.authorEmail} time={d.authorTime} />
        {!sameAsAuthor && (
          <Person
            role="Committer"
            name={d.committerName}
            email={d.committerEmail}
            time={d.committerTime}
          />
        )}
        <div className={styles["ids"]}>
          <span className={styles["role"]}>Commit</span>
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
        </div>
        {d.parents.length > 0 && (
          <div className={styles["ids"]}>
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
      </header>
      <FileList files={files} selectedKey={selectedKey} onSelect={onSelectFile} />
    </div>
  );
}
