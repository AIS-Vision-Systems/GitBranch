import type { DragEvent } from "react";

/** `dataTransfer` type carrying the dragged local branch name. */
export const REF_MIME = "application/x-gitbranch-ref";

// Module-level so a target can tell whether the drag is its own source (dragover cannot read data).
// Never used to decide whether a foreign drag is a branch drag: that needs the MIME type.
let dragged: string | null = null;

/** Elements currently highlighted as a drop target, with the class that was added. */
const lit = new Map<Element, string>();

export function getDragged(): string | null {
  return dragged;
}

function unlight(el: Element): void {
  const cls = lit.get(el);
  if (cls !== undefined) el.classList.remove(cls);
  lit.delete(el);
}

function clearLit(): void {
  for (const el of Array.from(lit.keys())) unlight(el);
}

export function startDrag(e: DragEvent<HTMLElement>, name: string): void {
  dragged = name;
  e.dataTransfer.setData(REF_MIME, name);
  e.dataTransfer.effectAllowed = "move";
}

/** Forget the drag and remove every drop highlight. */
export function endDrag(): void {
  dragged = null;
  clearLit();
}

/**
 * Window-level safety net: a drag that ends or drops outside any target must not leave a stale
 * `dragged` or highlight behind. Returns the remover. Bubble phase, so targets handle drops first.
 */
export function installDragCleanup(): () => void {
  window.addEventListener("dragend", endDrag);
  window.addEventListener("drop", endDrag);
  return () => {
    window.removeEventListener("dragend", endDrag);
    window.removeEventListener("drop", endDrag);
  };
}

const isRefDrag = (e: DragEvent<HTMLElement>): boolean =>
  Array.from(e.dataTransfer.types).includes(REF_MIME);

/** True when the drag is a branch drag whose source is this very target (refused). */
const isOwn = (own: ((source: string) => boolean) | undefined): boolean =>
  own !== undefined && dragged !== null && own(dragged);

/**
 * dragover: accept and highlight (class toggled on the DOM node so no row re-renders).
 * `own(source)` returns true when the dragged branch is this target's own branch: refused.
 */
export function acceptDrag(
  e: DragEvent<HTMLElement>,
  highlight: string | undefined,
  own?: (source: string) => boolean,
): void {
  if (!isRefDrag(e) || isOwn(own)) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  if (highlight !== undefined) {
    e.currentTarget.classList.add(highlight);
    lit.set(e.currentTarget, highlight);
  }
}

export function leaveDrag(e: DragEvent<HTMLElement>, highlight: string | undefined): void {
  const to = e.relatedTarget;
  if (to instanceof Node && e.currentTarget.contains(to)) return;
  if (highlight !== undefined) {
    e.currentTarget.classList.remove(highlight);
    lit.delete(e.currentTarget);
  }
}

/** drop: returns the dragged branch name, or null when this is not a (foreign) branch drag. */
export function takeDrop(
  e: DragEvent<HTMLElement>,
  highlight: string | undefined,
  own?: (source: string) => boolean,
): string | null {
  if (highlight !== undefined) {
    e.currentTarget.classList.remove(highlight);
    lit.delete(e.currentTarget);
  }
  if (!isRefDrag(e) || isOwn(own)) return null;
  e.preventDefault();
  e.stopPropagation();
  const name = e.dataTransfer.getData(REF_MIME);
  endDrag();
  return name === "" ? null : name;
}
