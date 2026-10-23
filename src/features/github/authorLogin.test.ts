import { describe, expect, it } from "vitest";
import { loginForAuthor } from "./authorLogin";

const acct = { login: "octo", email: "Octo@Example.com" };

describe("loginForAuthor", () => {
  it("parses both noreply forms", () => {
    expect(loginForAuthor("12345+alice@users.noreply.github.com", null)).toBe("alice");
    expect(loginForAuthor("bob@users.noreply.github.com", null)).toBe("bob");
  });
  it("is case-insensitive on the host", () => {
    expect(loginForAuthor("bob@Users.NoReply.GitHub.com", null)).toBe("bob");
  });
  it("matches the account email", () => {
    expect(loginForAuthor("octo@example.com", acct)).toBe("octo");
  });
  it("matches the identity email", () => {
    expect(loginForAuthor("me@work.io", { login: "octo", email: null }, "ME@work.io")).toBe("octo");
  });
  it("returns null for unknown or signed-out authors", () => {
    expect(loginForAuthor("x@y.com", null)).toBeNull();
    expect(loginForAuthor("x@y.com", acct, "z@y.com")).toBeNull();
  });
  it("returns null for empty email", () => {
    expect(loginForAuthor("  ", acct, "  ")).toBeNull();
  });
});
