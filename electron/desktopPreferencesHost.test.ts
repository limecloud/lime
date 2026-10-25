import { describe, expect, it, vi } from "vitest";
import { DesktopPreferencesHost } from "./desktopPreferencesHost";
import { PowerSaveHost } from "./powerSaveHost";

function fixture(platform = "darwin") {
  const read = vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValue({ config: {} });
  const request = vi.fn(async (method: string, params: unknown) => {
    expect({ method, params }).toEqual({ method: "config/read", params: {} });
    return await read();
  });
  const apply = vi.fn<(enabled: boolean) => void>();
  const start = vi.fn(() => 4);
  const stop = vi.fn();
  const powerSaveHost = new PowerSaveHost({ platform, start, stop });
  const host = new DesktopPreferencesHost({
    platform,
    request: async <T>(method: string, params: unknown) =>
      (await request(method, params)) as T,
    setMacMenuBarEnabled: apply,
    powerSaveHost,
  });
  return { host, read, request, apply, start, stop };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("DesktopPreferencesHost", () => {
  it.each(["darwin", "win32", "linux"])(
    "%s applies close preference after acknowledged reads",
    async (platform) => {
      const { host, read } = fixture(platform);
      expect(host.confirmBeforeClose).toBe("always");
      await host.refresh();
      expect(host.confirmBeforeClose).toBe("keyboardOnly");
      for (const value of ["never", "keyboardOnly", "always"]) {
        read.mockResolvedValue({
          config: { desktop: { "confirm-before-close": value } },
        });
        await host.observeResult("config/batchWrite");
        expect(host.confirmBeforeClose).toBe(value);
      }
    },
  );

  it.each([false, 1, [], {}, "keyboard-only"])(
    "invalid close preference keeps last saved value: %j",
    async (value) => {
      const { host, read } = fixture();
      read.mockResolvedValue({
        config: { desktop: { "confirm-before-close": value } },
      });
      await expect(host.refresh()).rejects.toThrow(
        "Invalid window close preference",
      );
      expect(host.confirmBeforeClose).toBe("always");
    },
  );
  it.each([undefined, null, {}, { "mac-menu-bar-enabled": null }])(
    "unset Desktop preference enables the macOS menu bar: %j",
    async (desktop) => {
      const { host, read, apply } = fixture();
      read.mockResolvedValue({ config: { desktop } });
      await host.refresh();
      expect(apply).toHaveBeenCalledExactlyOnceWith(true);
    },
  );

  it("applies each acknowledged preference read, including disabling and re-enabling", async () => {
    const { host, read, apply } = fixture();
    for (const enabled of [false, true]) {
      read.mockResolvedValue({
        config: { desktop: { "mac-menu-bar-enabled": enabled } },
      });
      await host.refresh();
    }
    expect(apply.mock.calls).toEqual([[false], [true]]);
  });

  it.each(["win32"])(
    "%s reads shared preferences without applying macOS resources",
    async (platform) => {
      const { host, request, apply } = fixture(platform);
      await host.refresh();
      await host.observeResult("config/batchWrite");
      await host.observeResult("config/value/write");
      expect(request).toHaveBeenCalledTimes(3);
      expect(apply).not.toHaveBeenCalled();
      expect(host.confirmBeforeClose).toBe("keyboardOnly");
    },
  );

  it("Linux reads the shared power preference without applying macOS menu bar state", async () => {
    const { host, read, request, apply, start, stop } = fixture("linux");
    read.mockResolvedValue({
      config: { desktop: { preventSleepWhileRunning: true } },
    });
    await host.refresh();
    host.observeServerMessage({
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "active", activeFlags: [] } },
    });
    expect(request).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
    host.connectionLost();
    expect(stop).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("an acknowledged power preference applies to current activity and shutdown releases it", async () => {
    const { host, read, start, stop } = fixture();
    host.observeServerMessage({
      method: "thread/status/changed",
      params: { threadId: "a", status: { type: "active", activeFlags: [] } },
    });
    await host.refresh();
    expect(start).not.toHaveBeenCalled();
    read.mockResolvedValue({
      config: { desktop: { preventSleepWhileRunning: true } },
    });
    await host.observeResult("config/batchWrite");
    expect(start).toHaveBeenCalledOnce();
    read.mockResolvedValue({
      config: { desktop: { preventSleepWhileRunning: false } },
    });
    await host.observeResult("config/value/write");
    expect(stop).toHaveBeenCalledOnce();
    read.mockResolvedValue({
      config: { desktop: { preventSleepWhileRunning: true } },
    });
    await host.observeResult("config/value/write");
    host.reset();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it("observes both config write contracts and ignores other responses", async () => {
    const { host, request, apply } = fixture();
    await host.observeResult("config/read");
    await host.observeResult("turn/start");
    expect(request).not.toHaveBeenCalled();
    await host.observeResult("config/batchWrite");
    await host.observeResult("config/value/write");
    expect(request).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls).toEqual([[true], [true]]);
  });

  it("shares concurrent initial reads and allows retry after failure", async () => {
    const { host, read, request, apply } = fixture();
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const first = host.refresh();
    const second = host.refresh();
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve({ config: {} });
    await Promise.all([first, second]);
    expect(apply).toHaveBeenCalledTimes(1);
    read.mockRejectedValueOnce(new Error("read unavailable"));
    await expect(host.refresh()).rejects.toThrow("read unavailable");
    await host.refresh();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("an older read cannot overwrite a newer acknowledged write", async () => {
    const { host, read, apply } = fixture();
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const initial = host.refresh();
    read.mockResolvedValue({
      config: { desktop: { "mac-menu-bar-enabled": false } },
    });
    await host.observeResult("config/batchWrite");
    pending.resolve({ config: {} });
    await initial;
    expect(apply.mock.calls).toEqual([[false]]);
  });

  it("connection loss invalidates old preference reads while recovery can read again", async () => {
    const { host, read, apply } = fixture();
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const initial = host.refresh();
    host.connectionLost();
    read.mockResolvedValue({
      config: { desktop: { "mac-menu-bar-enabled": false } },
    });
    await host.refresh();
    pending.resolve({ config: { desktop: { "mac-menu-bar-enabled": true } } });
    await initial;
    expect(apply.mock.calls).toEqual([[false]]);
  });

  it("shutdown invalidates pending reads before resources can be recreated", async () => {
    const { host, read, apply } = fixture();
    const pending = deferred();
    read.mockReturnValueOnce(pending.promise);
    const initial = host.refresh();
    host.reset();
    pending.resolve({ config: {} });
    await initial;
    expect(apply).not.toHaveBeenCalled();
    await host.refresh();
    await host.observeResult("config/batchWrite");
    await host.observeResult("config/value/write");
    expect(read).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it.each([
    { config: null },
    { config: [] },
    { config: { desktop: [] } },
    { config: { desktop: false } },
    ...["false", 0, [], {}].map((value) => ({
      config: { desktop: { "mac-menu-bar-enabled": value } },
    })),
    ...["false", 0, [], {}].map((value) => ({
      config: { desktop: { preventSleepWhileRunning: value } },
    })),
  ])(
    "invalid config rejects without applying platform state: %j",
    async (response) => {
      const { host, read, apply } = fixture();
      read.mockResolvedValue(response);
      await expect(host.refresh()).rejects.toThrow(/invalid/i);
      expect(apply).not.toHaveBeenCalled();
    },
  );

  it("platform resource failures remain visible to the caller", async () => {
    const { host, apply } = fixture();
    apply.mockImplementationOnce(() => {
      throw new Error("tray unavailable");
    });
    await expect(host.observeResult("config/batchWrite")).rejects.toThrow(
      "tray unavailable",
    );
    await host.refresh();
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
