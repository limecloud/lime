import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOpenDialog,
  mockOpenPathWithDefaultApp,
  mockGetBrowserConnectorSettings,
  mockGetBrowserConnectorInstallStatus,
  mockGetChromeBridgeStatus,
  mockGetBrowserBackendsStatus,
  mockInstallBrowserConnectorExtension,
  mockSetBrowserConnectorInstallRoot,
  mockOpenBrowserExtensionsPage,
  mockOpenBrowserRemoteDebuggingPage,
  mockHasTauriInvokeCapability,
} = vi.hoisted(() => ({
  mockOpenDialog: vi.fn(),
  mockOpenPathWithDefaultApp: vi.fn(),
  mockGetBrowserConnectorSettings: vi.fn(),
  mockGetBrowserConnectorInstallStatus: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
  mockGetBrowserBackendsStatus: vi.fn(),
  mockInstallBrowserConnectorExtension: vi.fn(),
  mockSetBrowserConnectorInstallRoot: vi.fn(),
  mockOpenBrowserExtensionsPage: vi.fn(),
  mockOpenBrowserRemoteDebuggingPage: vi.fn(),
  mockHasTauriInvokeCapability: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));

vi.mock("@/lib/api/fileSystem", () => ({
  openPathWithDefaultApp: (...args: unknown[]) =>
    mockOpenPathWithDefaultApp(...args),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: mockHasTauriInvokeCapability,
}));

vi.mock("@/lib/webview-api", async () => {
  const actual = await vi.importActual<object>("@/lib/webview-api");
  return {
    ...actual,
    getBrowserConnectorSettings: mockGetBrowserConnectorSettings,
    getBrowserConnectorInstallStatus: mockGetBrowserConnectorInstallStatus,
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    getBrowserBackendsStatus: mockGetBrowserBackendsStatus,
    installBrowserConnectorExtension: mockInstallBrowserConnectorExtension,
    setBrowserConnectorInstallRoot: mockSetBrowserConnectorInstallRoot,
    openBrowserExtensionsPage: mockOpenBrowserExtensionsPage,
    openBrowserRemoteDebuggingPage: mockOpenBrowserRemoteDebuggingPage,
  };
});

import { openBrowserConnectorGuideWindow } from "./guide-window-launcher";
import { BrowserConnectorGuideWindow } from "./guide-window";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];
const mockWriteClipboardText = vi.fn();

function renderGuide(route: string) {
  window.history.pushState({}, "", route);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<BrowserConnectorGuideWindow />);
  });
  mounted.push({ container, root });
  return container;
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.includes(text),
  );
  if (!target) {
    throw new Error(`未找到按钮: ${text}`);
  }
  return target as HTMLButtonElement;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: mockWriteClipboardText,
    },
  });

  mockWriteClipboardText.mockResolvedValue(undefined);
  mockOpenDialog.mockResolvedValue("/Users/test/connectors");
  mockOpenPathWithDefaultApp.mockResolvedValue(undefined);
  mockHasTauriInvokeCapability.mockReturnValue(false);
  mockGetBrowserConnectorSettings.mockResolvedValue({
    enabled: true,
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    system_connectors: [],
    browser_action_capabilities: [],
  });
  mockGetBrowserConnectorInstallStatus.mockResolvedValue({
    status: "installed",
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    bundled_name: "Lime Browser Connector",
    bundled_version: "0.4.0",
    installed_name: "Lime Browser Connector",
    installed_version: "0.4.0",
    message: null,
  });
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 1,
    control_count: 1,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
  });
  mockGetBrowserBackendsStatus.mockResolvedValue({
    policy: {
      priority: ["aster_compat", "lime_extension_bridge", "cdp_direct"],
      auto_fallback: true,
    },
    bridge_observer_count: 1,
    bridge_control_count: 1,
    running_profile_count: 1,
    cdp_alive_profile_count: 1,
    aster_native_host_supported: true,
    aster_native_host_configured: false,
    backends: [],
  });
  mockInstallBrowserConnectorExtension.mockResolvedValue({
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    bundled_name: "Lime Browser Connector",
    bundled_version: "0.4.0",
    installed_version: "0.4.0",
    auto_config_path:
      "/Users/test/connectors/Lime Browser Connector/auto_config.json",
  });
  mockSetBrowserConnectorInstallRoot.mockResolvedValue({
    enabled: true,
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    system_connectors: [],
    browser_action_capabilities: [],
  });
  mockOpenBrowserExtensionsPage.mockResolvedValue(true);
  mockOpenBrowserRemoteDebuggingPage.mockResolvedValue(true);
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) break;
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
});

describe("BrowserConnectorGuideWindow", () => {
  it("extension 模式应展示扩展安装步骤和源码目录警告", async () => {
    const container = renderGuide("/browser-connector-guide?mode=extension");
    await flushEffects();

    expect(container.textContent).toContain("安装 Lime Browser Bridge");
    expect(container.textContent).toContain("打开 chrome://extensions");
    expect(container.textContent).toContain("同步并打开扩展文件夹");
    expect(container.textContent).toContain(
      "不要直接加载仓库源码里的 extensions/lime-chrome",
    );

    const openExtensionsButton = findButton(
      container,
      "打开 chrome://extensions",
    );
    await act(async () => {
      openExtensionsButton.click();
      await flushEffects();
    });
    expect(mockOpenBrowserExtensionsPage).toHaveBeenCalledTimes(1);

    const installButton = findButton(container, "同步扩展");
    await act(async () => {
      installButton.click();
      await flushEffects();
    });
    expect(mockInstallBrowserConnectorExtension).toHaveBeenCalledWith({
      install_root_dir: "/Users/test/connectors",
      profile_key: "default",
    });

    const chooseDirectoryButton = findButton(container, "重新选择目录");
    await act(async () => {
      chooseDirectoryButton.click();
      await flushEffects();
    });
    expect(mockOpenDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      defaultPath: "/Users/test/connectors",
    });
    expect(mockSetBrowserConnectorInstallRoot).toHaveBeenCalledWith(
      "/Users/test/connectors",
    );
  });

  it("cdp 模式应展示直连步骤并打开远程调试页", async () => {
    const container = renderGuide("/browser-connector-guide?mode=cdp");
    await flushEffects();

    expect(container.textContent).toContain("启用浏览器直连");
    expect(container.textContent).toContain(
      "打开 chrome://inspect/#remote-debugging",
    );
    expect(container.textContent).toContain("允许 Lime 连接");

    const remoteDebuggingButton = findButton(
      container,
      "打开 chrome://inspect/#remote-debugging",
    );
    await act(async () => {
      remoteDebuggingButton.click();
      await flushEffects();
    });
    expect(mockOpenBrowserRemoteDebuggingPage).toHaveBeenCalledTimes(1);
  });

  it("未知 mode 应回退到扩展连接引导", async () => {
    const container = renderGuide("/browser-connector-guide?mode=unknown");
    await flushEffects();

    expect(container.textContent).toContain("安装 Lime Browser Bridge");
    expect(container.textContent).not.toContain("启用浏览器直连");
  });

  it("非 Tauri 环境打开引导时应回退到浏览器窗口", async () => {
    const mockWindowOpen = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    await openBrowserConnectorGuideWindow({ mode: "cdp" });

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/browser-connector-guide?mode=cdp",
      "_blank",
      "noopener,noreferrer",
    );
    mockWindowOpen.mockRestore();
  });
});
