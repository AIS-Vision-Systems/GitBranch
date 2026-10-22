import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ipc from "../ipc/settings";
import { DEFAULT_SETTINGS, useSettingsStore } from "./settings";

vi.mock("../ipc/settings", () => ({ getSettings: vi.fn(), setSettings: vi.fn() }));
const m = vi.mocked(ipc);

beforeEach(() => {
  vi.resetAllMocks();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false, error: null });
});

describe("settings store", () => {
  it("loads settings", async () => {
    m.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, diffContextLines: 8 });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings.diffContextLines).toBe(8);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it("save merges the partial and stores the backend result", async () => {
    m.setSettings.mockImplementation((s) => Promise.resolve(s));
    const ok = await useSettingsStore.getState().save({ pullStrategy: "rebase" });
    expect(ok).toBe(true);
    expect(m.setSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, pullStrategy: "rebase" });
    expect(useSettingsStore.getState().settings.pullStrategy).toBe("rebase");
  });

  it("keeps old settings and records the error when save fails", async () => {
    m.setSettings.mockRejectedValue(new Error("no such file"));
    const ok = await useSettingsStore.getState().save({ gitPath: "/nope" });
    expect(ok).toBe(false);
    expect(useSettingsStore.getState().settings.gitPath).toBeNull();
    expect(useSettingsStore.getState().error).toBe("no such file");
  });
});
