import { beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { onOpenRepoRequest } from "./events";

describe("onOpenRepoRequest", () => {
  beforeEach(() => listen.mockReset());

  it("subscribes to open-repo-request and forwards the payload", async () => {
    const unlisten = vi.fn();
    let handler: ((ev: { payload: { path: string } }) => void) | undefined;
    listen.mockImplementation((_name: string, h: typeof handler) => {
      handler = h;
      return Promise.resolve(unlisten);
    });
    const cb = vi.fn();
    const stop = await onOpenRepoRequest(cb);
    expect(listen).toHaveBeenCalledWith("open-repo-request", expect.any(Function));
    handler?.({ payload: { path: "/p/proj" } });
    expect(cb).toHaveBeenCalledWith({ path: "/p/proj" });
    expect(stop).toBe(unlisten);
  });
});
