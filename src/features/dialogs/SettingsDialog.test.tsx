import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../ipc/settings";
import { DEFAULT_SETTINGS, useSettingsStore } from "../../state/settings";
import { SettingsDialog } from "./SettingsDialog";

const save = vi.fn<(p: Partial<Settings>) => Promise<boolean>>().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, error: null, save });
});

const field = (): HTMLElement => screen.getByLabelText(/^Auto-fetch interval/);

describe("SettingsDialog auto-fetch interval", () => {
  it("defaults to 10 seconds", () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    expect(field()).toHaveValue(10);
  });

  it("rejects 1-4 seconds and saves 0 (off)", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog onClose={vi.fn()} />);
    await user.clear(field());
    await user.type(field(), "3");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(field());
    await user.type(field(), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ autoFetchSeconds: 0 }));
  });
});
