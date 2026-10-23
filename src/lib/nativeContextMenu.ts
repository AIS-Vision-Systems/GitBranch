/** Elements that keep the webview's own context menu (cut / copy / paste). */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const el = target.closest("input, textarea");
  if (el === null) return false;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "reset", "file"].includes(el.type);
  }
  return true;
}

/**
 * Suppresses the webview's native context menu ("Back", "Reload", "Save as…", "Inspect"…) everywhere
 * except editable fields, where its clipboard items are useful. In dev builds, Shift + right-click
 * still shows it so "Inspect" stays reachable.
 */
export function suppressNativeContextMenu(
  doc: Document = document,
  dev = import.meta.env.DEV,
): void {
  doc.addEventListener("contextmenu", (e) => {
    if (isEditable(e.target)) return;
    if (dev && e.shiftKey) return;
    e.preventDefault();
  });
}
