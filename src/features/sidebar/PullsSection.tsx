import { useEffect } from "react";
import type { KeyboardEvent } from "react";
import type { ChecksSummary, PullSummary } from "../../ipc/github";
import type { RepoId } from "../../ipc/types";
import { useGithubStore } from "../../state/github";
import { pullsOf, usePullsStore } from "../../state/pulls";
import type { PullFilter } from "../../state/pulls";
import { GithubNotice } from "../github/GithubNotice";
import { openCreatePull, openGithubLogin } from "../dialogs/open";
import styles from "./Sidebar.module.css";

const FILTERS: { id: PullFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "mine", label: "Mine" },
];

const EMPTY_TEXT: Record<PullFilter, string> = {
  open: "No open pull requests",
  closed: "No closed pull requests",
  mine: "You have no pull requests here",
};

const CHECK_CLASS: Partial<Record<ChecksSummary["overall"], string>> = {
  success: "checkSuccess",
  failure: "checkFailure",
  pending: "checkPending",
};

function PullRow({
  pull,
  selected,
  checks,
  onSelect,
}: {
  pull: PullSummary;
  selected: boolean;
  checks: ChecksSummary | undefined;
  onSelect: (n: number) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onSelect(pull.number);
    }
  };
  const cls = [styles["row"], selected ? styles["rowCurrent"] : ""]
    .filter((c) => c !== "")
    .join(" ");
  return (
    <div
      role="listitem"
      className={cls}
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(pull.number)}
      onKeyDown={onKeyDown}
    >
      <div className={styles["line1"]}>
        {checks !== undefined && CHECK_CLASS[checks.overall] !== undefined && (
          <span
            data-testid="check-dot"
            title={`checks: ${checks.overall}`}
            className={`${styles["checkDot"]} ${styles[CHECK_CLASS[checks.overall] ?? ""] ?? ""}`}
          />
        )}
        <span className={styles["pullNumber"]}>#{pull.number}</span>
        <span className={styles["pullTitle"]} title={pull.title}>
          {pull.title}
        </span>
      </div>
      <div className={styles["line1"]}>
        <span className={styles["path"]}>{pull.author}</span>
        {pull.draft && <span className={styles["badge"]}>draft</span>}
        {pull.state === "closed" && pull.merged && (
          <span className={`${styles["badge"]} ${styles["badgeMerged"]}`}>merged</span>
        )}
        {pull.state === "closed" && !pull.merged && <span className={styles["badge"]}>closed</span>}
      </div>
    </div>
  );
}

export function PullsSection({ repoId }: { repoId: RepoId }) {
  const account = useGithubStore((s) => s.account);
  const slug = usePullsStore((s) => pullsOf(s, repoId).slug);
  const filter = usePullsStore((s) => pullsOf(s, repoId).filter);
  const pulls = usePullsStore((s) => pullsOf(s, repoId).pulls);
  const loaded = usePullsStore((s) => pullsOf(s, repoId).loaded);
  const loading = usePullsStore((s) => pullsOf(s, repoId).loading);
  const error = usePullsStore((s) => pullsOf(s, repoId).error);
  const problem = usePullsStore((s) => pullsOf(s, repoId).problem);
  const selected = usePullsStore((s) => pullsOf(s, repoId).selected);
  const checksBySha = usePullsStore((s) => pullsOf(s, repoId).checksBySha);
  const loadSlug = usePullsStore((s) => s.loadSlug);
  const loadPulls = usePullsStore((s) => s.loadPulls);
  const setFilter = usePullsStore((s) => s.setFilter);
  const select = usePullsStore((s) => s.select);
  const refresh = usePullsStore((s) => s.refresh);

  const login = account?.user.login;
  const signedIn = account !== null && account !== undefined;

  useEffect(() => {
    if (slug === undefined) void loadSlug(repoId);
  }, [repoId, slug, loadSlug]);

  useEffect(() => {
    if (slug !== null && slug !== undefined && signedIn) void loadPulls(repoId);
  }, [repoId, slug, signedIn, login, filter, loadPulls]);

  if (slug === null || slug === undefined) return null;

  let body;
  if (!signedIn) {
    body = (
      <div className={styles["sectionNote"]}>
        <span>Sign in to GitHub to see pull requests</span>
        <button type="button" className={styles["headerAction"]} onClick={openGithubLogin}>
          Sign in
        </button>
      </div>
    );
  } else if (error !== null && problem !== null && problem.kind !== "other") {
    body = <GithubNotice compact problem={problem} onRetry={() => void loadPulls(repoId, true)} />;
  } else if (error !== null) {
    body = (
      <div className={styles["sectionNote"]} role="alert">
        <span>{error}</span>
        <button
          type="button"
          className={styles["headerAction"]}
          onClick={() => void loadPulls(repoId, true)}
        >
          Retry
        </button>
      </div>
    );
  } else if (loading && !loaded) {
    body = <div className={styles["sectionNote"]}>Loading…</div>;
  } else if (loaded && pulls.length === 0) {
    body = <div className={styles["sectionNote"]}>{EMPTY_TEXT[filter]}</div>;
  } else {
    body = (
      <div role="list" aria-label="Pull requests">
        {pulls.map((p) => (
          <PullRow
            key={p.number}
            pull={p}
            selected={p.number === selected}
            checks={checksBySha[p.headSha]}
            onSelect={(n) => void select(repoId, n)}
          />
        ))}
      </div>
    );
  }

  return (
    <section className={styles["section"]} aria-label="Pull requests">
      <header className={styles["sectionHeader"]}>
        <h3 className={styles["sectionTitle"]}>Pull requests</h3>
        {signedIn && (
          <button
            type="button"
            className={styles["headerAction"]}
            aria-label="New pull request"
            title="New pull request"
            onClick={() => openCreatePull(repoId)}
          >
            +
          </button>
        )}
        <button
          type="button"
          className={styles["headerAction"]}
          aria-label="Refresh pull requests"
          title="Refresh"
          disabled={!signedIn || loading}
          onClick={() => void refresh(repoId)}
        >
          ↻
        </button>
      </header>
      {signedIn && (
        <div className={styles["segmented"]} role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles["segment"]}
              aria-pressed={filter === f.id}
              onClick={() => void setFilter(repoId, f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {body}
    </section>
  );
}
