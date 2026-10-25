import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  WindowCloseConfirmation,
  WindowCloseConfirmationHost,
  installWindowCloseShortcut,
} from "./windowCloseConfirmation";
import type { ConfirmBeforeClose } from "../src/lib/desktop-host/windowCloseConfirmation";
import type { WindowCloseConfirmationResult } from "../src/lib/desktop-host/windowCloseConfirmation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(preference: ConfirmBeforeClose = "keyboardOnly") {
  const response = deferred<WindowCloseConfirmationResult>();
  const confirm = vi.fn(() => response.promise);
  const disableConfirmation = vi.fn(async () => {});
  const onError = vi.fn();
  let destroyed = false;
  const closed = vi.fn();
  const controller = new WindowCloseConfirmation({
    getPreference: () => preference,
    confirm,
    disableConfirmation,
    onError,
  });
  const window = {
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      if (!controller.shouldPreventClose(window)) closed();
    }),
  };
  return {
    controller,
    window,
    closed,
    confirm,
    disableConfirmation,
    onError,
    response,
    destroy: () => {
      destroyed = true;
    },
  };
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("window close lifecycle", () => {
  it.each([
    ["never", false, false],
    ["never", true, false],
    ["keyboardOnly", false, false],
    ["keyboardOnly", true, true],
    ["always", false, true],
    ["always", true, true],
  ] as const)(
    "%s, keyboard=%s requires confirmation=%s",
    (preference, keyboard, asks) => {
      const f = fixture(preference);
      f.controller.requestClose(f.window, keyboard);
      expect(f.confirm).toHaveBeenCalledTimes(asks ? 1 : 0);
      expect(f.closed).toHaveBeenCalledTimes(asks ? 0 : 1);
      expect(f.controller.keyboardRequests.has(f.window)).toBe(false);
    },
  );
  it("coalesces repeats; cancel releases pending and permits a later request", async () => {
    const f = fixture("always");
    f.controller.requestClose(f.window);
    f.controller.requestClose(f.window);
    expect(f.confirm).toHaveBeenCalledTimes(1);
    f.response.resolve({ confirmed: false, doNotAskAgain: true });
    await settle();
    expect(f.closed).not.toHaveBeenCalled();
    expect(f.disableConfirmation).not.toHaveBeenCalled();
    expect(f.controller.pending.has(f.window)).toBe(false);
    f.controller.requestClose(f.window);
    expect(f.confirm).toHaveBeenCalledTimes(2);
  });
  it("confirmation authorizes only the original window and one close", async () => {
    const f = fixture("always");
    f.controller.requestClose(f.window);
    f.response.resolve({ confirmed: true, doNotAskAgain: false });
    await settle();
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.disableConfirmation).not.toHaveBeenCalled();
    expect(f.controller.approved.has(f.window)).toBe(false);
    expect(
      f.controller.shouldPreventClose({ isDestroyed: () => false, close() {} }),
    ).toBe(true);
  });
  it("do-not-ask waits for durable config and fails without closing", async () => {
    const f = fixture("always");
    const saved = deferred<void>();
    f.disableConfirmation.mockReturnValue(saved.promise);
    f.controller.requestClose(f.window);
    f.response.resolve({ confirmed: true, doNotAskAgain: true });
    await settle();
    expect(f.closed).not.toHaveBeenCalled();
    saved.resolve();
    await settle();
    expect(f.closed).toHaveBeenCalledTimes(1);
    const failed = fixture("always");
    failed.disableConfirmation.mockRejectedValue(new Error("write failed"));
    failed.controller.requestClose(failed.window);
    failed.response.resolve({ confirmed: true, doNotAskAgain: true });
    await settle();
    expect(failed.closed).not.toHaveBeenCalled();
    expect(failed.onError).toHaveBeenCalledOnce();
    expect(failed.controller.pending.has(failed.window)).toBe(false);
  });
  it("destroyed windows cannot be closed by late confirmation", async () => {
    const f = fixture("always");
    f.controller.requestClose(f.window);
    f.destroy();
    f.response.resolve({ confirmed: true, doNotAskAgain: true });
    await settle();
    expect(f.closed).not.toHaveBeenCalled();
    expect(f.disableConfirmation).not.toHaveBeenCalled();
  });
});

function nativeWindow(id = 1) {
  const contents = Object.assign(new EventEmitter(), {
    id,
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    send: vi.fn(),
    setIgnoreMenuShortcuts: vi.fn(),
  });
  const native = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
  });
  return { native, window: native as unknown as BrowserWindow, contents };
}
describe("confirmation IPC lifetime", () => {
  it("only accepts the originating sender and current request token", async () => {
    const host = new WindowCloseConfirmationHost();
    const a = nativeWindow(1),
      b = nativeWindow(2);
    const result = host.confirm(a.window);
    const requestId = a.contents.send.mock.calls[0][1].requestId;
    for (const [window, sender, value] of [
      [b.window, 2, { requestId, confirmed: true, doNotAskAgain: true }],
      [a.window, 2, { requestId, confirmed: true, doNotAskAgain: true }],
      [a.window, 1, { requestId: "old", confirmed: true, doNotAskAgain: true }],
      [a.window, 1, { requestId, confirmed: "true", doNotAskAgain: false }],
    ] as const)
      host.respond(window, sender, value);
    expect(host.pending.size).toBe(1);
    host.respond(a.window, 1, {
      requestId,
      confirmed: true,
      doNotAskAgain: false,
    });
    await expect(result).resolves.toEqual({
      confirmed: true,
      doNotAskAgain: false,
    });
    expect(host.pending.size).toBe(0);
    expect(a.contents.listenerCount("did-start-navigation")).toBe(0);
    expect(a.native.listenerCount("closed")).toBe(0);
  });
  it.each(["reload", "closed", "destroyed", "dispose"])(
    "%s cancels pending and cleans listeners",
    async (event) => {
      const host = new WindowCloseConfirmationHost();
      const f = nativeWindow();
      const result = host.confirm(f.window);
      if (event === "reload")
        f.contents.emit(
          "did-start-navigation",
          {},
          "file:///index.html",
          false,
          true,
        );
      else if (event === "dispose") host.dispose();
      else if (event === "closed") f.native.emit(event);
      else f.contents.emit(event);
      await expect(result).resolves.toEqual({
        confirmed: false,
        doNotAskAgain: false,
      });
      expect(host.pending.size).toBe(0);
      expect(f.contents.listenerCount("did-start-navigation")).toBe(0);
    },
  );
  it("ignores subframe/in-place navigation; send failure rejects and can retry", async () => {
    const host = new WindowCloseConfirmationHost();
    const f = nativeWindow();
    f.contents.send.mockImplementationOnce(() => {
      throw Error("send failed");
    });
    await expect(host.confirm(f.window)).rejects.toThrow("send failed");
    expect(host.pending.size).toBe(0);
    const result = host.confirm(f.window);
    f.contents.emit(
      "did-start-navigation",
      {},
      "https://example.test",
      false,
      false,
    );
    f.contents.emit(
      "did-start-navigation",
      {},
      "file:///index.html#x",
      true,
      true,
    );
    expect(host.pending.size).toBe(1);
    host.dispose();
    await expect(result).resolves.toEqual({
      confirmed: false,
      doNotAskAgain: false,
    });
    await expect(host.confirm(f.window)).resolves.toEqual({
      confirmed: false,
      doNotAskAgain: false,
    });
  });
  it.each(["darwin", "win32"])(
    "%s routes primary-W through shared commands and resets on keyup/blur",
    (platform) => {
      const f = nativeWindow();
      installWindowCloseShortcut(f.window, platform);
      const input = {
        type: "keyDown",
        key: "w",
        meta: platform === "darwin",
        control: platform !== "darwin",
        alt: false,
        shift: false,
      };
      f.contents.emit("before-input-event", {}, input);
      expect(f.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
      f.contents.emit("before-input-event", {}, { ...input, type: "keyUp" });
      expect(f.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
      f.contents.emit("before-input-event", {}, input);
      f.native.emit("blur");
      expect(f.contents.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    },
  );
});
