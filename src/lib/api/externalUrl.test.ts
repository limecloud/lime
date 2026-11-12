import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  isDefaultBrowser,
  openExternalUrlWithSystemBrowser,
} from "./externalUrl";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("externalUrl API", () => {
  beforeEach(() => {
    vi.mocked(safeInvoke).mockReset();
  });

  it.each([true, false])(
    "reads the native default browser status %s",
    async (value) => {
      vi.mocked(safeInvoke).mockResolvedValueOnce(value);
      await expect(isDefaultBrowser()).resolves.toBe(value);
      expect(safeInvoke).toHaveBeenCalledExactlyOnceWith("is_default_browser");
    },
  );

  it.each([
    undefined,
    null,
    0,
    1,
    "true",
    "false",
    {},
    { isDefaultBrowser: true },
    { diagnostic: { source: "electron-host-diagnostic" } },
  ])("rejects invalid native default browser status %j", async (value) => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(value);
    await expect(isDefaultBrowser()).rejects.toThrow();
  });

  it("propagates native default browser query failures", async () => {
    const error = new Error("OS query failed");
    vi.mocked(safeInvoke).mockRejectedValueOnce(error);
    await expect(isDefaultBrowser()).rejects.toBe(error);
  });

  it("应通过 native 命令打开系统默认浏览器", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(
      openExternalUrlWithSystemBrowser("https://user.limeai.run/login"),
    ).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://user.limeai.run/login",
    });
  });

  it("打开外部链接遇到 Electron degraded diagnostic facade 时应 fail closed", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      diagnostic: {
        category: "electron-diagnostic-facade",
        source: "electron-host-diagnostic",
      },
    });

    await expect(
      openExternalUrlWithSystemBrowser("https://user.limeai.run/login"),
    ).rejects.toThrow(
      "open_external_url 尚未接入真实外部链接 current 通道，收到 electron-host-diagnostic 诊断返回。",
    );
  });

  it("打开外部链接只接受真实空返回", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({
        error: {
          code: "COMMAND_UNSUPPORTED",
          message: "not available",
        },
      });

    await expect(
      openExternalUrlWithSystemBrowser("https://user.limeai.run/login"),
    ).resolves.toBeUndefined();
    await expect(
      openExternalUrlWithSystemBrowser("https://user.limeai.run/login"),
    ).rejects.toThrow(
      "open_external_url did not return empty Electron host result",
    );
    await expect(
      openExternalUrlWithSystemBrowser("https://user.limeai.run/login"),
    ).rejects.toThrow(
      "open_external_url did not return empty Electron host result",
    );
  });
});
