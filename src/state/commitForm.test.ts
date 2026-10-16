import { beforeEach, describe, expect, it, vi } from "vitest";
import { IpcError } from "../ipc/core";
import type { RepoId } from "../ipc/types";

vi.mock("../ipc/commit", () => ({
  commit: vi.fn(),
  commitTemplate: vi.fn(),
  headMessage: vi.fn(),
}));

import * as ipc from "../ipc/commit";
import { SIGNOFF_KEY, forRepo, useCommitFormStore } from "./commitForm";
import { useUiStore } from "./ui";

const m = vi.mocked(ipc);
const id = "r1" as RepoId;
const st = () => useCommitFormStore.getState();
const f = (r: RepoId = id) => forRepo(st(), r);

beforeEach(() => {
  vi.clearAllMocks();
  st().reset();
  useUiStore.setState({ toasts: [] });
});

describe("commit form store", () => {
  it("clears an untouched template once it no longer applies", async () => {
    m.commitTemplate.mockResolvedValue({ message: "Merge branch 'x'", source: "mergeMsg" });
    await st().loadTemplate(id);
    expect(f().message).toBe("Merge branch 'x'");
    m.commitTemplate.mockResolvedValue(null);
    await st().loadTemplate(id);
    expect(f().message).toBe("");
    expect(f().templateSource).toBeNull();
  });

  it("keeps an edited template message when the template disappears", async () => {
    m.commitTemplate.mockResolvedValue({ message: "Merge branch 'x'", source: "mergeMsg" });
    await st().loadTemplate(id);
    st().setMessage(id, "Merge branch 'x' (edited)");
    m.commitTemplate.mockResolvedValue(null);
    await st().loadTemplate(id);
    expect(f().message).toBe("Merge branch 'x' (edited)");
  });

  it("amend prefills with HEAD message and restores the previous one", async () => {
    m.headMessage.mockResolvedValue("old subject");
    await st().setAmend(id, true);
    expect(f().message).toBe("old subject");
    st().setMessage(id, "old subject edited");
    await st().setAmend(id, false);
    expect(f().message).toBe("");
    expect(f().amend).toBe(false);
  });

  it("amend keeps a message the user typed", async () => {
    st().setMessage(id, "mine");
    await st().setAmend(id, true);
    expect(m.headMessage).not.toHaveBeenCalled();
    expect(f().message).toBe("mine");
    await st().setAmend(id, false);
    expect(f().message).toBe("mine");
  });

  it("amend replaces an untouched template", async () => {
    m.commitTemplate.mockResolvedValue({ message: "Merge x", source: "mergeMsg" });
    m.headMessage.mockResolvedValue("head");
    await st().loadTemplate(id);
    expect(f().message).toBe("Merge x");
    expect(f().templateSource).toBe("mergeMsg");
    await st().setAmend(id, true);
    expect(f().message).toBe("head");
    await st().setAmend(id, false);
    expect(f().message).toBe("Merge x");
  });

  it("loadTemplate does not overwrite a typed message", async () => {
    m.commitTemplate.mockResolvedValue({ message: "T", source: "configTemplate" });
    st().setMessage(id, "typed");
    await st().loadTemplate(id);
    expect(f().message).toBe("typed");
  });

  it("commit clears the message and toasts the short oid", async () => {
    m.commit.mockResolvedValue("abcdef1234567");
    st().setMessage(id, "feat: x");
    expect(await st().commit(id)).toBe(true);
    expect(m.commit).toHaveBeenCalledWith(id, {
      message: "feat: x",
      amend: false,
      signoff: false,
      allowEmpty: false,
      noVerify: false,
    });
    expect(f().message).toBe("");
    expect(useUiStore.getState().toasts[0]).toMatchObject({
      kind: "success",
      title: "Committed abcdef1",
    });
  });

  it("blank message is not committed", async () => {
    st().setMessage(id, "   \n");
    expect(await st().commit(id)).toBe(false);
    expect(m.commit).not.toHaveBeenCalled();
  });

  it("arg.invalid becomes a toast and keeps the message", async () => {
    m.commit.mockRejectedValue(new IpcError({ code: "arg.invalid", message: "Nothing to commit" }));
    st().setMessage(id, "x");
    expect(await st().commit(id)).toBe(false);
    expect(f().message).toBe("x");
    expect(f().committing).toBe(false);
    expect(useUiStore.getState().toasts[0]?.title).toBe("Nothing to commit");
  });

  it("keeps forms per repo and drops a late template reply for another repo", async () => {
    const b = "r2" as RepoId;
    let resolveA: (v: { message: string; source: "mergeMsg" }) => void = () => undefined;
    m.commitTemplate.mockReturnValueOnce(
      new Promise((r) => {
        resolveA = r;
      }),
    );
    const pending = st().loadTemplate(id);
    st().setMessage(b, "");
    expect(f(b).message).toBe("");
    resolveA({ message: "A tpl", source: "mergeMsg" });
    await pending;
    expect(f(b).message).toBe("");
    expect(f(b).templateSource).toBeNull();
    expect(f(id).message).toBe("A tpl");
  });

  it("a reply that was in flight during reset is dropped", async () => {
    let resolveA: (v: { message: string; source: "mergeMsg" }) => void = () => undefined;
    m.commitTemplate.mockReturnValueOnce(
      new Promise((r) => {
        resolveA = r;
      }),
    );
    const pending = st().loadTemplate(id);
    st().reset();
    resolveA({ message: "late", source: "mergeMsg" });
    await pending;
    expect(f().message).toBe("");
  });

  it("persists sign-off", () => {
    st().setSignoff(true);
    expect(localStorage.getItem(SIGNOFF_KEY)).toBe("1");
    expect(st().signoff).toBe(true);
  });
});
