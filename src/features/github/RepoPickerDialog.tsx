import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GithubRepo } from "../../ipc/github";
import { useGithubStore } from "../../state/github";
import { formatRelative } from "../../lib/time";
import { Dialog } from "../shell/Dialog";
import { GithubNotice } from "./GithubNotice";
import form from "../dialogs/Form.module.css";
import { openClone, openGithubLogin } from "../dialogs/open";
import styles from "./github.module.css";

export interface RepoPickerDialogProps {
  onClose: () => void;
}

function pushedLabel(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return `pushed ${formatRelative(Math.floor(ms / 1000), Math.floor(Date.now() / 1000))}`;
}

export function RepoPickerDialog({ onClose }: RepoPickerDialogProps) {
  const account = useGithubStore((s) => s.account);
  const repos = useGithubStore((s) => s.repos);
  const loading = useGithubStore((s) => s.reposLoading);
  const error = useGithubStore((s) => s.reposError);
  const problem = useGithubStore((s) => s.reposProblem);
  const loadRepos = useGithubStore((s) => s.loadRepos);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const signInRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const signedIn = account !== null && account !== undefined;

  useEffect(() => {
    if (signedIn) void loadRepos();
  }, [signedIn, loadRepos]);

  const owners = useMemo(() => {
    const own = account?.user.login;
    const set = new Set((repos ?? []).map((r) => r.owner));
    return [...set].sort((a, b) => {
      if (a === own) return -1;
      if (b === own) return 1;
      return a.localeCompare(b);
    });
  }, [repos, account]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? []).filter(
      (r) =>
        (archived || !r.archived) &&
        (owner === "" || r.owner === owner) &&
        (q === "" ||
          r.fullName.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)),
    );
  }, [repos, query, owner, archived]);

  const index = Math.min(selected, filtered.length - 1);
  const current: GithubRepo | undefined = filtered[index];

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const choose = (repo: GithubRepo | undefined): void => {
    if (!repo) return;
    onClose();
    openClone({ url: repo.cloneUrl, defaultBranch: repo.defaultBranch });
  };

  const signIn = (): void => {
    onClose();
    openGithubLogin();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const last = filtered.length - 1;
      setSelected(e.key === "ArrowDown" ? Math.min(index + 1, last) : Math.max(index - 1, 0));
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      if (e.target.type === "search" || e.target.type === "text") {
        e.preventDefault();
        choose(current);
      }
    }
  };

  const cancel = (
    <button type="button" className={form["cancel"]} onClick={onClose}>
      Cancel
    </button>
  );

  if (!signedIn) {
    return (
      <Dialog
        title="Clone from GitHub"
        onClose={onClose}
        width="sm"
        initialFocusRef={signInRef}
        footer={cancel}
      >
        <div className={styles["pickerMessage"]}>
          <div>Sign in to GitHub to browse your repositories.</div>
          <button ref={signInRef} type="button" className={form["submit"]} onClick={signIn}>
            Sign in to GitHub
          </button>
        </div>
      </Dialog>
    );
  }

  let list;
  if (error !== null) {
    list = (
      <div className={styles["pickerMessage"]}>
        {problem !== null && problem.kind !== "other" ? (
          <GithubNotice problem={problem} onRetry={() => void loadRepos(true)} />
        ) : (
          <>
            <div className={form["error"]} role="alert">
              {error}
            </div>
            <button type="button" className={form["cancel"]} onClick={() => void loadRepos(true)}>
              Retry
            </button>
          </>
        )}
      </div>
    );
  } else if (repos === null || loading) {
    list = <div className={styles["pickerMessage"]}>Loading repositories…</div>;
  } else if (filtered.length === 0) {
    list = <div className={styles["pickerMessage"]}>No matching repositories</div>;
  } else {
    list = (
      <ul ref={listRef} className={styles["repoList"]} role="listbox" aria-label="Repositories">
        {filtered.map((r, i) => {
          const pushed = pushedLabel(r.pushedAt);
          return (
            <li
              key={r.id}
              role="option"
              aria-selected={i === index}
              className={styles["repoRow"]}
              onClick={() => setSelected(i)}
              onDoubleClick={() => choose(r)}
            >
              <div className={styles["repoTitle"]}>
                <span>
                  <span className={styles["repoOwner"]}>{r.owner}/</span>
                  <strong>{r.name}</strong>
                </span>
                {r.private && <span className={styles["badge"]}>private</span>}
                {r.fork && <span className={styles["badge"]}>fork</span>}
                {r.archived && <span className={styles["badge"]}>archived</span>}
              </div>
              {r.description !== null && r.description !== "" && (
                <div className={styles["repoDesc"]}>{r.description}</div>
              )}
              <div className={styles["repoMeta"]}>
                {r.language !== null && <span>{r.language}</span>}
                {pushed !== null && <span>{pushed}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Dialog
      title="Clone from GitHub"
      onClose={onClose}
      width="lg"
      initialFocusRef={searchRef}
      footer={
        <>
          {cancel}
          <button
            type="button"
            className={form["submit"]}
            disabled={current === undefined}
            onClick={() => choose(current)}
          >
            Clone
          </button>
        </>
      }
    >
      <div className={styles["pickerBody"]} onKeyDown={onKeyDown}>
        <div className={styles["pickerHead"]}>
          <input
            ref={searchRef}
            type="search"
            className={`${form["input"] ?? ""} ${styles["pickerSearch"] ?? ""}`}
            aria-label="Search repositories"
            placeholder="Search repositories"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
          />
          <select
            className={form["input"]}
            aria-label="Owner"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setSelected(0);
            }}
          >
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <label className={form["check"]}>
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                setArchived(e.target.checked);
                setSelected(0);
              }}
            />
            <span>Show archived</span>
          </label>
          <button type="button" className={form["cancel"]} onClick={() => void loadRepos(true)}>
            Refresh
          </button>
        </div>
        {list}
      </div>
    </Dialog>
  );
}
