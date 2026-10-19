import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { githubCreatePull, githubRepoInfo } from "../../ipc/github";
import { commitsBetween } from "../../ipc/history";
import type { RepoId } from "../../ipc/types";
import { prefill } from "../../lib/pullPrefill";
import { upstreamRemote } from "../../lib/pushTarget";
import { useGithubStore } from "../../state/github";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { pullsOf, usePullsStore } from "../../state/pulls";
import { remotesOf, useRemotesStore } from "../../state/remotes";
import { useUiStore } from "../../state/ui";
import form from "../dialogs/Form.module.css";
import { FormDialog } from "../dialogs/FormDialog";
import { openGithubLogin } from "../dialogs/open";
import { Dialog } from "../shell/Dialog";
import styles from "./github.module.css";

export interface CreatePullDialogProps {
  repoId: RepoId;
  onClose: () => void;
}

const COMMIT_LIMIT = 50;

function Message({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Dialog
      title="Create pull request"
      onClose={onClose}
      width="sm"
      footer={
        <button type="button" className={form["cancel"]} onClick={onClose}>
          Close
        </button>
      }
    >
      {children}
    </Dialog>
  );
}

export function CreatePullDialog({ repoId, onClose }: CreatePullDialogProps) {
  const account = useGithubStore((s) => s.account);
  const slug = usePullsStore((s) => pullsOf(s, repoId).slug);
  const loadSlug = usePullsStore((s) => s.loadSlug);
  const head = useGraphStore((s) => s.byRepo[repoId]?.refs?.head ?? null);

  useEffect(() => {
    if (slug === undefined) void loadSlug(repoId);
  }, [repoId, slug, loadSlug]);

  if (slug === undefined) return <Message onClose={onClose}>Loading…</Message>;
  if (slug === null) {
    return (
      <Message onClose={onClose}>
        <div className={form["hint"]}>This repository does not have a GitHub remote.</div>
      </Message>
    );
  }
  if (account === undefined) return <Message onClose={onClose}>Loading…</Message>;
  if (account === null) {
    return (
      <Message onClose={onClose}>
        <div className={styles["pullBody"]}>
          <div className={form["hint"]}>Sign in to GitHub to create a pull request.</div>
          <div>
            <button
              type="button"
              className={form["submit"]}
              onClick={() => {
                onClose();
                openGithubLogin();
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      </Message>
    );
  }
  if (head === null || head.detached || head.branch === null) {
    return (
      <Message onClose={onClose}>
        <div className={form["hint"]}>Check out a branch first.</div>
      </Message>
    );
  }
  return (
    <PullForm repoId={repoId} remote={slug.remote} headBranch={head.branch} onClose={onClose} />
  );
}

function PullForm({
  repoId,
  remote,
  headBranch,
  onClose,
}: {
  repoId: RepoId;
  remote: string;
  headBranch: string;
  onClose: () => void;
}) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs ?? null);
  const remotes = useRemotesStore((s) => remotesOf(s, repoId));
  const [chosen, setChosen] = useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);
  const [result, setResult] = useState<{
    base: string;
    count: number | null;
    error: string | null;
  } | null>(null);
  const [phase, setPhase] = useState<"idle" | "pushing" | "creating">("idle");
  const [error, setError] = useState<string | null>(null);
  const titleDirty = useRef(false);
  const bodyDirty = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const bases = useMemo(() => {
    const prefix = `${remote}/`;
    const out: string[] = [];
    for (const r of refs?.refs ?? []) {
      if (typeof r.kind !== "object" || !("remoteBranch" in r.kind)) continue;
      if (r.kind.remoteBranch.remote !== remote) continue;
      const name = r.name.startsWith(prefix) ? r.name.slice(prefix.length) : r.name;
      if (name !== "HEAD" && !out.includes(name)) out.push(name);
    }
    return out;
  }, [refs, remote]);

  const base = useMemo(() => {
    if (chosen !== null) return chosen;
    if (defaultBranch === undefined || defaultBranch === headBranch) return "";
    const ok = (b: string): boolean => b !== headBranch;
    if (defaultBranch !== null && bases.includes(defaultBranch) && ok(defaultBranch)) {
      return defaultBranch;
    }
    return (bases.includes("main") && ok("main") ? "main" : bases.find(ok)) ?? "";
  }, [chosen, defaultBranch, bases, headBranch]);
  const current = result !== null && result.base === base ? result : null;
  const count = current?.count ?? null;
  const countError = current?.error ?? null;

  const localRef = refs?.refs.find((r) => r.kind === "localBranch" && r.name === headBranch);
  const upstream = localRef?.upstream ?? null;
  // Where the PR head lives on `remote`: the tracked branch name, or the local name once pushed.
  const trackedRemote = upstream === null ? null : upstreamRemote(upstream.name, remotes);
  const foreign = upstream !== null && trackedRemote !== remote;
  const headName =
    upstream !== null && !foreign ? upstream.name.slice(remote.length + 1) : headBranch;
  const needsPush = !foreign && (upstream === null || upstream.gone || upstream.ahead > 0);
  const diverged = upstream !== null && !upstream.gone && upstream.ahead > 0 && upstream.behind > 0;

  useEffect(() => {
    let live = true;
    githubRepoInfo(repoId).then(
      (info) => live && setDefaultBranch(info.defaultBranch),
      () => live && setDefaultBranch(null),
    );
    return () => {
      live = false;
    };
  }, [repoId]);

  useEffect(() => {
    if (base === "") return;
    let live = true;
    commitsBetween(repoId, `${remote}/${base}`, headBranch, COMMIT_LIMIT).then(
      (commits) => {
        if (!live) return;
        setResult({ base, count: commits.length, error: null });
        const p = prefill(headBranch, commits);
        if (!titleDirty.current) setTitle(p.title);
        if (!bodyDirty.current) setBody(p.body);
      },
      (e: unknown) =>
        live && setResult({ base, count: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [repoId, remote, base, headBranch]);

  const pushNote = ((): string => {
    if (foreign) return "";
    const target = `${remote}/${headName}`;
    if (upstream?.gone === true) return `remote branch is gone, will be pushed to ${target}`;
    if (needsPush) return `will be pushed to ${target}`;
    return "up to date";
  })();

  const submit = async (): Promise<boolean> => {
    setError(null);
    try {
      if (needsPush) {
        setPhase("pushing");
        const ok = await useOpsStore.getState().push(repoId, {
          remote,
          branch: headBranch,
          remoteBranch: upstream === null ? null : headName,
          setUpstream: upstream === null || upstream.gone,
          tags: false,
          forceWithLease: false,
        });
        if (!ok) {
          setError("Push rejected: pull or rebase first");
          return false;
        }
      }
      setPhase("creating");
      const pr = await githubCreatePull(repoId, {
        title: title.trim(),
        body: body.trim() === "" ? null : body,
        head: headName,
        base,
        draft,
      });
      useUiStore
        .getState()
        .pushToast({ kind: "success", title: `Pull request #${pr.number} created` });
      try {
        const pulls = usePullsStore.getState();
        await pulls.loadPulls(repoId, true);
        await pulls.select(repoId, pr.number);
      } catch {
        // The PR exists; a failed refresh must not keep the dialog open.
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setPhase("idle");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // FormDialog handles Enter elsewhere; in the textarea only Ctrl/Cmd+Enter submits.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target instanceof HTMLTextAreaElement) {
      e.preventDefault();
      e.currentTarget.closest("form")?.requestSubmit();
    }
  };

  const submitLabel =
    phase === "pushing" ? "Pushing…" : phase === "creating" ? "Creating…" : "Create pull request";

  return (
    <FormDialog
      title="Create pull request"
      submitLabel={submitLabel}
      valid={
        phase === "idle" &&
        !foreign &&
        base !== "" &&
        title.trim() !== "" &&
        count !== null &&
        count > 0
      }
      initialFocusRef={titleRef}
      onClose={onClose}
      onSubmit={submit}
    >
      <div className={styles["pullBody"]} onKeyDown={onKeyDown}>
        <div className={styles["headLine"]}>
          <span>
            From <code>{headBranch}</code>
          </span>
          <span className={styles["pushNote"]}>{pushNote}</span>
        </div>
        <label className={form["field"]}>
          <span className={form["label"]}>Base branch</span>
          <select
            className={form["select"]}
            value={base}
            onChange={(e) => setChosen(e.target.value)}
          >
            {base === "" && <option value="">Pick a base branch</option>}
            {bases.map((b) => (
              <option key={b} value={b} disabled={b === headBranch}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {count !== null && count > 0 && (
          <div className={form["hint"]}>
            {count === 1 ? "1 commit" : `${count}${count >= COMMIT_LIMIT ? "+" : ""} commits`}
          </div>
        )}
        {countError !== null && (
          <div className={form["error"]} role="alert">
            {countError}
          </div>
        )}
        {foreign && upstream !== null && (
          <div className={styles["warn"]} role="alert">
            This branch tracks {upstream.name}, not {remote}; creating the PR from there is not
            supported yet
          </div>
        )}
        {diverged && (
          <div className={styles["warn"]}>
            Local and remote have diverged; the push will be rejected. Pull or rebase first.
          </div>
        )}
        {count === 0 && (
          <div className={styles["warn"]} role="alert">
            No commits between base and head
          </div>
        )}
        <label className={form["field"]}>
          <span className={form["label"]}>Title</span>
          <input
            ref={titleRef}
            className={form["input"]}
            value={title}
            onChange={(e) => {
              titleDirty.current = true;
              setTitle(e.target.value);
            }}
          />
        </label>
        <label className={form["field"]}>
          <span className={form["label"]}>Description</span>
          <textarea
            className={`${form["textarea"]} ${styles["pullBodyText"]}`}
            value={body}
            onChange={(e) => {
              bodyDirty.current = true;
              setBody(e.target.value);
            }}
          />
        </label>
        <label className={form["check"]}>
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          <span>Create as draft</span>
        </label>
        {error !== null && (
          <div className={form["error"]} role="alert">
            {error}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
