import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openExternalMock, isDefaultProtocolClientMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  isDefaultProtocolClientMock: vi.fn(() => false),
}));

vi.mock("./electronRuntime", () => ({
  app: {
    getName: () => "Lime",
    isPackaged: true,
    isDefaultProtocolClient: isDefaultProtocolClientMock,
  },
  systemPreferences: {
    isTrustedAccessibilityClient: () => false,
  },
  shell: {
    openExternal: openExternalMock,
  },
}));

import { SystemUtilityHost } from "./systemUtilityHost";
import { MacOSNativeHostClient } from "./macosNativeHost";
import { WindowsNativeHostClient } from "./windowsNativeHost";

const tempDirs: string[] = [];

async function createTempUserDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lime-system-utility-"));
  tempDirs.push(dir);
  return dir;
}

function createHost(appDataRoot: string): SystemUtilityHost {
  return new SystemUtilityHost({
    appDataRoot,
  });
}

afterEach(async () => {
  vi.clearAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("SystemUtilityHost", () => {
  it.each(["darwin", "win32"] as const)(
    "%s 旧原生转发拒绝 Computer Use，保留现役观察方法",
    async (platform) => {
      const original = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", {
        configurable: true,
        value: platform,
      });
      const host = createHost(await createTempUserDataDir());
      const client =
        platform === "darwin" ? MacOSNativeHostClient : WindowsNativeHostClient;
      const invoke = vi
        .spyOn(client.prototype, "invoke")
        .mockResolvedValue({ observed: true });
      const call = (method: string) =>
        platform === "darwin"
          ? host.invokeMacOSNativeHost({ method, params: {} })
          : host.invokeWindowsNativeHost({ method, params: {} });
      try {
        for (const suffix of [
          "snapshot",
          "setup",
          "execute",
          "cancel",
          "futureMethod",
        ])
          await expect(call(`computerUse.${suffix}`)).rejects.toMatchObject({
            code: "unsupported",
          });
        expect(invoke).not.toHaveBeenCalled();
        await expect(
          call(
            platform === "darwin"
              ? "accessibility.read"
              : "windows.window.read",
          ),
        ).resolves.toEqual({ observed: true });
        expect(invoke).toHaveBeenCalledOnce();
      } finally {
        invoke.mockRestore();
        host.dispose();
        Object.defineProperty(process, "platform", original);
      }
    },
  );
  it.each([true, false])(
    "保存启动时的 HTTPS 默认协议身份 %s，不在每次读取时重查 OS",
    async (value) => {
      isDefaultProtocolClientMock.mockReturnValueOnce(value);
      const host = createHost(await createTempUserDataDir());
      expect(isDefaultProtocolClientMock).toHaveBeenCalledExactlyOnceWith(
        "https",
      );
      expect(host.isDefaultBrowser()).toBe(value);
      expect(host.isDefaultBrowser()).toBe(value);
      expect(isDefaultProtocolClientMock).toHaveBeenCalledOnce();
      host.dispose();
    },
  );
  it("openExternalUrl 只允许 http/https 并通过系统浏览器打开", async () => {
    const host = createHost(await createTempUserDataDir());
    openExternalMock.mockResolvedValueOnce(undefined);

    await expect(
      host.openExternalUrl({ url: " https://user.limeai.run/login " }),
    ).resolves.toEqual({});
    await expect(
      host.openExternalUrl({ url: "file:///tmp/token" }),
    ).rejects.toThrow("外部链接只支持 http/https 地址");

    expect(openExternalMock).toHaveBeenCalledTimes(1);
    expect(openExternalMock).toHaveBeenCalledWith(
      "https://user.limeai.run/login",
    );
  });

  it("openSystemSettingsUrl 只允许系统设置 scheme", async () => {
    const host = createHost(await createTempUserDataDir());
    openExternalMock.mockResolvedValue(undefined);

    await expect(
      host.openSystemSettingsUrl({
        url: " x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility ",
      }),
    ).resolves.toEqual({});
    await expect(
      host.openSystemSettingsUrl({
        url: "ms-settings:clipboard",
      }),
    ).resolves.toEqual({});
    await expect(
      host.openSystemSettingsUrl({
        url: "https://example.com/settings",
      }),
    ).rejects.toThrow(
      "系统设置链接只支持 x-apple.systempreferences 或 ms-settings scheme",
    );

    expect(openExternalMock).toHaveBeenCalledTimes(2);
    expect(openExternalMock).toHaveBeenNthCalledWith(
      1,
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
    expect(openExternalMock).toHaveBeenNthCalledWith(
      2,
      "ms-settings:clipboard",
    );
  });
});
