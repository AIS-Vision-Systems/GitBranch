import { describe, expect, it } from "vitest";
import { githubOwner } from "./remoteOwner";

describe("githubOwner", () => {
  it.each([
    ["https://github.com/octo/repo", "octo"],
    ["https://github.com/octo/repo.git", "octo"],
    ["https://user@github.com/octo/repo.git", "octo"],
    ["git@github.com:octo/repo.git", "octo"],
    ["git@github.com:octo/repo", "octo"],
    ["ssh://git@github.com/octo/repo", "octo"],
    ["ssh://git@github.com/octo/repo.git", "octo"],
    ["ssh://anything@github.com/o/r", "o"],
    ["anything@github.com:o/r.git", "o"],
  ])("%s -> %s", (url, owner) => {
    expect(githubOwner(url)).toBe(owner);
  });

  it.each([
    "https://gitlab.com/octo/repo.git",
    "git@gitlab.com:octo/repo.git",
    "https://github.com/octo",
    "C:\\repos\\x",
    "",
    "https://github.com/foo.bar/repo",
    "git@github.com:-bad/repo",
    `https://github.com/${"a".repeat(40)}/repo`,
  ])("%s -> null", (url) => {
    expect(githubOwner(url)).toBeNull();
  });
});
