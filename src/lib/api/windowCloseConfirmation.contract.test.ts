import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  bridge: null as null | {
    window: {
      close: ReturnType<typeof vi.fn>;
      confirmClose: ReturnType<typeof vi.fn>;
    };
    listen: ReturnType<typeof vi.fn>;
  },
}));
vi.mock("@/lib/electron-host", () => ({
  getElectronHostBridge: () => state.bridge,
}));
import {
  canCloseWindow,
  listenWindowCloseConfirmation,
  requestWindowClose,
  respondWindowCloseConfirmation,
} from "./windowCloseConfirmation";
beforeEach(() => {
  state.bridge = null;
});
describe("window close gateway", () => {
  it("without native Host, cannot register Close or use a mock fallback", async () => {
    expect(canCloseWindow()).toBe(false);
    expect(listenWindowCloseConfirmation(vi.fn())).toBeNull();
    await expect(requestWindowClose()).rejects.toThrow("Host unavailable");
    await expect(
      respondWindowCloseConfirmation({
        requestId: "x",
        confirmed: false,
        doNotAskAgain: false,
      }),
    ).rejects.toThrow("Host unavailable");
  });
  it("forwards keyboard origin and exact token through the existing window bridge", async () => {
    const stop = vi.fn();
    state.bridge = {
      window: {
        close: vi.fn(async () => {}),
        confirmClose: vi.fn(async () => {}),
      },
      listen: vi.fn(async () => stop),
    };
    const receive = vi.fn();
    const unsubscribe = await listenWindowCloseConfirmation(receive);
    expect(canCloseWindow()).toBe(true);
    expect(state.bridge.listen).toHaveBeenCalledWith(
      "window-close-confirmation",
      expect.any(Function),
    );
    const event = state.bridge.listen.mock.calls[0][1];
    for (const payload of [null, {}, { requestId: 1 }, { requestId: "" }])
      event({ payload });
    expect(receive).not.toHaveBeenCalled();
    event({ payload: { requestId: "current" } });
    expect(receive).toHaveBeenCalledExactlyOnceWith({ requestId: "current" });
    await requestWindowClose();
    expect(state.bridge.window.close).toHaveBeenCalledExactlyOnceWith(true);
    const response = {
      requestId: "current",
      confirmed: true,
      doNotAskAgain: true,
    };
    await respondWindowCloseConfirmation(response);
    expect(state.bridge.window.confirmClose).toHaveBeenCalledExactlyOnceWith(
      response,
    );
    unsubscribe?.();
    expect(stop).toHaveBeenCalledOnce();
  });
});
