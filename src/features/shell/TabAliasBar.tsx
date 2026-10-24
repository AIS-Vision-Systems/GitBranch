import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "./TabAliasBar.module.css";

interface Props {
  /** Current alias, "" when none. */
  current: string;
  onSave: (alias: string) => void;
  onClear: () => void;
  onCancel: () => void;
}

/** Inline editor that replaces the tab row while a repository alias is edited. */
export function TabAliasBar({ current, onSave, onClear, onCancel }: Props) {
  const [value, setValue] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = value.trim();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (trimmed !== "") onSave(trimmed);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={styles["bar"]} role="group" aria-label="Repository alias">
      <label htmlFor="repo-alias-input" className={styles["label"]}>
        Repository alias
      </label>
      <input
        id="repo-alias-input"
        ref={input}
        className={styles["input"]}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={`${styles["btn"]} ${styles["primary"]}`}
        disabled={trimmed === ""}
        onClick={() => onSave(trimmed)}
      >
        Save alias
      </button>
      <button type="button" className={styles["btn"]} disabled={current === ""} onClick={onClear}>
        Clear alias
      </button>
      <button type="button" className={styles["btn"]} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
