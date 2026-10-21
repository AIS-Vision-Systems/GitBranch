import { useNow } from "../../lib/useNow";
import { describeProblem } from "../../lib/githubErrors";
import type { GithubProblem } from "../../lib/githubErrors";
import { openGithubLogin } from "../dialogs/open";
import styles from "./github.module.css";

interface Props {
  problem: GithubProblem;
  onRetry: () => void;
  compact?: boolean;
}

export function GithubNotice({ problem, onRetry, compact = false }: Props) {
  const now = useNow(problem.kind === "rateLimited" ? 15000 : null);
  const signedOut = problem.kind === "signedOut";
  return (
    <div
      className={`${styles["notice"]} ${compact ? styles["noticeCompact"] : ""}`}
      role="alert"
      data-kind={problem.kind}
    >
      <span>{describeProblem(problem, now)}</span>
      {signedOut ? (
        <button type="button" className={styles["noticeButton"]} onClick={openGithubLogin}>
          Sign in
        </button>
      ) : (
        <button type="button" className={styles["noticeButton"]} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
