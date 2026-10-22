import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/updater";
import { DEFAULT_SETTINGS, useSettingsStore } from "./settings";
import { CHECK_INTERVAL_MS, LAST_CHECK_KEY, useUpdaterStore } from "./updater";

vi.mock("../ipc/updater", () => ({
  checkForUpdate: vi.fn(),
  restartApp: vi.fn(),
  canSelfUpdate: vi.fn(),
}));
const m = vi.mocked(ipc);

function update(): ipc.AvailableUpdate {
  return {
    version: "1.2.0",
    downloadAndInstall: vi.fn((cb: (p: number) => void) => {
      cb(50);
      return Promise.resolve();
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  m.canSelfUpdate.mockResolvedValue(true);
  m.restartApp.mockResolvedValue();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: true });
  useUpdaterStore.setState({
    status: "idle",
    progress: 0,
    version: null,
    notes: null,
    error: null,
    upToDate: false,
    dismissed: false,
    selfUpdate: true,
  });
});

describe("updater store", () => {
  it("available -> install -> restart", async () => {
    const u = update();
    m.checkForUpdate.mockResolvedValue(u);
    await useUpdaterStore.getState().check();
    expect(useUpdaterStore.getState().status).toBe("available");
    expect(useUpdaterStore.getState().version).toBe("1.2.0");
    await useUpdaterStore.getState().install();
    expect(u.downloadAndInstall).toHaveBeenCalled();
    expect(m.restartApp).toHaveBeenCalled();
    expect(useUpdaterStore.getState().status).toBe("ready");
  });

  it("never installs without install()", async () => {
    const u = update();
    m.checkForUpdate.mockResolvedValue(u);
    await useUpdaterStore.getState().check();
    expect(u.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("does not install when self-update is unavailable", async () => {
    const u = update();
    m.checkForUpdate.mockResolvedValue(u);
    m.canSelfUpdate.mockResolvedValue(false);
    await useUpdaterStore.getState().check();
    await useUpdaterStore.getState().install();
    expect(u.downloadAndInstall).not.toHaveBeenCalled();
    expect(useUpdaterStore.getState().selfUpdate).toBe(false);
  });

  it("reports up to date only for manual checks", async () => {
    m.checkForUpdate.mockResolvedValue(null);
    await useUpdaterStore.getState().check({ manual: true });
    expect(useUpdaterStore.getState().upToDate).toBe(true);
    expect(useUpdaterStore.getState().status).toBe("idle");
  });

  it("automatic failures are silent, manual ones shown", async () => {
    m.checkForUpdate.mockRejectedValue(new Error("offline"));
    await useUpdaterStore.getState().check();
    expect(useUpdaterStore.getState().status).toBe("idle");
    expect(useUpdaterStore.getState().error).toBeNull();
    await useUpdaterStore.getState().check({ manual: true });
    expect(useUpdaterStore.getState().status).toBe("error");
    expect(useUpdaterStore.getState().error).toBe("offline");
  });

  it("dismiss hides until next launch and survives automatic rechecks", async () => {
    m.checkForUpdate.mockResolvedValue(update());
    await useUpdaterStore.getState().check();
    useUpdaterStore.getState().dismiss();
    expect(useUpdaterStore.getState().dismissed).toBe(true);
    await useUpdaterStore.getState().check();
    expect(useUpdaterStore.getState().dismissed).toBe(true);
    await useUpdaterStore.getState().check({ manual: true });
    expect(useUpdaterStore.getState().dismissed).toBe(false);
  });

  it("failed install -> retry", async () => {
    const u = update();
    vi.mocked(u.downloadAndInstall).mockRejectedValueOnce(new Error("net"));
    m.checkForUpdate.mockResolvedValue(u);
    await useUpdaterStore.getState().check();
    await useUpdaterStore.getState().install();
    expect(useUpdaterStore.getState().status).toBe("error");
    expect(useUpdaterStore.getState().version).toBe("1.2.0");
    await useUpdaterStore.getState().install();
    expect(useUpdaterStore.getState().status).toBe("ready");
    expect(m.restartApp).toHaveBeenCalled();
  });

  it("a failed check clears the pending version", async () => {
    m.checkForUpdate.mockResolvedValueOnce(update());
    await useUpdaterStore.getState().check();
    m.checkForUpdate.mockRejectedValue(new Error("offline"));
    await useUpdaterStore.getState().check({ manual: true });
    expect(useUpdaterStore.getState().version).toBeNull();
    await useUpdaterStore.getState().install();
    expect(m.restartApp).not.toHaveBeenCalled();
  });

  it("skips automatic checks until settings are loaded", async () => {
    useSettingsStore.setState({ loaded: false });
    await useUpdaterStore.getState().check();
    expect(m.checkForUpdate).not.toHaveBeenCalled();
  });

  it("treats a future last-check time as never checked", async () => {
    m.checkForUpdate.mockResolvedValue(null);
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() + CHECK_INTERVAL_MS));
    await useUpdaterStore.getState().check();
    expect(m.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips automatic checks when disabled but allows manual", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, autoUpdateCheck: false } });
    m.checkForUpdate.mockResolvedValue(null);
    await useUpdaterStore.getState().check();
    expect(m.checkForUpdate).not.toHaveBeenCalled();
    await useUpdaterStore.getState().check({ manual: true });
    expect(m.checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("throttles automatic checks to once per day", async () => {
    m.checkForUpdate.mockResolvedValue(null);
    await useUpdaterStore.getState().check();
    expect(localStorage.getItem(LAST_CHECK_KEY)).not.toBeNull();
    await useUpdaterStore.getState().check();
    expect(m.checkForUpdate).toHaveBeenCalledTimes(1);
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now() - CHECK_INTERVAL_MS - 1));
    await useUpdaterStore.getState().check();
    expect(m.checkForUpdate).toHaveBeenCalledTimes(2);
  });
});
