import { describe, expect, it } from "vitest";
import { buildBranchOptions, isLookupReady, shortReason } from "./cloneBranches";

describe("buildBranchOptions", () => {
  it("puts the labelled default first, then branches", () => {
    expect(buildBranchOptions("main", ["main", "dev"])).toEqual([
      { value: "", label: "Default branch (main)" },
      { value: "main", label: "main" },
      { value: "dev", label: "dev" },
    ]);
  });

  it("omits the name when the default is unknown", () => {
    expect(buildBranchOptions(null, [])).toEqual([{ value: "", label: "Default branch" }]);
    expect(buildBranchOptions(undefined, [])[0]?.label).toBe("Default branch");
  });
});

describe("shortReason", () => {
  it("takes the first non-empty line and truncates", () => {
    expect(shortReason(new Error("\nfatal: nope\nmore"))).toBe("fatal: nope");
    expect(shortReason("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
});

describe("isLookupReady", () => {
  it.each([
    "https://github.com/acme/beta.git",
    "http://localhost/repo",
    "ssh://git@host.example.com:22/a/b",
    "git://example.org/x",
    "git@github.com:acme/beta.git",
    String.raw`C:\repos\beta`,
    "/srv/git/beta",
  ])("accepts %s", (u) => expect(isLookupReady(u)).toBe(true));

  it.each([
    "",
    "h",
    "https://gi",
    "https://github.com",
    "https://github.com/",
    "https://github/x",
    "git@github.com:",
    "git@github.com",
    "C:",
  ])("rejects %s", (u) => expect(isLookupReady(u)).toBe(false));
});
