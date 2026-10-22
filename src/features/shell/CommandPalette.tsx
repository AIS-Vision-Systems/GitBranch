import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { buildCommands } from "../../lib/commands";
import { filterCommands, usePaletteStore, type Command } from "../../state/palette";
import { reportError } from "../../state/ui";
import styles from "./CommandPalette.module.css";

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const hide = usePaletteStore((s) => s.hide);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const all = useMemo(() => buildCommands(), []);
  const shown = useMemo(() => filterCommands(query, all), [query, all]);
  const listRef = useRef<HTMLUListElement>(null);
  const sel = Math.min(index, Math.max(0, shown.length - 1));

  const run = (c: Command | undefined): void => {
    if (c === undefined) return;
    hide();
    // Let the palette unmount before the command opens a dialog or moves focus.
    setTimeout(() => {
      void Promise.resolve()
        .then(() => c.run())
        .catch((e: unknown) => reportError(e, c.title));
    }, 0);
  };

  const move = (to: number): void => {
    const n = shown.length;
    if (n === 0) return;
    const next = (to + n) % n;
    setIndex(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") move(sel + 1);
    else if (e.key === "ArrowUp") move(sel - 1);
    else if (e.key === "Enter") run(shown[sel]);
    else if (e.key === "Escape") hide();
    else return;
    e.preventDefault();
  };

  const active = shown[sel];
  return (
    <div
      className={styles["backdrop"]}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div className={styles["panel"]} role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          className={styles["input"]}
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={active !== undefined ? `palette-${active.id}` : undefined}
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        {shown.length === 0 ? (
          <div className={styles["empty"]}>No matching commands</div>
        ) : (
          <ul ref={listRef} id="palette-list" className={styles["list"]} role="listbox">
            {shown.map((c, i) => (
              <li
                key={c.id}
                id={`palette-${c.id}`}
                role="option"
                aria-selected={i === sel}
                className={styles["item"]}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(c)}
              >
                <span>{c.title}</span>
                {c.shortcut !== undefined && <span className={styles["hint"]}>{c.shortcut}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
