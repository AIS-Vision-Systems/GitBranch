import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "../../lib/icons";
import { useUiStore } from "../../state/ui";
import styles from "./Sidebar.module.css";

interface Props {
  id: string;
  icon: ReactNode;
  title: string;
  count: number | null;
  /** Header buttons, shown on hover / focus-within. */
  actions?: ReactNode;
  children: ReactNode;
}

/** Collapsible sidebar section; the open state is persisted per `id` in the UI store. */
export function SidebarSection({ id, icon, title, count, actions, children }: Props) {
  const open = useUiStore((s) => s.sidebarSections[id] !== false);
  const toggle = useUiStore((s) => s.toggleSidebarSection);
  return (
    <section className={styles["section"]} aria-label={title} data-section={id}>
      <header className={styles["sectionHeader"]}>
        <button
          type="button"
          className={styles["sectionToggle"]}
          aria-expanded={open}
          onClick={() => toggle(id)}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <span className={styles["sectionIcon"]} aria-hidden="true">
            {icon}
          </span>
          <span className={styles["sectionTitle"]}>{title}</span>
          {count !== null && <span className={styles["countPill"]}>{count}</span>}
        </button>
        {actions !== undefined && (
          <div
            className={`${styles["headerActions"]} ${open ? "" : styles["headerActionsCollapsed"]}`}
          >
            {actions}
          </div>
        )}
      </header>
      {open && <div className={styles["sectionBody"]}>{children}</div>}
    </section>
  );
}
