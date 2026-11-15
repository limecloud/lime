import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_MENU_HOST_EVENT,
  APP_MENU_WINDOW_EVENT,
  listenAppMenuCommand,
} from "./appMenuNavigation";

const hostListeners = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>(),
);

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: async (
    event: string,
    handler: (arg: { payload: unknown }) => void,
  ) => {
    hostListeners.set(event, handler);
    return () => hostListeners.delete(event);
  },
}));

describe("appMenuNavigation", () => {
  afterEach(() => {
    hostListeners.clear();
    vi.clearAllMocks();
  });

  it("响应窗口自定义事件里的 settings/new-chat 命令", () => {
    const handler = vi.fn();
    const stop = listenAppMenuCommand(handler);

    window.dispatchEvent(
      new CustomEvent(APP_MENU_WINDOW_EVENT, {
        detail: { command: "settings" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(APP_MENU_WINDOW_EVENT, {
        detail: { command: "new-chat" },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(APP_MENU_WINDOW_EVENT, {
        detail: { command: "unknown" },
      }),
    );

    expect(handler.mock.calls).toEqual([["settings"], ["new-chat"]]);
    stop();
  });

  it("响应桌面 Host 广播的应用菜单命令", async () => {
    const handler = vi.fn();
    const stop = listenAppMenuCommand(handler);
    await Promise.resolve();
    const listener = hostListeners.get(APP_MENU_HOST_EVENT);
    expect(listener).toBeDefined();

    listener?.({ payload: { command: "new-standalone-chat" } });
    expect(handler).toHaveBeenCalledWith("new-standalone-chat");

    stop();
    expect(hostListeners.has(APP_MENU_HOST_EVENT)).toBe(false);
  });
});
