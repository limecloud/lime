import { describe, expect, it, vi } from "vitest";
import { IPC_EMIT_CHANNEL } from "./ipcChannels";
import {
  canBroadcastRendererEvent,
  registerRendererEventHandler,
} from "./rendererEventPolicy";

describe("renderer event broadcast authority", () => {
  it("allows existing renderer events and rejects Main persistence notifications", () => {
    expect(canBroadcastRendererEvent("config-changed")).toBe(true);
    expect(canBroadcastRendererEvent("persisted-atom-update")).toBe(false);
    expect(canBroadcastRendererEvent("window-close-confirmation")).toBe(false);
  });

  it("does not coerce malformed IPC names or execute their getters", () => {
    const coerce = vi.fn(() => "config-changed");
    for (const value of [null, undefined, 42, [], { toString: coerce }])
      expect(canBroadcastRendererEvent(value)).toBe(false);
    expect(coerce).not.toHaveBeenCalled();
  });

  it("rejects forged saved acknowledgements at the Main IPC handler", () => {
    const on = vi.fn();
    const broadcast = vi.fn();
    registerRendererEventHandler({ on }, broadcast);
    expect(on).toHaveBeenCalledWith(IPC_EMIT_CHANNEL, expect.any(Function));
    const handler = on.mock.calls[0][1];
    handler({ sender: { id: 42 } }, "persisted-atom-update", {
      persistence: { state: "saved" },
    });
    handler({ sender: { id: 42 } }, null, "malformed");
    handler({ sender: { id: 42 } }, "window-close-confirmation", {
      requestId: "forged",
    });
    expect(broadcast).not.toHaveBeenCalled();
    handler({ sender: { id: 42 } }, "config-changed", { theme: "dark" });
    expect(broadcast).toHaveBeenCalledExactlyOnceWith("config-changed", {
      theme: "dark",
    });
  });
});
