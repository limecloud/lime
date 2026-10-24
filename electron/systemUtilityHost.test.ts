import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openExternalMock, isDefaultProtocolClientMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  isDefaultProtocolClientMock: vi.fn(() => false),
}));

vi.mock("./electronRuntime", () => ({
  app: {
    getName: () => "Lime",
    getVersion: () => "0.0.0-test",
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

  it("浏览器诊断占位保持 degraded diagnostic 形态", async () => {
    const appDataRoot = await createTempUserDataDir();
    const host = createHost(appDataRoot);

    expect(host.getBrowserConnectorSettings()).toEqual(
      expect.objectContaining({
        enabled: true,
        install_root_dir: path.join(appDataRoot, "connectors", "browser"),
        diagnostic: expect.objectContaining({
          command: "get_browser_connector_settings_cmd",
        }),
      }),
    );
    expect(host.getBrowserConnectorInstallStatus()).toEqual(
      expect.objectContaining({
        status: "not_installed",
        bundled_version: "0.0.0-test",
        diagnostic: expect.objectContaining({
          command: "get_browser_connector_install_status_cmd",
        }),
      }),
    );
    expect(host.getChromeBridgeEndpointInfo()).toEqual(
      expect.objectContaining({
        server_running: false,
        diagnostic: expect.objectContaining({
          command: "get_chrome_bridge_endpoint_info",
        }),
      }),
    );
    expect(host.getBrowserBackendsStatus()).toEqual(
      expect.objectContaining({
        policy: expect.objectContaining({
          priority: ["lime_extension_bridge", "cdp_direct"],
        }),
        backends: expect.arrayContaining([
          expect.objectContaining({
            backend: "lime_extension_bridge",
            available: false,
          }),
        ]),
        diagnostic: expect.objectContaining({
          command: "get_browser_backends_status",
        }),
      }),
    );

    const profileSessions = host.getChromeProfileSessions();
    expect(profileSessions).toEqual([]);
    expect(
      Object.getOwnPropertyDescriptor(profileSessions, "__diagnostic"),
    ).toEqual(
      expect.objectContaining({
        enumerable: false,
        value: expect.objectContaining({
          command: "get_chrome_profile_sessions",
          status: "degraded",
        }),
      }),
    );
  });
});
