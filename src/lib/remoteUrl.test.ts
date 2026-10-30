import { describe, expect, it } from "vitest";
import { githubHttpsUrlOf, hostOf, webUrlOf } from "./remoteUrl";

describe("webUrlOf", () => {
  it.each([
    ["https://github.com/o/r.git", "https://github.com/o/r"],
    ["https://github.com/o/r/", "https://github.com/o/r"],
    ["https://user@github.com/o/r.git", "https://github.com/o/r"],
    ["http://example.com/o/r", "http://example.com/o/r"],
    ["git@github.com:o/r.git", "https://github.com/o/r"],
    ["ssh://git@gitlab.com/o/r.git", "https://gitlab.com/o/r"],
    ["ssh://git@host.com:2222/o/r", "https://host.com/o/r"],
  ])("%s", (input, out) => expect(webUrlOf(input)).toBe(out));

  it.each(["", "/local/path", "C:\repo", "file:///x/y", "https://github.com/"])(
    "null for %s",
    (input) => expect(webUrlOf(input)).toBeNull(),
  );

  it("hostOf", () => expect(hostOf("https://github.com/o/r")).toBe("github.com"));

  it("hostOf is null instead of throwing on a malformed URL", () => {
    expect(hostOf("https://bad host/o/r")).toBeNull();
    expect(hostOf("not a url")).toBeNull();
  });

  it("webUrlOf rejects a host containing a space", () => {
    expect(webUrlOf("https://bad host/o/r")).toBeNull();
    expect(webUrlOf("ssh://git@bad host/o/r")).toBeNull();
  });
});

describe("githubHttpsUrlOf", () => {
  it.each([
    ["git@github.com:o/r.git", "https://github.com/o/r.git"],
    ["git@github.com:o/r", "https://github.com/o/r.git"],
    ["ssh://git@github.com/o/r.git", "https://github.com/o/r.git"],
    ["https://github.com/o/r.git", null],
    ["git@gitlab.com:o/r.git", null],
    ["/local/path", null],
  ])("%s -> %s", (input, expected) => {
    expect(githubHttpsUrlOf(input)).toBe(expected);
  });
});
