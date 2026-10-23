import { describe, expect, it } from "vitest";
import { suppressNativeContextMenu } from "./nativeContextMenu";

function fire(el: Element, shiftKey = false): boolean {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, shiftKey });
  return el.dispatchEvent(ev); // false when preventDefault() was called
}

describe("suppressNativeContextMenu", () => {
  it("prevents the native menu on plain elements, keeps it on editable fields", () => {
    const doc = document.implementation.createHTMLDocument("t");
    const div = doc.createElement("div");
    const input = doc.createElement("input");
    const button = doc.createElement("input");
    button.type = "button";
    const area = doc.createElement("textarea");
    doc.body.append(div, input, button, area);
    suppressNativeContextMenu(doc, false);

    expect(fire(div)).toBe(false);
    expect(fire(button)).toBe(false);
    expect(fire(input)).toBe(true);
    expect(fire(area)).toBe(true);
  });

  it("lets Shift + right-click through only in dev", () => {
    const dev = document.implementation.createHTMLDocument("dev");
    const prod = document.implementation.createHTMLDocument("prod");
    const a = dev.createElement("div");
    const b = prod.createElement("div");
    dev.body.append(a);
    prod.body.append(b);
    suppressNativeContextMenu(dev, true);
    suppressNativeContextMenu(prod, false);

    expect(fire(a, true)).toBe(true);
    expect(fire(a)).toBe(false);
    expect(fire(b, true)).toBe(false);
  });
});
