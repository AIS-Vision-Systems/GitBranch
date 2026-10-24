import { useMemo, useState, type KeyboardEvent } from "react";
import type { OpenedRepo } from "../../ipc/types";
import { FolderGit2, GitFork, X } from "../../lib/icons";
import { tabName } from "../../lib/tabOrder";
import { Popover } from "./Popover";
import styles from "./TabSearchMenu.module.css";

interface Props {
  x: number;
  y: number;
  tabs: readonly OpenedRepo[];
  aliases: Readonly<Record<string, string>>;
  currentId: string | null;
  onSelect: (repoId: string) => void;
  onCloseTab: (repoId: string) => void;
  onClose: () => void;
}

const LIST_ID = "tab-search-list";
const optionId = (repoId: string): string => `tab-search-opt-${repoId}`;

/** Dropdown listing every open tab with a name filter (the chevron next to "+"). */
export function TabSearchMenu({
  x,
  y,
  tabs,
  aliases,
  currentId,
  onSelect,
  onCloseTab,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tabs.filter((r) => tabName(r, aliases).toLowerCase().includes(q));
  }, [tabs, aliases, query]);
  const index = Math.min(active, Math.max(shown.length - 1, 0));

  const choose = (repoId: string): void => {
    onSelect(repoId);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      setActive((index + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === "Tab") {
      // Focus must not leave the popover for the page behind it.
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = shown[index];
      if (r !== undefined) choose(r.repoId);
    }
  };

  return (
    <Popover x={x} y={y} align="right" label="Search tabs" onClose={onClose}>
      <div className={styles["menu"]}>
        <input
          type="text"
          className={styles["search"]}
          placeholder="Search Tabs"
          aria-label="Search Tabs"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          {...(shown[index] !== undefined
            ? { "aria-activedescendant": optionId(shown[index].repoId) }
            : {})}
        />
        <div className={styles["heading"]}>Open tabs</div>
        <ul id={LIST_ID} className={styles["list"]} role="listbox" aria-label="Open tabs">
          {shown.map((r, i) => {
            const name = tabName(r, aliases);
            return (
              <li
                key={r.repoId}
                id={optionId(r.repoId)}
                role="option"
                aria-selected={i === index}
                data-current={r.repoId === currentId ? "true" : undefined}
                className={i === index ? `${styles["row"]} ${styles["rowActive"]}` : styles["row"]}
                title={r.path}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r.repoId)}
              >
                {r.isWorktree ? (
                  <GitFork size={16} className={styles["icon"]} aria-hidden="true" />
                ) : (
                  <FolderGit2 size={16} className={styles["icon"]} aria-hidden="true" />
                )}
                <span className={styles["name"]}>{name}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles["close"]}
                  aria-label={`Close ${name} from list`}
                  title={`Close ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(r.repoId);
                    if (tabs.length <= 1) onClose();
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Popover>
  );
}
