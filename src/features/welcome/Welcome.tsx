import { openClone, openGithubRepoPicker } from "../dialogs/open";
import { useReposStore } from "../../state/repos";
import styles from "./Welcome.module.css";

export function Welcome() {
  const recent = useReposStore((s) => s.recent);
  const openViaDialog = useReposStore((s) => s.openViaDialog);
  const openPath = useReposStore((s) => s.openPath);
  const forgetRecent = useReposStore((s) => s.forgetRecent);

  return (
    <section className={styles["welcome"]} aria-labelledby="welcome-title">
      <h1 id="welcome-title" className={styles["title"]}>
        GitBranch
      </h1>
      <button type="button" className={styles["primary"]} onClick={() => void openViaDialog()}>
        Open repository…
      </button>
      <button type="button" className={styles["secondary"]} onClick={() => openClone()}>
        Clone…
      </button>
      <button type="button" className={styles["secondary"]} onClick={() => openGithubRepoPicker()}>
        Clone from GitHub…
      </button>
      <h2 className={styles["heading"]}>Recent</h2>
      {recent.length === 0 ? (
        <p className={styles["empty"]}>No recent repositories</p>
      ) : (
        <ul className={styles["list"]}>
          {recent.map((r) => (
            <li key={r.path} className={styles["item"]}>
              <button
                type="button"
                className={styles["row"]}
                title={r.path}
                onClick={() => void openPath(r.path)}
              >
                <span className={styles["repoName"]}>{r.name}</span>
                <span className={styles["path"]}>{r.path}</span>
              </button>
              <button
                type="button"
                className={styles["forget"]}
                aria-label={`Remove ${r.name} from recent`}
                onClick={(e) => {
                  e.stopPropagation();
                  void forgetRecent(r.path);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
