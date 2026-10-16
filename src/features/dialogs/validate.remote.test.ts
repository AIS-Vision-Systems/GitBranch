import { describe, expect, it } from "vitest";
import { validateRemoteName, validateRemoteUrl } from "./validate";

describe("validateRemoteName", () => {
  it.each(["origin", "my-fork", "a.b_c", "x1"])("accepts %s", (n) => {
    expect(validateRemoteName(n)).toBeNull();
  });
  it.each(["", "-x", ".x", "a b", "a/b", "a:b"])("rejects %j", (n) => {
    expect(validateRemoteName(n)).not.toBeNull();
  });
});

describe("validateRemoteUrl", () => {
  it("accepts urls and rejects empty or option-like", () => {
    expect(validateRemoteUrl("https://github.com/a/b.git")).toBeNull();
    expect(validateRemoteUrl("git@github.com:a/b.git")).toBeNull();
    expect(validateRemoteUrl("  ")).not.toBeNull();
    expect(validateRemoteUrl("--upload-pack=x")).not.toBeNull();
  });
});
