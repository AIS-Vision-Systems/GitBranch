import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { appInfo } from "../../ipc/app";
import { X } from "../../lib/icons";
import guide from "../../help/guide.en.md?raw";
import aisBlue from "../../assets/AisBlue.png";
import aisWhite from "../../assets/AisWhite.png";
import logo from "../../assets/logo.svg";
import { Dialog } from "../shell/Dialog";
import { Markdown } from "../shell/Markdown";
import { UpdateCheck } from "../shell/UpdateCheck";
import styles from "./AboutDialog.module.css";

export const LICENSE_URL = "https://github.com/AIS-Vision-Systems/GitBranch/blob/main/LICENSE.md";

export interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    appInfo().then(
      (i) => {
        if (!cancelled) setVersion(i.version);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog
      title="About GitBranch"
      onClose={onClose}
      width="lg"
      panelClassName={styles["panel"]}
      bodyClassName={styles["body"]}
    >
      <button
        type="button"
        className={styles["close"]}
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div className={styles["credits"]}>
        <img className={styles["logo"]} src={logo} alt="" />
        <div>
          <div className={styles["name"]}>GitBranch</div>
          <div className={styles["muted"]}>
            {version !== null ? `Version ${version}` : "Version"}
          </div>
          <div className={styles["muted"]}>Original development: Xavi Anguera</div>
          <button
            type="button"
            className={styles["link"]}
            onClick={() => void openUrl(LICENSE_URL)}
          >
            License: free for noncommercial use · commercial license available
          </button>
        </div>
      </div>
      <div className={styles["section"]}>
        <UpdateCheck />
      </div>
      <div className={styles["branding"]}>
        <img className={`${styles["ais"]} ${styles["aisLight"]}`} src={aisBlue} alt="" />
        <img className={`${styles["ais"]} ${styles["aisDark"]}`} src={aisWhite} alt="" />
        <span className={styles["muted"]}>An app by AIS Vision Systems</span>
      </div>
      <div className={styles["guide"]}>
        <Markdown source={guide} />
      </div>
    </Dialog>
  );
}
