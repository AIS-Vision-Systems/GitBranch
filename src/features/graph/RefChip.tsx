import { memo } from "react";
import type { Ref } from "../../ipc/types";
import styles from "./Graph.module.css";

interface Props {
  gitRef: Ref;
}

export const RefChip = memo(function RefChip({ gitRef }: Props) {
  const { kind, name, upstream, isHead } = gitRef;
  if (kind === "localBranch") {
    const gone = upstream?.gone === true;
    const cls = [
      styles["chip"],
      styles["local"],
      isHead ? styles["head"] : "",
      gone ? styles["gone"] : "",
    ];
    return (
      <span
        className={cls.join(" ")}
        title={gone ? `${name} (upstream ${upstream?.name ?? ""} is gone)` : name}
      >
        {name}
        {upstream !== null && !upstream.gone && (upstream.ahead > 0 || upstream.behind > 0) && (
          <span className={styles["sync"]}>
            {upstream.ahead > 0 && ` ↑${upstream.ahead}`}
            {upstream.behind > 0 && ` ↓${upstream.behind}`}
          </span>
        )}
      </span>
    );
  }
  if (typeof kind === "object" && "remoteBranch" in kind) {
    const remote = kind.remoteBranch.remote;
    const label = name.startsWith(`${remote}/`) ? name : `${remote}/${name}`;
    return (
      <span className={`${styles["chip"]} ${styles["remote"]}`} title={label}>
        {label}
      </span>
    );
  }
  return (
    <span className={`${styles["chip"]} ${styles["tag"]}`} title={`tag ${name}`}>
      {name}
    </span>
  );
});
