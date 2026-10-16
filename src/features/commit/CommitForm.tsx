import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { CommitTemplate } from "../../ipc/commit";
import type { RepoId } from "../../ipc/types";
import { forRepo, useCommitFormStore } from "../../state/commitForm";
import styles from "./Commit.module.css";

const TEMPLATE_LABEL: Record<CommitTemplate["source"], string> = {
  mergeMsg: "merge message",
  squashMsg: "squash message",
  configTemplate: "commit.template",
};

const MAX_ROWS_PX = 10 * 18;

export interface CommitFormProps {
  repoId: RepoId;
  stagedCount: number;
  /** Working tree has any change; a clean to dirty transition reloads the template. */
  dirty: boolean;
}

export function CommitForm({ repoId, stagedCount, dirty }: CommitFormProps) {
  const message = useCommitFormStore((s) => forRepo(s, repoId).message);
  const amend = useCommitFormStore((s) => forRepo(s, repoId).amend);
  const signoff = useCommitFormStore((s) => s.signoff);
  const templateSource = useCommitFormStore((s) => forRepo(s, repoId).templateSource);
  const committing = useCommitFormStore((s) => forRepo(s, repoId).committing);
  const setMessageFor = useCommitFormStore((s) => s.setMessage);
  const setAmend = useCommitFormStore((s) => s.setAmend);
  const setSignoff = useCommitFormStore((s) => s.setSignoff);
  const loadTemplate = useCommitFormStore((s) => s.loadTemplate);
  const commit = useCommitFormStore((s) => s.commit);
  const setMessage = (m: string): void => setMessageFor(repoId, m);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadTemplate(repoId);
  }, [repoId, dirty, loadTemplate]);

  useLayoutEffect(() => {
    const el = area.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [message]);

  const canCommit = message.trim() !== "" && (stagedCount > 0 || amend) && !committing;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canCommit) void commit(repoId);
    }
  };

  return (
    <form
      className={styles["commitForm"]}
      aria-label="Commit"
      onSubmit={(e) => {
        e.preventDefault();
        if (canCommit) void commit(repoId);
      }}
    >
      <textarea
        ref={area}
        className={styles["messageInput"]}
        rows={3}
        placeholder="Commit message"
        aria-label="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {templateSource !== null && (
        <p className={styles["templateNote"]}>Template: {TEMPLATE_LABEL[templateSource]}</p>
      )}
      <div className={styles["checks"]}>
        <label>
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => void setAmend(repoId, e.target.checked)}
          />{" "}
          Amend last commit
        </label>
        <label>
          <input type="checkbox" checked={signoff} onChange={(e) => setSignoff(e.target.checked)} />{" "}
          Sign-off
        </label>
      </div>
      <div className={styles["commitButtons"]}>
        <button type="submit" className={styles["primary"]} disabled={!canCommit}>
          Commit
        </button>
        <button type="button" className={styles["secondary"]} disabled title="Available in Phase 3">
          Commit and push
        </button>
      </div>
    </form>
  );
}
