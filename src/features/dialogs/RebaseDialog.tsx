import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { rebaseTodo, type TodoAction } from "../../ipc/merge";
import type { RepoId } from "../../ipc/types";
import { shortOid, useOpsStore } from "../../state/ops";
import { reportError } from "../../state/ui";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";
import { moveRow, validateTodo, type TodoRow } from "./todo";

export interface RebaseDialogProps {
  repoId: RepoId;
  onto: string;
  ontoLabel: string;
  current: string;
  onClose: () => void;
}

const ACTIONS: TodoAction[] = ["pick", "squash", "fixup", "drop"];

export function RebaseDialog({ repoId, onto, ontoLabel, current, onClose }: RebaseDialogProps) {
  const [interactive, setInteractive] = useState(false);
  const [rows, setRows] = useState<TodoRow[] | null>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const rebase = useOpsStore((s) => s.rebase);
  const rebaseInteractive = useOpsStore((s) => s.rebaseInteractive);

  useEffect(() => {
    if (!interactive || rows !== null) return;
    let cancelled = false;
    rebaseTodo(repoId, onto).then(
      (todo) => {
        if (cancelled) return;
        setRows(todo.map((t) => ({ oid: t.oid, subject: t.subject, action: "pick" })));
      },
      (e: unknown) => {
        reportError(e, "Could not list the commits to rebase");
        if (!cancelled) setInteractive(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [interactive, rows, repoId, onto]);

  const setAction = (i: number, action: TodoAction): void =>
    setRows((r) => r?.map((x, j) => (j === i ? { ...x, action } : x)) ?? r);

  const move = (i: number, delta: -1 | 1): void => {
    setRows((r) => (r === null ? r : moveRow(r, i, delta)));
    // Keep focus on the moved row once React has re-rendered.
    requestAnimationFrame(() =>
      listRef.current?.querySelectorAll<HTMLElement>("li")[i + delta]?.focus(),
    );
  };

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, i: number): void => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    move(i, e.key === "ArrowUp" ? -1 : 1);
  };

  const loading = interactive && rows === null;
  const empty = interactive && rows !== null && rows.length === 0;
  const problem = interactive && rows !== null && !empty ? validateTodo(rows) : null;
  const valid = !interactive || (rows !== null && !empty && problem === null);

  return (
    <FormDialog
      title="Rebase"
      submitLabel={interactive ? "Start rebase" : `Rebase ${current} onto ${ontoLabel}`}
      valid={valid}
      initialFocusRef={checkRef}
      onClose={onClose}
      onSubmit={() =>
        interactive && rows !== null
          ? rebaseInteractive(
              repoId,
              onto,
              rows.map((r) => ({ action: r.action, oid: r.oid })),
            )
          : rebase(repoId, onto)
      }
    >
      <div className={styles["hint"]}>
        Replay <code>{current}</code> on top of <code>{ontoLabel}</code>
      </div>
      <label className={styles["check"]}>
        <input
          ref={checkRef}
          type="checkbox"
          checked={interactive}
          onChange={(e) => setInteractive(e.target.checked)}
        />
        <span>Interactive (reorder, squash, drop)</span>
      </label>
      {loading && <div className={styles["hint"]}>Loading commits…</div>}
      {empty && <div className={styles["hint"]}>Nothing to rebase</div>}
      {interactive && rows !== null && rows.length > 0 && (
        <ol ref={listRef} className={styles["todo"]} aria-label="Rebase todo">
          {rows.map((r, i) => (
            <li
              key={r.oid}
              className={styles["todoRow"]}
              tabIndex={0}
              aria-label={`${r.action} ${r.subject}`}
              onKeyDown={(e) => onRowKey(e, i)}
            >
              <select
                className={styles["select"]}
                aria-label={`Action for ${r.subject}`}
                value={r.action}
                onChange={(e) => setAction(i, e.target.value as TodoAction)}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <code>{shortOid(r.oid)}</code>
              <span
                className={r.action === "drop" ? styles["todoDropped"] : styles["todoSubject"]}
                title={r.subject}
              >
                {r.subject}
              </span>
              <button
                type="button"
                className={styles["iconButton"]}
                aria-label={`Move ${r.subject} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                className={styles["iconButton"]}
                aria-label={`Move ${r.subject} down`}
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                ▼
              </button>
            </li>
          ))}
        </ol>
      )}
      {problem !== null && (
        <div className={styles["error"]} role="alert">
          {problem}
        </div>
      )}
    </FormDialog>
  );
}
