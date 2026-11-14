import { describe, expect, it, vi } from "vitest";
import { finishDesktopFirstRun } from "./desktop-first-run.mjs";

function fixture(snapshot) {
  const actions = [];
  const button = {
    waitFor: vi.fn(async ({ state }) => actions.push(state)),
    click: vi.fn(async () => actions.push("defer")),
  };
  const dialog = { getByRole: vi.fn(() => button) };
  const page = {
    evaluate: vi.fn(async (read) => {
      const invoke = vi.fn(async () => snapshot);
      vi.stubGlobal("window", { electronAPI: { invoke } });
      try {
        const result = await read();
        expect(invoke).toHaveBeenCalledWith("desktop_permissions_read", {});
        return result;
      } finally {
        vi.unstubAllGlobals();
      }
    }),
    getByTestId: vi.fn(() => dialog),
  };
  return { page, dialog, button, actions };
}

describe("Desktop first-run navigation", () => {
  it("waits for a delayed guide before deferring it through its normal UI", async () => {
    const { page, dialog, button, actions } = fixture({ setupComplete: false });
    await expect(finishDesktopFirstRun(page, 120_000)).resolves.toEqual({
      deferred: true,
    });
    expect(page.getByTestId).toHaveBeenCalledWith("permissions-setup");
    const { name } = dialog.getByRole.mock.calls[0][1];
    for (const label of [
      "稍后设置",
      "稍後設定",
      "Set up later",
      "後で設定",
      "나중에 설정",
    ])
      expect(name.test(label)).toBe(true);
    expect(name.test("unrelated dialog action")).toBe(false);
    expect(actions).toEqual(["visible", "defer", "hidden"]);
    expect(button.waitFor).toHaveBeenNthCalledWith(1, {
      state: "visible",
      timeout: 120_000,
    });
  });

  it("leaves a completed profile alone without waiting for a guide", async () => {
    const { page, actions } = fixture({ setupComplete: true });
    await expect(finishDesktopFirstRun(page, 120_000)).resolves.toEqual({
      deferred: false,
    });
    expect(page.getByTestId).not.toHaveBeenCalled();
    expect(actions).toEqual([]);
  });

  it("rejects an invalid permission response before navigating", async () => {
    const { page } = fixture({});
    await expect(finishDesktopFirstRun(page, 120_000)).rejects.toThrow(
      "Desktop first-run preference is unavailable",
    );
    expect(page.getByTestId).not.toHaveBeenCalled();
  });

  it("preserves guide failures instead of clicking through the overlay", async () => {
    const { page, button } = fixture({ setupComplete: false });
    button.waitFor.mockRejectedValueOnce(new Error("guide did not appear"));
    await expect(finishDesktopFirstRun(page, 120_000)).rejects.toThrow(
      "guide did not appear",
    );
    expect(button.click).not.toHaveBeenCalled();
  });
});
