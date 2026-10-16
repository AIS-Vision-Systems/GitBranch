import { describe, expect, it } from "vitest";
import { cloneNameFromUrl, joinClonePath, validateCloneName, validateCloneUrl } from "./validate";

describe("validateCloneUrl", () => {
  it("accepts the usual forms", () => {
    for (const u of [
      "https://github.com/o/r.git",
      "ssh://git@host/o/r",
      "git@github.com:o/r.git",
      "C:\\x\\y.git",
      "/srv/repo",
    ])
      expect(validateCloneUrl(u)).toBeNull();
  });
  it("rejects empty, leading dash and whitespace", () => {
    expect(validateCloneUrl("")).not.toBeNull();
    expect(validateCloneUrl("--upload-pack=x")).not.toBeNull();
    expect(validateCloneUrl("https://a b")).not.toBeNull();
  });
});

describe("validateCloneUrl credentials", () => {
  it("rejects userinfo in http(s) URLs", () => {
    for (const u of ["https://ghp_x@github.com/o/r.git", "https://u:p@host/o/r", "http://u@h/r"])
      expect(validateCloneUrl(u)).toMatch(/Credentials in the URL/);
  });
  it("keeps ssh forms valid", () => {
    expect(validateCloneUrl("ssh://git@host/o/r")).toBeNull();
    expect(validateCloneUrl("git@host:o/r")).toBeNull();
  });
});

describe("validateCloneName windows", () => {
  it("rejects invalid Windows names", () => {
    for (const n of [
      "a<b",
      "a:b",
      'a"b',
      "a|b",
      "a?b",
      "a*b",
      "ab",
      "a.",
      "a ",
      "con",
      "NUL",
      "com1.txt",
      "Lpt9",
    ])
      expect(validateCloneName(n)).not.toBeNull();
    for (const n of ["console", "com10", "a.b", "my-repo"]) expect(validateCloneName(n)).toBeNull();
  });
});

describe("cloneNameFromUrl", () => {
  it("derives the folder name", () => {
    expect(cloneNameFromUrl("https://github.com/o/r.git")).toBe("r");
    expect(cloneNameFromUrl("git@github.com:o/r.git")).toBe("r");
    expect(cloneNameFromUrl("https://host/o/r/")).toBe("r");
    expect(cloneNameFromUrl("C:\\x\\y.git")).toBe("y");
    expect(cloneNameFromUrl("")).toBe("");
  });
});

describe("validateCloneName / joinClonePath", () => {
  it("validates names", () => {
    expect(validateCloneName("r")).toBeNull();
    for (const n of ["", ".", "..", "a/b", "a\\b"]) expect(validateCloneName(n)).not.toBeNull();
  });
  it("joins with the parent's separator", () => {
    expect(joinClonePath("C:\\Data", "r")).toBe("C:\\Data\\r");
    expect(joinClonePath("/home/u", "r")).toBe("/home/u/r");
    expect(joinClonePath("/home/u/", "r")).toBe("/home/u/r");
  });
});
