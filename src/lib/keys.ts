// Inputs whose keystrokes do not edit a value. `range` is not here: arrow keys move its thumb.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "color", "file"]);

/** True when keystrokes at `target` are text editing (input, textarea, select, contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target.isContentEditable || target.closest('[contenteditable="true"], .cm-editor') !== null
  );
}
