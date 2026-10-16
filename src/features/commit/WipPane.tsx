import { useMemo, useState, type ReactNode } from "react";
import type { RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { submoduleStateLabel, submodulesOf, useSubmodulesStore } from "../../state/submodules";
import { useWipStore } from "../../state/wip";
import { CommitForm } from "./CommitForm";
import { FileList, type FileListItem } from "./FileList";
import styles from "./Commit.module.css";

export interface WipPaneProps {
  repoId: RepoId;
  /** Output of `wipItems(status.entries)`. */
  items: FileListItem[];
  selectedKey: string | null;
  onSelect: (item: FileListItem) => void;
}

function Section({
  title,
  count,
  headerAction,
  children,
}: {
  title: string;
  count: number;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles["section"]} aria-label={title}>
      <header className={styles["sectionHeader"]}>
        <h3 className={styles["sectionTitle"]}>
          {title} <span className={styles["count"]}>({count})</span>
        </h3>
        {headerAction}
      </header>
      {children}
    </section>
  );
}

function SubmodulesSection({ repoId }: { repoId: RepoId }) {
  const subs = useSubmodulesStore((s) => submodulesOf(s, repoId));
  const [open, setOpen] = useState(true);
  if (subs.length === 0) return null;
  return (
    <Section
      title="Submodules"
      count={subs.length}
      headerAction={
        <button
          type="button"
          className={styles["headerAction"]}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Collapse" : "Expand"}
        </button>
      }
    >
      {open && (
        <div role="list" aria-label="Submodules">
          {subs.map((m) => (
            <div
              key={m.path}
              role="listitem"
              className={styles["submoduleRow"]}
              title={m.url ?? m.path}
            >
              <span className={styles["submodulePath"]}>{m.path}</span>
              <span className={`${styles["stateBadge"]} ${styles[`state_${m.state}`]}`}>
                {submoduleStateLabel(m.state)}
              </span>
              {m.headOid !== null && (
                <code className={styles["submoduleOid"]}>{m.headOid.slice(0, 7)}</code>
              )}
              {m.describe !== null && !(m.headOid ?? "").startsWith(m.describe) && (
                <span className={styles["suffix"]}>{m.describe}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

const OURS_REBASE_HINT =
  "during a rebase git calls the branch you are rebasing onto (plus commits already replayed) ours";
const THEIRS_REBASE_HINT = "during a rebase git calls the commit being replayed theirs";

export function WipPane({ repoId, items, selectedKey, onSelect }: WipPaneProps) {
  const busy = useWipStore((s) => s.busy);
  const stage = useWipStore((s) => s.stage);
  const unstage = useWipStore((s) => s.unstage);
  const discard = useWipStore((s) => s.discard);
  const stageAll = useWipStore((s) => s.stageAll);
  const unstageAll = useWipStore((s) => s.unstageAll);
  const opsBusy = useOpsStore((s) => s.busy);
  const takeSide = useOpsStore((s) => s.takeSide);
  const markResolved = useOpsStore((s) => s.markResolved);
  const openInEditor = useOpsStore((s) => s.openInEditor);

  const groups = useMemo(() => {
    const g = {
      staged: [] as FileListItem[],
      unstaged: [] as FileListItem[],
      untracked: [] as FileListItem[],
      conflicts: [] as FileListItem[],
    };
    for (const i of items) {
      if (i.conflicted === true) g.conflicts.push(i);
      else g[i.target.kind === "commit" ? "unstaged" : i.target.kind].push(i);
    }
    return g;
  }, [items]);

  const rebasing = useGraphStore((st) => st.byRepo[repoId]?.inProgress?.kind === "rebase");
  const actionButton = (
    label: string,
    item: FileListItem,
    onClick: () => void,
    danger = false,
    hint?: string,
  ) => (
    <button
      type="button"
      className={danger ? `${styles["action"]} ${styles["actionDanger"]}` : styles["action"]}
      aria-label={`${label} ${item.path}`}
      title={hint !== undefined ? `${label} ${item.path}: ${hint}` : `${label} ${item.path}`}
      disabled={busy || opsBusy}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const stagedActions = (item: FileListItem): ReactNode =>
    actionButton("Unstage", item, () => void unstage(repoId, [item.path]));
  const unstagedActions = (item: FileListItem): ReactNode => (
    <>
      {actionButton("Stage", item, () => void stage(repoId, [item.path]))}
      {actionButton("Discard", item, () => void discard(repoId, [item]), true)}
    </>
  );

  const conflictActions = (item: FileListItem): ReactNode => (
    <>
      {actionButton(
        rebasing ? "Ours (onto)" : "Ours",
        item,
        () => void takeSide(repoId, [item.path], "ours"),
        false,
        rebasing ? OURS_REBASE_HINT : undefined,
      )}
      {actionButton(
        rebasing ? "Theirs (commit)" : "Theirs",
        item,
        () => void takeSide(repoId, [item.path], "theirs"),
        false,
        rebasing ? THEIRS_REBASE_HINT : undefined,
      )}
      {actionButton("Open", item, () => void openInEditor(repoId, item.path))}
      {actionButton("Mark resolved", item, () => void markResolved(repoId, [item.path]))}
    </>
  );

  const headerButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      className={styles["headerAction"]}
      disabled={busy || opsBusy}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const stagedCount = groups.staged.length;
  const conflictPaths = groups.conflicts.map((i) => i.path);

  return (
    <>
      {items.length === 0 && <p className={styles["placeholder"]}>Working tree clean</p>}
      {groups.conflicts.length > 0 && (
        <Section
          title="Conflicts"
          count={groups.conflicts.length}
          headerAction={
            <span className={styles["headerActions"]}>
              {headerButton(
                "Take ours for all",
                () => void takeSide(repoId, conflictPaths, "ours"),
              )}
              {headerButton(
                "Take theirs for all",
                () => void takeSide(repoId, conflictPaths, "theirs"),
              )}
            </span>
          }
        >
          <FileList
            files={groups.conflicts}
            selectedKey={selectedKey}
            onSelect={onSelect}
            actions={conflictActions}
            ariaLabel="Conflicted files"
          />
        </Section>
      )}
      {stagedCount > 0 && (
        <Section
          title="Staged"
          count={stagedCount}
          headerAction={headerButton("Unstage all", () => void unstageAll(repoId))}
        >
          <FileList
            files={groups.staged}
            selectedKey={selectedKey}
            onSelect={onSelect}
            actions={stagedActions}
            ariaLabel="Staged files"
          />
        </Section>
      )}
      {groups.unstaged.length > 0 && (
        <Section
          title="Unstaged"
          count={groups.unstaged.length}
          headerAction={headerButton("Stage all", () => void stageAll(repoId))}
        >
          <FileList
            files={groups.unstaged}
            selectedKey={selectedKey}
            onSelect={onSelect}
            actions={unstagedActions}
            ariaLabel="Unstaged files"
          />
        </Section>
      )}
      {groups.untracked.length > 0 && (
        <Section title="Untracked" count={groups.untracked.length}>
          <FileList
            files={groups.untracked}
            selectedKey={selectedKey}
            onSelect={onSelect}
            actions={unstagedActions}
            ariaLabel="Untracked files"
          />
        </Section>
      )}
      <SubmodulesSection repoId={repoId} />
      <CommitForm repoId={repoId} stagedCount={stagedCount} dirty={items.length > 0} />
    </>
  );
}
