import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOpenDialog,
  mockGetConfig,
  mockSetBrowserConnectorInstallRoot,
  mockGetBrowserConnectorSettings,
  mockGetBrowserConnectorInstallStatus,
  mockInstallBrowserConnectorExtension,
  mockSetBrowserConnectorEnabled,
  mockSetSystemConnectorEnabled,
  mockSetBrowserActionCapabilityEnabled,
  mockOpenBrowserExtensionsPage,
  mockOpenBrowserRemoteDebuggingPage,
  mockLaunchBrowserSession,
  mockOpenBrowserRuntimeDebuggerWindow,
  mockGetChromeProfileSessions,
  mockGetChromeBridgeEndpointInfo,
  mockGetChromeBridgeStatus,
  mockDisconnectBrowserConnectorSession,
  mockGetBrowserBackendPolicy,
  mockGetBrowserBackendsStatus,
} = vi.hoisted(() => ({
  mockOpenDialog: vi.fn(),
  mockGetConfig: vi.fn(),
  mockSetBrowserConnectorInstallRoot: vi.fn(),
  mockGetBrowserConnectorSettings: vi.fn(),
  mockGetBrowserConnectorInstallStatus: vi.fn(),
  mockInstallBrowserConnectorExtension: vi.fn(),
  mockSetBrowserConnectorEnabled: vi.fn(),
  mockSetSystemConnectorEnabled: vi.fn(),
  mockSetBrowserActionCapabilityEnabled: vi.fn(),
  mockOpenBrowserExtensionsPage: vi.fn(),
  mockOpenBrowserRemoteDebuggingPage: vi.fn(),
  mockLaunchBrowserSession: vi.fn(),
  mockOpenBrowserRuntimeDebuggerWindow: vi.fn(),
  mockGetChromeProfileSessions: vi.fn(),
  mockGetChromeBridgeEndpointInfo: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
  mockDisconnectBrowserConnectorSession: vi.fn(),
  mockGetBrowserBackendPolicy: vi.fn(),
  mockGetBrowserBackendsStatus: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpenDialog(...args),
}));

vi.mock("@/features/browser-runtime", () => ({
  BrowserRuntimeDebugPanel: () => <div data-testid="browser-runtime-panel" />,
}));

vi.mock("@/lib/webview-api", async () => {
  const actual = await vi.importActual<object>("@/lib/webview-api");
  return {
    ...actual,
    getBrowserConnectorSettings: mockGetBrowserConnectorSettings,
    setBrowserConnectorInstallRoot: mockSetBrowserConnectorInstallRoot,
    getBrowserConnectorInstallStatus: mockGetBrowserConnectorInstallStatus,
    installBrowserConnectorExtension: mockInstallBrowserConnectorExtension,
    setBrowserConnectorEnabled: mockSetBrowserConnectorEnabled,
    setSystemConnectorEnabled: mockSetSystemConnectorEnabled,
    setBrowserActionCapabilityEnabled: mockSetBrowserActionCapabilityEnabled,
    openBrowserExtensionsPage: mockOpenBrowserExtensionsPage,
    openBrowserRemoteDebuggingPage: mockOpenBrowserRemoteDebuggingPage,
    launchBrowserSession: mockLaunchBrowserSession,
    openBrowserRuntimeDebuggerWindow: mockOpenBrowserRuntimeDebuggerWindow,
    getChromeProfileSessions: mockGetChromeProfileSessions,
    getChromeBridgeEndpointInfo: mockGetChromeBridgeEndpointInfo,
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    disconnectBrowserConnectorSession: mockDisconnectBrowserConnectorSession,
    getBrowserBackendPolicy: mockGetBrowserBackendPolicy,
    getBrowserBackendsStatus: mockGetBrowserBackendsStatus,
    closeChromeProfileSession: vi.fn(),
    openChromeProfileWindow: vi.fn(),
    setBrowserBackendPolicy: vi.fn(),
    browserExecuteAction: vi.fn(),
    chromeBridgeExecuteCommand: vi.fn(),
  };
});

import { ChromeRelaySettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];
const mockWriteClipboardText = vi.fn();
const mockBrowserActionCapabilities = [
  {
    key: "read_page",
    label: "页面快照",
    description: "抓取当前页面快照。",
    group: "read",
    enabled: true,
  },
  {
    key: "find",
    label: "页面内查找",
    description: "在当前页面中查找文本。",
    group: "read",
    enabled: true,
  },
  {
    key: "navigate",
    label: "导航",
    description: "导航到目标地址。",
    group: "write",
    enabled: true,
  },
  {
    key: "click",
    label: "点击元素",
    description: "点击页面元素。",
    group: "write",
    enabled: true,
  },
] as const;

function renderComponent() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ChromeRelaySettings />);
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

function findTabButton(
  container: HTMLElement,
  text: string,
): HTMLButtonElement {
  const target = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent?.trim().startsWith(text),
  );
  if (!target) {
    throw new Error(`未找到页签按钮: ${text}`);
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

  mockGetConfig.mockResolvedValue({
    web_search: {
      engine: "google",
    },
  });
  mockGetBrowserConnectorSettings.mockResolvedValue({
    enabled: true,
    install_root_dir: null,
    install_dir: null,
    browser_action_capabilities: mockBrowserActionCapabilities.map(
      (capability) => ({ ...capability }),
    ),
    system_connectors: [
      {
        id: "calendar",
        label: "日历",
        description: "读取和管理你的日历事件。",
        enabled: false,
        available: true,
        visible: true,
        authorization_status: "not_determined",
        last_error: null,
        capabilities: ["list_events", "create_event", "update_event"],
      },
    ],
  });
  mockSetBrowserConnectorInstallRoot.mockResolvedValue({
    enabled: true,
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    browser_action_capabilities: mockBrowserActionCapabilities.map(
      (capability) => ({ ...capability }),
    ),
    system_connectors: [
      {
        id: "calendar",
        label: "日历",
        description: "读取和管理你的日历事件。",
        enabled: false,
        available: true,
        visible: true,
        authorization_status: "not_determined",
        last_error: null,
        capabilities: ["list_events", "create_event", "update_event"],
      },
    ],
  });
  mockGetBrowserConnectorInstallStatus.mockResolvedValue({
    status: "not_installed",
    install_root_dir: null,
    install_dir: null,
    bundled_name: "Lime Browser Connector",
    bundled_version: "0.2.0",
    installed_name: null,
    installed_version: null,
    message: "尚未选择浏览器连接器安装目录",
  });
  mockInstallBrowserConnectorExtension.mockResolvedValue({
    install_root_dir: "/Users/test/connectors",
    install_dir: "/Users/test/connectors/Lime Browser Connector",
    bundled_name: "Lime Browser Connector",
    bundled_version: "0.2.0",
    installed_version: "0.2.0",
    auto_config_path:
      "/Users/test/connectors/Lime Browser Connector/auto_config.json",
  });
  mockSetBrowserConnectorEnabled.mockResolvedValue({
    enabled: false,
    install_root_dir: null,
    install_dir: null,
    browser_action_capabilities: mockBrowserActionCapabilities.map(
      (capability) => ({ ...capability }),
    ),
    system_connectors: [
      {
        id: "calendar",
        label: "日历",
        description: "读取和管理你的日历事件。",
        enabled: false,
        available: true,
        visible: true,
        authorization_status: "not_determined",
        last_error: null,
        capabilities: ["list_events", "create_event", "update_event"],
      },
    ],
  });
  mockSetSystemConnectorEnabled.mockResolvedValue({
    enabled: true,
    install_root_dir: null,
    install_dir: null,
    browser_action_capabilities: mockBrowserActionCapabilities.map(
      (capability) => ({ ...capability }),
    ),
    system_connectors: [
      {
        id: "calendar",
        label: "日历",
        description: "读取和管理你的日历事件。",
        enabled: true,
        available: true,
        visible: true,
        authorization_status: "authorized",
        last_error: null,
        capabilities: ["list_events", "create_event", "update_event"],
      },
    ],
  });
  mockSetBrowserActionCapabilityEnabled.mockResolvedValue({
    enabled: true,
    install_root_dir: null,
    install_dir: null,
    browser_action_capabilities: [
      {
        key: "read_page",
        label: "页面快照",
        description: "抓取当前页面快照。",
        group: "read",
        enabled: true,
      },
      {
        key: "find",
        label: "页面内查找",
        description: "在当前页面中查找文本。",
        group: "read",
        enabled: false,
      },
      {
        key: "navigate",
        label: "导航",
        description: "导航到目标地址。",
        group: "write",
        enabled: true,
      },
      {
        key: "click",
        label: "点击元素",
        description: "点击页面元素。",
        group: "write",
        enabled: true,
      },
    ],
    system_connectors: [
      {
        id: "calendar",
        label: "日历",
        description: "读取和管理你的日历事件。",
        enabled: true,
        available: true,
        visible: true,
        authorization_status: "authorized",
        last_error: null,
        capabilities: ["list_events", "create_event", "update_event"],
      },
    ],
  });
  mockOpenBrowserExtensionsPage.mockResolvedValue(true);
  mockOpenBrowserRemoteDebuggingPage.mockResolvedValue(true);
  mockLaunchBrowserSession.mockResolvedValue({
    profile: {
      success: true,
      reused: false,
    },
    session: {
      session_id: "mock-session",
      profile_key: "search_google",
      target_id: "mock-target",
      target_title: "Mock Target",
      target_url: "https://www.google.com/search?q=lime+browser+assist",
      remote_debugging_port: 13001,
      ws_debugger_url: "ws://127.0.0.1:13001/devtools/page/mock-target",
      created_at: "2026-03-14T00:00:00Z",
      connected: true,
    },
  });
  mockOpenBrowserRuntimeDebuggerWindow.mockResolvedValue(undefined);
  mockGetChromeProfileSessions.mockResolvedValue([]);
  mockGetChromeBridgeEndpointInfo.mockResolvedValue({
    server_running: true,
    host: "127.0.0.1",
    port: 8999,
    observer_ws_url: "ws://127.0.0.1:8999/observer",
    control_ws_url: "ws://127.0.0.1:8999/control",
    bridge_key: "proxy_cast",
  });
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 0,
    control_count: 0,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
  });
  mockDisconnectBrowserConnectorSession.mockResolvedValue({
    disconnected_observer_count: 1,
    disconnected_control_count: 1,
    status: {
      observer_count: 0,
      control_count: 0,
      pending_command_count: 0,
      observers: [],
      controls: [],
      pending_commands: [],
    },
  });
  mockGetBrowserBackendPolicy.mockResolvedValue({
    priority: ["aster_compat", "lime_extension_bridge", "cdp_direct"],
    auto_fallback: true,
  });
  mockGetBrowserBackendsStatus.mockResolvedValue({
    policy: {
      priority: ["aster_compat", "lime_extension_bridge", "cdp_direct"],
      auto_fallback: true,
    },
    bridge_observer_count: 0,
    bridge_control_count: 0,
    running_profile_count: 0,
    cdp_alive_profile_count: 0,
    aster_native_host_supported: true,
    aster_native_host_configured: false,
    backends: [],
  });
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
});

describe("ChromeRelaySettings", () => {
  it("应在展开高级控制后切换到浏览器实时调试面板", async () => {
    const container = renderComponent();
    await flushEffects();

    expect(
      container.querySelector('[data-testid="browser-runtime-panel"]'),
    ).toBeNull();

    const expandButton = findButton(container, "展开高级控制");
    await act(async () => {
      expandButton.click();
      await flushEffects();
    });

    const tabButton = findTabButton(container, "调试");
    await act(async () => {
      tabButton.click();
      await flushEffects();
    });

    expect(
      container.querySelector('[data-testid="browser-runtime-panel"]'),
    ).not.toBeNull();
  });

  it("选择目录后应安装浏览器连接器到固定子目录", async () => {
    const container = renderComponent();
    await flushEffects();

    const button = findButton(container, "选择目录并安装");
    await act(async () => {
      button.click();
      await flushEffects();
    });

    expect(mockOpenDialog).toHaveBeenCalledTimes(1);
    expect(mockSetBrowserConnectorInstallRoot).toHaveBeenCalledWith(
      "/Users/test/connectors",
    );
    expect(mockInstallBrowserConnectorExtension).toHaveBeenCalledWith({
      install_root_dir: "/Users/test/connectors",
      profile_key: "default",
    });
    expect(container.textContent).toContain(
      "浏览器连接器已同步到 /Users/test/connectors/Lime Browser Connector",
    );
  });

  it("应复制默认连接器配置到剪贴板", async () => {
    const container = renderComponent();
    await flushEffects();

    const button = findButton(container, "复制配置");
    await act(async () => {
      button.click();
      await flushEffects();
    });

    expect(mockWriteClipboardText).toHaveBeenCalledTimes(1);
    expect(mockWriteClipboardText.mock.calls[0]?.[0]).toContain(
      '"profileKey": "default"',
    );
    expect(mockWriteClipboardText.mock.calls[0]?.[0]).toContain(
      '"bridgeKey": "proxy_cast"',
    );
    expect(container.textContent).toContain("默认浏览器连接器 配置已复制到剪贴板");
  });

  it("点击一键按钮时应启动浏览器协助", async () => {
    const container = renderComponent();
    await flushEffects();

    const button = findButton(container, "一键启动浏览器协助");
    await act(async () => {
      button.click();
      await flushEffects();
    });

    expect(mockLaunchBrowserSession).toHaveBeenCalledTimes(1);
    expect(mockLaunchBrowserSession).toHaveBeenCalledWith({
      profile_key: "search_google",
      url: "https://www.google.com/search?q=lime+browser+assist",
      open_window: true,
      stream_mode: "both",
    });
    expect(container.textContent).toContain("浏览器协助已启动");
  });

  it("点击按钮时应打开独立浏览器调试窗口", async () => {
    const container = renderComponent();
    await flushEffects();

    const button = findButton(container, "打开独立调试窗口");
    await act(async () => {
      button.click();
      await flushEffects();
    });

    expect(mockOpenBrowserRuntimeDebuggerWindow).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("已打开独立浏览器调试窗口");
  });

  it("应提供扩展与远程调试引导入口", async () => {
    const container = renderComponent();
    await flushEffects();

    expect(container.textContent).toContain("连接方式");
    expect(container.textContent).toContain("浏览器扩展");
    expect(container.textContent).toContain("CDP 直连");

    const extensionButton = findButton(container, "打开扩展页");
    await act(async () => {
      extensionButton.click();
      await flushEffects();
    });

    expect(mockOpenBrowserExtensionsPage).toHaveBeenCalledTimes(1);

    const remoteDebuggingButton = findButton(container, "打开远程调试页");
    await act(async () => {
      remoteDebuggingButton.click();
      await flushEffects();
    });

    expect(mockOpenBrowserRemoteDebuggingPage).toHaveBeenCalledTimes(1);
  });

  it("扩展已连接时应允许断开当前连接", async () => {
    mockGetChromeBridgeStatus.mockResolvedValueOnce({
      observer_count: 1,
      control_count: 1,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "default",
          connected_at: "2026-03-14T00:00:00Z",
        },
      ],
      controls: [
        {
          client_id: "control-1",
          connected_at: "2026-03-14T00:00:00Z",
        },
      ],
      pending_commands: [],
    });

    const container = renderComponent();
    await flushEffects();

    expect(container.textContent).toContain("控制已接入 1");

    const button = findButton(container, "断开已连接扩展");
    await act(async () => {
      button.click();
      await flushEffects();
    });

    expect(mockDisconnectBrowserConnectorSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("已断开 1 个扩展观察连接和 1 个控制连接");
  });

  it("应按扩展桥接真实能力渲染动作清单", async () => {
    mockGetBrowserBackendsStatus.mockResolvedValueOnce({
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
      backends: [
        {
          backend: "lime_extension_bridge",
          available: true,
          capabilities: [
            "navigate",
            "read_page",
            "get_page_text",
            "find",
            "form_input",
            "tabs_context_mcp",
            "open_url",
            "click",
            "type",
            "scroll",
            "scroll_page",
            "get_page_info",
            "refresh_page",
            "go_back",
            "go_forward",
            "switch_tab",
            "list_tabs",
          ],
        },
      ],
    });

    const container = renderComponent();
    await flushEffects();

    expect(container.textContent).toContain("页面内查找");
    expect(container.textContent).toContain("页面文本");
    expect(container.textContent).toContain("表单输入");
    expect(container.textContent).toContain("返回上一页");
    expect(container.textContent).not.toContain("悬停");
    expect(container.textContent).not.toContain("拖放");
    expect(container.textContent).not.toContain("上传文件");
    expect(container.textContent).not.toContain("处理弹窗");
  });

  it("应允许切换浏览器动作配置", async () => {
    const container = renderComponent();
    await flushEffects();

    const target = container.querySelector(
      'button[aria-label="切换页面内查找"]',
    );
    expect(target).not.toBeNull();

    await act(async () => {
      (target as HTMLButtonElement).click();
      await flushEffects();
    });

    expect(mockSetBrowserActionCapabilityEnabled).toHaveBeenCalledWith({
      key: "find",
      enabled: false,
    });
    expect(container.textContent).toContain("页面内查找 已关闭");
  });

  it("系统连接器为空时不应渲染 macOS 连接器卡片", async () => {
    mockGetBrowserConnectorSettings.mockResolvedValueOnce({
      enabled: true,
      install_root_dir: null,
      install_dir: null,
      system_connectors: [],
    });

    const container = renderComponent();
    await flushEffects();

    expect(container.textContent).not.toContain("macOS 连接器");
    expect(container.textContent).not.toContain("0 / 0 已启用");
  });
});
