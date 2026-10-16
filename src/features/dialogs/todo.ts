import type { TodoItem } from "../../ipc/merge";

export interface TodoRow extends TodoItem {
  subject: string;
}

/** Null when the list can be started; otherwise the reason it cannot. */
export function validateTodo(rows: TodoRow[]): string | null {
  const first = rows.find((r) => r.action !== "drop");
  if (first === undefined) return "Keep at least one commit";
  if (first.action !== "pick") return "First commit must be pick";
  return null;
}

export function moveRow<T>(rows: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}
