import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./keys";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

describe("isEditableTarget", () => {
  it("is true for text inputs, textarea and select", () => {
    expect(isEditableTarget(el("<input>"))).toBe(true);
    expect(isEditableTarget(el('<input type="search">'))).toBe(true);
    expect(isEditableTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isEditableTarget(el("<select></select>"))).toBe(true);
  });

  it("is false for button-like inputs", () => {
    for (const t of ["button", "checkbox", "radio", "submit", "color", "file"]) {
      expect(isEditableTarget(el(`<input type="${t}">`))).toBe(false);
    }
    // Arrow keys move a range thumb, so it keeps shortcuts away like a text field.
    expect(isEditableTarget(el('<input type="range">'))).toBe(true);
  });

  it("is true inside contenteditable or a CodeMirror editor", () => {
    const ce = el('<div contenteditable="true"><b>x</b></div>');
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(ce.firstElementChild)).toBe(true);
    const inner = el('<div class="cm-editor"><span>x</span></div>').firstElementChild;
    expect(isEditableTarget(inner)).toBe(true);
  });

  it("is false for null, plain elements and non-elements", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(el("<div></div>"))).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
  });
});
