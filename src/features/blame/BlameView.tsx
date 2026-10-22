import { memo, useEffect, useMemo, useState } from "react";
import { blame, type Blame } from "../../ipc/blame";
import type { RepoId } from "../../ipc/types";
import { formatAbsolute, formatRelative } from "../../lib/time";
import { useGraphStore } from "../../state/graph";
import { reportError, useUiStore } from "../../state/ui";
import { buildBlameRows, isUncommitted, type BlameRow } from "./rows";
import styles from "./BlameView.module.css";

const SHORT_OID = 7;

const BlameLine = memo(function BlameLine({
  row,
  now,
  onSelect,
}: {
  row: BlameRow;
  now: number;
  onSelect: (oid: string) => void;
}) {
  const { hunk } = row;
  const uncommitted = isUncommitted(hunk.oid);
  const cls = [
    styles["row"],
    row.shade === 1 ? styles["shade1"] : "",
    row.first ? styles["hunkStart"] : "",
    uncommitted ? styles["muted"] : "",
  ]
    .filter((c) => c !== "")
    .join(" ");
  return (
    <div className={cls}>
      <div
        className={styles["gutter"]}
        title={
          uncommitted
            ? "Not committed yet"
            : `${hunk.summary}\n${hunk.author}, ${formatAbsolute(hunk.authorTime)}`
        }
      >
        {row.first && (
          <>
            {uncommitted ? (
              <span className={styles["oid"]}>local</span>
            ) : (
              <button
                type="button"
                className={styles["oid"]}
                aria-label={`Select commit ${hunk.oid.slice(0, SHORT_OID)}`}
                onClick={() => onSelect(hunk.oid)}
              >
                {hunk.oid.slice(0, SHORT_OID)}
              </button>
            )}
            <span className={styles["author"]}>{uncommitted ? "Not committed" : hunk.author}</span>
            {!uncommitted && (
              <span className={styles["date"]}>{formatRelative(hunk.authorTime, now)}</span>
            )}
          </>
        )}
      </div>
      <span className={styles["lineNo"]}>{row.line}</span>
      <pre className={styles["text"]}>{row.text}</pre>
    </div>
  );
});

/** Per-line blame of one file, shown in the center pane in place of the graph. */
export function BlameView({ repoId }: { repoId: RepoId }) {
  const target = useUiStore((s) => s.blameTarget);
  const showGraph = useUiStore((s) => s.showGraph);
  const select = useGraphStore((s) => s.select);
  const own = target !== null && target.repoId === repoId;
  const path = own ? target.path : undefined;
  const rev = own ? target.rev : undefined;
  const key = `${repoId}|${rev ?? ""}|${path ?? ""}`;
  // Results are tagged with the request key, so a stale result reads as "loading".
  const [result, setResult] = useState<{
    key: string;
    now: number;
    data: Blame | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (path === undefined) return;
    let stale = false;
    blame(repoId, path, rev)
      .then((data) => {
        if (!stale) setResult({ key, now: Math.floor(Date.now() / 1000), data, error: null });
      })
      .catch((e: unknown) => {
        if (stale) return;
        setResult({
          key,
          now: 0,
          data: null,
          error: e instanceof Error ? e.message : String(e),
        });
        reportError(e, "Could not load blame");
      });
    return () => {
      stale = true;
    };
  }, [repoId, path, rev, key]);

  const current = result?.key === key ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const now = current?.now ?? 0;
  const rows = useMemo(() => (data === null ? [] : buildBlameRows(data)), [data]);

  // The target is global: a tab switch must not blame the old path in the new repo.
  const foreign = target !== null && target.repoId !== repoId;
  useEffect(() => {
    if (foreign) showGraph();
  }, [foreign, showGraph]);
  if (target === null || foreign) return null;
  return (
    <div className={styles["root"]}>
      <div className={styles["header"]}>
        <span className={styles["path"]} title={target.path}>
          {target.path}
        </span>
        <span className={styles["rev"]}>
          Blame · {target.rev !== undefined ? target.rev.slice(0, SHORT_OID) : "working tree"}
        </span>
        <button
          type="button"
          className={styles["close"]}
          aria-label="Close blame"
          onClick={showGraph}
        >
          ×
        </button>
      </div>
      <div className={styles["body"]}>
        {error !== null ? (
          <p className={styles["error"]}>{error}</p>
        ) : data === null ? (
          <p className={styles["status"]}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={styles["status"]}>Empty file</p>
        ) : (
          rows.map((r) => <BlameLine key={r.line} row={r} now={now} onSelect={select} />)
        )}
      </div>
    </div>
  );
}
