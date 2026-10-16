import { useMemo, useRef, useState } from "react";
import type { RepoId } from "../../ipc/types";
import { useGraphStore } from "../../state/graph";
import { useOpsStore } from "../../state/ops";
import { remoteTrackingName } from "../graph/menus";
import { FormDialog } from "./FormDialog";
import styles from "./Form.module.css";

export interface SetUpstreamDialogProps {
  repoId: RepoId;
  branch: string;
  current: string | null;
  onClose: () => void;
}

const NONE = "";

export function SetUpstreamDialog({ repoId, branch, current, onClose }: SetUpstreamDialogProps) {
  const refs = useGraphStore((s) => s.byRepo[repoId]?.refs ?? null);
  const setUpstream = useOpsStore((s) => s.setUpstream);
  const selectRef = useRef<HTMLSelectElement>(null);
  const options = useMemo(() => {
    const names = (refs?.refs ?? [])
      .filter((r) => typeof r.kind === "object" && "remoteBranch" in r.kind)
      .map(remoteTrackingName);
    if (current !== null && !names.includes(current)) names.push(current);
    return names.sort();
  }, [refs, current]);
  const [value, setValue] = useState(current ?? NONE);

  return (
    <FormDialog
      title={`Set upstream for ${branch}`}
      submitLabel="Set upstream"
      valid={value !== (current ?? NONE)}
      initialFocusRef={selectRef}
      onClose={onClose}
      onSubmit={() => setUpstream(repoId, branch, value === NONE ? null : value)}
    >
      <label className={styles["field"]}>
        <span className={styles["label"]}>Upstream</span>
        <select
          ref={selectRef}
          className={styles["select"]}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value={NONE}>None</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    </FormDialog>
  );
}
