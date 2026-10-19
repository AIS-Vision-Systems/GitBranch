import { useState } from "react";
import type { KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CheckRun, PullDetail, PullSummary } from "../../ipc/github";
import type { RepoId } from "../../ipc/types";
import { pullsOf, usePullsStore } from "../../state/pulls";
import commit from "../commit/Commit.module.css";
import styles from "./github.module.css";

const COLLAPSED_RUNS = 8;

type Tone = "success" | "failure" | "pending" | "none";

function dotClass(tone: Tone): string {
  const t = { success: "dotSuccess", failure: "dotFailure", pending: "dotPending", none: "" }[tone];
  return [styles["dot"], t === "" ? "" : styles[t]].filter((c) => c !== "").join(" ");
}

function runTone(r: CheckRun): Tone {
  if (r.status !== "completed") return "pending";
  switch (r.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
    case "startup_failure":
      return "failure";
    case null:
    default:
      return "none"; // skipped, neutral, stale
  }
}

function stateBadge(p: PullSummary): { label: string; cls: string } {
  if (p.merged) return { label: "merged", cls: styles["prBadgeMerged"] ?? "" };
  if (p.state === "closed") return { label: "closed", cls: styles["prBadgeClosed"] ?? "" };
  if (p.draft) return { label: "draft", cls: "" };
  return { label: "open", cls: styles["prBadgeOpen"] ?? "" };
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;

function Checks({ d }: { d: PullDetail }) {
  const [all, setAll] = useState(false);
  const c = d.checks;
  const runs = all ? c.runs : c.runs.slice(0, COLLAPSED_RUNS);
  return (
    <section aria-label="Checks">
      <h4 className={styles["prSectionTitle"]}>
        <span className={dotClass(c.overall)} data-testid="checks-overall" />
        Checks
        <span className={styles["prRunStatus"]}>
          {c.total === 0 ? "none" : `${c.success} of ${c.total} passed`}
        </span>
      </h4>
      {runs.map((r, i) => (
        <div key={`${r.name}-${i}`} className={styles["prRun"]}>
          <span className={dotClass(runTone(r))} />
          {r.htmlUrl !== null ? (
            <button
              type="button"
              className={`${styles["prLink"]} ${styles["prRunName"]}`}
              onClick={() => void openUrl(r.htmlUrl ?? "")}
            >
              {r.name}
            </button>
          ) : (
            <span className={styles["prRunName"]}>{r.name}</span>
          )}
          <span className={styles["prRunStatus"]}>
            {r.status === "completed" ? (r.conclusion ?? "completed") : r.status}
          </span>
        </div>
      ))}
      {c.runs.length > COLLAPSED_RUNS && (
        <button type="button" className={styles["prLink"]} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all (${c.runs.length})`}
        </button>
      )}
    </section>
  );
}

function Reviews({ d }: { d: PullDetail }) {
  const r = d.reviews;
  return (
    <section aria-label="Reviews">
      <h4 className={styles["prSectionTitle"]}>
        Reviews
        <span className={styles["prRunStatus"]}>
          {r.approved} approved, {r.changesRequested} changes requested, {r.commented} commented
        </span>
      </h4>
      <div className={styles["prChips"]}>
        {r.reviewers.map((v) => (
          <span key={v.login} className={styles["prBadge"]}>
            {v.login}: {v.state.replace("_", " ")}
          </span>
        ))}
      </div>
    </section>
  );
}

export function PullDetailView({ repoId }: { repoId: RepoId }) {
  const selected = usePullsStore((s) => pullsOf(s, repoId).selected);
  const detail = usePullsStore((s) => pullsOf(s, repoId).detail);
  const loading = usePullsStore((s) => pullsOf(s, repoId).detailLoading);
  const error = usePullsStore((s) => pullsOf(s, repoId).detailError);
  const select = usePullsStore((s) => s.select);
  const checkout = usePullsStore((s) => s.checkout);
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState<{ number: number; branch: string } | null>(null);
  const done = doneFor !== null && doneFor.number === selected ? doneFor.branch : null;

  const close = (): void => void select(repoId, null);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  const onCheckout = async (): Promise<void> => {
    if (detail === null) return;
    setBusy(true);
    try {
      const branch = await checkout(repoId, detail);
      setDoneFor(branch === null ? null : { number: detail.number, branch });
    } finally {
      setBusy(false);
    }
  };

  const header = (d: PullSummary | null) => (
    <div className={styles["prHead"]}>
      <h3 className={styles["prTitle"]}>
        {d !== null ? (
          <>
            {d.title} <span className={styles["prNumber"]}>#{d.number}</span>
          </>
        ) : (
          <span className={styles["prNumber"]}>#{selected}</span>
        )}
      </h3>
      {d !== null && (
        <span className={`${styles["prBadge"]} ${stateBadge(d).cls}`}>{stateBadge(d).label}</span>
      )}
      <button type="button" className={styles["prClose"]} aria-label="Close" onClick={close}>
        ×
      </button>
    </div>
  );

  if (detail?.number !== selected) {
    return (
      <div className={styles["pr"]} onKeyDown={onKeyDown}>
        {header(null)}
        {error !== null ? (
          <p className={styles["prError"]} role="alert">
            {error}
          </p>
        ) : (
          <p className={commit["placeholder"]}>{loading ? "Loading…" : "No details"}</p>
        )}
      </div>
    );
  }

  const d = detail;
  const fork = d.headRepo !== null && d.headRepo !== d.baseRepo;
  return (
    <div className={styles["pr"]} onKeyDown={onKeyDown} tabIndex={-1} aria-label="Pull request">
      {header(d)}
      <div className={styles["prMeta"]}>
        {d.author} wants to merge {plural(d.commits, "commit")} into{" "}
        <span className={styles["prRef"]}>{d.baseRef}</span> from{" "}
        <span className={styles["prRef"]}>{fork ? `${d.headRepo}:${d.headRef}` : d.headRef}</span>
      </div>
      {d.labels.length > 0 && (
        <div className={styles["prChips"]}>
          {d.labels.map((l) => (
            <span key={l} className={styles["prBadge"]}>
              {l}
            </span>
          ))}
        </div>
      )}
      <div className={styles["prCounts"]}>
        <span className={styles["prAdd"]}>+{d.additions}</span>
        <span className={styles["prDel"]}>−{d.deletions}</span>
        <span>{plural(d.changedFiles, "file")}</span>
        <span>{plural(d.comments + d.reviewComments, "comment")}</span>
      </div>
      <div className={styles["prActions"]}>
        <button type="button" disabled={busy} onClick={() => void onCheckout()}>
          {busy ? "Checking out…" : "Checkout"}
        </button>
        <button type="button" onClick={() => void openUrl(d.htmlUrl)}>
          Open in browser
        </button>
        {done !== null && <span className={styles["prMeta"]}>Checked out {done}</span>}
      </div>
      {d.body !== null && d.body.trim() !== "" ? (
        <pre className={styles["prBody"]}>{d.body}</pre>
      ) : (
        <p className={styles["prMeta"]}>No description</p>
      )}
      <Checks d={d} />
      <Reviews d={d} />
    </div>
  );
}
