import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { call, isIpcError } from "./core";

const invokeMock = vi.mocked(invoke);

describe("call", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns the resolved value", async () => {
    invokeMock.mockResolvedValue({ ok: 1 });
    await expect(call("x")).resolves.toEqual({ ok: 1 });
  });

  it("wraps AppError rejections keeping the code", async () => {
    invokeMock.mockImplementation(() =>
      Promise.reject({ code: "git.failed", message: "boom", detail: "d" }),
    );
    const err = await call("x").catch((e: unknown) => e);
    expect(isIpcError(err)).toBe(true);
    if (isIpcError(err)) {
      expect(err.error).toEqual({ code: "git.failed", message: "boom", detail: "d" });
    }
  });

  it("maps string rejections to ipc.unknown", async () => {
    invokeMock.mockImplementation(() => Promise.reject("nope"));
    const err = await call("x").catch((e: unknown) => e);
    expect(isIpcError(err) && err.error).toEqual({ code: "ipc.unknown", message: "nope" });
  });
});
