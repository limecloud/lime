import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserProfileManager } from "./BrowserProfileManager";

const {
  mockListBrowserProfiles,
  mockSaveBrowserProfile,
  mockArchiveBrowserProfile,
  mockRestoreBrowserProfile,
  mockLaunchBrowserSession,
  mockGetChromeBridgeStatus,
  mockBrowserExecuteAction,
} = vi.hoisted(() => ({
  mockListBrowserProfiles: vi.fn(),
  mockSaveBrowserProfile: vi.fn(),
  mockArchiveBrowserProfile: vi.fn(),
  mockRestoreBrowserProfile: vi.fn(),
  mockLaunchBrowserSession: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
  mockBrowserExecuteAction: vi.fn(),
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    listBrowserProfiles: mockListBrowserProfiles,
    saveBrowserProfile: mockSaveBrowserProfile,
    archiveBrowserProfile: mockArchiveBrowserProfile,
    restoreBrowserProfile: mockRestoreBrowserProfile,
    launchBrowserSession: mockLaunchBrowserSession,
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    browserExecuteAction: mockBrowserExecuteAction,
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockListBrowserProfiles.mockResolvedValue([
    {
      id: "profile-1",
      profile_key: "shop_us",
      name: "美区电商账号",
      description: "主账号",
      site_scope: "seller.example.com",
      launch_url: "https://seller.example.com",
      transport_kind: "managed_cdp",
      profile_dir: "/tmp/lime/chrome_profiles/shop_us",
      managed_profile_dir: "/tmp/lime/chrome_profiles/shop_us",
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z",
      last_used_at: null,
      archived_at: null,
    },
  ]);
  mockLaunchBrowserSession.mockResolvedValue({
    profile: { success: true },
    session: { profile_key: "shop_us" },
  });
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 0,
    control_count: 0,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
  });
  mockBrowserExecuteAction.mockResolvedValue({
    success: true,
    backend: "lime_extension_bridge",
    action: "navigate",
    request_id: "browser-1",
    attempts: [],
    data: {
      message: "ok",
    },
  });
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

async function renderManager(props?: {
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  onProfileLaunched?: (profileKey: string) => void;
  launchEnvironmentPresetId?: string;
  launchEnvironmentPresetOptions?: Array<{ id: string; name: string }>;
  onLaunchEnvironmentPresetChange?: (presetId: string) => void;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(<BrowserProfileManager {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("BrowserProfileManager", () => {
  it("应渲染已保存资料列表", async () => {
    const container = await renderManager();

    expect(container.textContent).toContain("已保存资料");
    expect(container.textContent).toContain("美区电商账号");
    expect(container.textContent).toContain("shop_us");
    expect(mockListBrowserProfiles).toHaveBeenCalled();
  }, 10000);

  it("未检测到当前 Chrome 连接时应显示附着模式未就绪提示", async () => {
    const container = await renderManager();

    expect(container.textContent).toContain("附着模式当前设备未就绪");
    expect(container.textContent).toContain(
      "请先在当前 Chrome 安装并连接 Lime Browser Bridge",
    );
  });

  it("启动资料后应回调工作台并提示成功", async () => {
    const onMessage = vi.fn();
    const onProfileLaunched = vi.fn();
    const container = await renderManager({
      onMessage,
      onProfileLaunched,
      launchEnvironmentPresetId: "env-1",
      launchEnvironmentPresetOptions: [{ id: "env-1", name: "美区桌面" }],
    });

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("启动实时会话"),
    ) as HTMLButtonElement | undefined;

    expect(launchButton).toBeDefined();

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).toHaveBeenCalledWith({
      profile_id: "profile-1",
      environment_preset_id: "env-1",
      open_window: false,
      stream_mode: "both",
    });
    expect(onProfileLaunched).toHaveBeenCalledWith("shop_us");
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已启动资料：美区电商账号（环境：美区桌面）",
    });
  });

  it("新建附着当前 Chrome 资料时应提交 existing_session 模式", async () => {
    mockSaveBrowserProfile.mockResolvedValue({
      id: "profile-attach",
      profile_key: "weibo_attach",
      name: "微博附着",
      description: "复用当前 Chrome",
      site_scope: "weibo.com",
      launch_url: "https://weibo.com",
      transport_kind: "existing_session",
      profile_dir: "",
      managed_profile_dir: null,
      created_at: "2026-03-15T00:00:00Z",
      updated_at: "2026-03-15T00:00:00Z",
      last_used_at: null,
      archived_at: null,
    });

    const container = await renderManager();
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("新建资料"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      createButton?.click();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const nameInput = inputs.find(
      (element) => element.getAttribute("placeholder") === "例如：美区电商账号",
    ) as HTMLInputElement | undefined;
    const keyInput = inputs.find(
      (element) => element.getAttribute("placeholder") === "例如：shop_us",
    ) as HTMLInputElement | undefined;
    const urlInput = inputs.find(
      (element) =>
        element.getAttribute("placeholder") === "https://example.com",
    ) as HTMLInputElement | undefined;
    const transportSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((element) =>
      Array.from(element.querySelectorAll("option")).some(
        (option) => option.textContent === "附着当前 Chrome",
      ),
    ) as HTMLSelectElement | undefined;

    await act(async () => {
      if (nameInput) {
        setInputValue(nameInput, "微博附着");
      }
      if (keyInput) {
        setInputValue(keyInput, "weibo_attach");
      }
      if (urlInput) {
        setInputValue(urlInput, "https://weibo.com");
      }
      if (transportSelect) {
        setSelectValue(transportSelect, "existing_session");
      }
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("创建资料"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(mockSaveBrowserProfile).toHaveBeenCalledWith({
      id: undefined,
      profile_key: "weibo_attach",
      name: "微博附着",
      description: undefined,
      site_scope: undefined,
      launch_url: "https://weibo.com",
      transport_kind: "existing_session",
    });
  });

  it("应显示 existing_session 资料的桥接在线状态", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockGetChromeBridgeStatus.mockResolvedValue({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "weibo_attach",
          connected_at: "2026-03-15T00:00:00Z",
          user_agent: "Chrome",
          last_heartbeat_at: "2026-03-15T00:00:02Z",
          last_page_info: {
            title: "微博创作中心",
            url: "https://weibo.com",
            markdown: "# 微博创作中心",
            updated_at: "2026-03-15T00:00:05Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const container = await renderManager();

    expect(container.textContent).toContain("附着模式当前设备可用");
    expect(container.textContent).toContain("当前 Chrome 附着:");
    expect(container.textContent).toContain("1/1");
    expect(container.textContent).toContain("当前 Chrome 已连接");
    expect(container.textContent).toContain("当前页面: 微博创作中心");
  });

  it("附着当前 Chrome 资料应支持读取并切换当前窗口标签页", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockGetChromeBridgeStatus
      .mockResolvedValueOnce({
        observer_count: 1,
        control_count: 0,
        pending_command_count: 0,
        observers: [
          {
            client_id: "observer-1",
            profile_key: "weibo_attach",
            connected_at: "2026-03-15T00:00:00Z",
            user_agent: "Chrome",
            last_heartbeat_at: "2026-03-15T00:00:02Z",
            last_page_info: {
              title: "微博首页",
              url: "https://weibo.com/home",
              markdown: "# 微博首页",
              updated_at: "2026-03-15T00:00:05Z",
            },
          },
        ],
        controls: [],
        pending_commands: [],
      })
      .mockResolvedValueOnce({
        observer_count: 1,
        control_count: 0,
        pending_command_count: 0,
        observers: [
          {
            client_id: "observer-1",
            profile_key: "weibo_attach",
            connected_at: "2026-03-15T00:00:00Z",
            user_agent: "Chrome",
            last_heartbeat_at: "2026-03-15T00:00:06Z",
            last_page_info: {
              title: "微博首页",
              url: "https://weibo.com/home",
              markdown: "# 微博首页",
              updated_at: "2026-03-15T00:00:05Z",
            },
          },
        ],
        controls: [],
        pending_commands: [],
      });
    mockBrowserExecuteAction
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "list_tabs",
        request_id: "browser-tabs-1",
        attempts: [],
        data: {
          data: {
            tabs: [
              {
                id: 101,
                index: 0,
                title: "微博首页",
                url: "https://weibo.com/home",
                active: true,
              },
              {
                id: 202,
                index: 1,
                title: "微博创作中心",
                url: "https://weibo.com/compose",
                active: false,
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "switch_tab",
        request_id: "browser-switch-1",
        attempts: [],
        data: {
          page_info: {
            title: "微博创作中心",
            url: "https://weibo.com/compose",
            markdown: "# 微博创作中心",
            updated_at: "2026-03-15T00:00:08Z",
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "list_tabs",
        request_id: "browser-tabs-2",
        attempts: [],
        data: {
          data: {
            tabs: [
              {
                id: 101,
                index: 0,
                title: "微博首页",
                url: "https://weibo.com/home",
                active: false,
              },
              {
                id: 202,
                index: 1,
                title: "微博创作中心",
                url: "https://weibo.com/compose",
                active: true,
              },
            ],
          },
        },
      });
    const onMessage = vi.fn();

    const container = await renderManager({ onMessage });
    const toggleTabsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("查看标签页")) as
      | HTMLButtonElement
      | undefined;

    await act(async () => {
      toggleTabsButton?.click();
      await Promise.resolve();
    });

    expect(mockBrowserExecuteAction).toHaveBeenNthCalledWith(1, {
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "list_tabs",
      timeout_ms: 30000,
    });
    expect(container.textContent).toContain("当前窗口标签页");
    expect(container.textContent).toContain("微博创作中心");

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("切换到此页"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(mockBrowserExecuteAction).toHaveBeenNthCalledWith(2, {
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "switch_tab",
      args: {
        target: "202",
        wait_for_page_info: true,
      },
      timeout_ms: 30000,
    });
    expect(mockBrowserExecuteAction).toHaveBeenNthCalledWith(3, {
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "list_tabs",
      timeout_ms: 30000,
    });
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已切换到标签页：微博创作中心",
    });
    expect(container.textContent).toContain("当前标签页");
    expect(container.textContent).toContain("当前页面: 微博创作中心");
    expect(container.textContent).toContain("微博创作中心");
  });

  it("附着模式表单应提示启动环境兼容限制", async () => {
    const container = await renderManager({
      launchEnvironmentPresetId: "env-1",
      launchEnvironmentPresetOptions: [{ id: "env-1", name: "美区桌面" }],
    });
    const createButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("新建资料"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      createButton?.click();
    });

    const transportSelect = Array.from(
      container.querySelectorAll("select"),
    ).find((element) =>
      Array.from(element.querySelectorAll("option")).some(
        (option) => option.textContent === "附着当前 Chrome",
      ),
    ) as HTMLSelectElement | undefined;

    await act(async () => {
      if (transportSelect) {
        setSelectValue(transportSelect, "existing_session");
      }
    });

    expect(container.textContent).toContain('已选择启动环境 "美区桌面"');
    expect(container.textContent).toContain(
      "附着当前 Chrome 模式暂不应用代理、时区、语言、UA 或视口等启动级配置",
    );
  });

  it("附着当前 Chrome 资料应通过扩展桥接附着当前会话", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockGetChromeBridgeStatus.mockResolvedValue({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "weibo_attach",
          connected_at: "2026-03-15T00:00:00Z",
          user_agent: "Chrome",
          last_heartbeat_at: "2026-03-15T00:00:02Z",
          last_page_info: null,
        },
      ],
      controls: [],
      pending_commands: [],
    });
    const onMessage = vi.fn();
    const onProfileLaunched = vi.fn();
    const container = await renderManager({
      onMessage,
      onProfileLaunched,
      launchEnvironmentPresetId: "env-1",
      launchEnvironmentPresetOptions: [{ id: "env-1", name: "美区桌面" }],
    });
    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("附着当前 Chrome"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).toHaveBeenCalledWith({
      profile_id: "profile-attach",
      environment_preset_id: "env-1",
      open_window: false,
      stream_mode: "both",
    });
    expect(mockBrowserExecuteAction).not.toHaveBeenCalled();
    expect(onProfileLaunched).toHaveBeenCalledWith("weibo_attach");
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已附着当前 Chrome：微博附着，并启动实时调试会话（环境：美区桌面）",
    });
  });

  it("附着当前 Chrome 资料在缺少桥接连接时应提示明确错误", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockLaunchBrowserSession.mockRejectedValueOnce(
      new Error(
        "当前资料使用“附着当前 Chrome”模式，但没有检测到可复用的浏览器会话",
      ),
    );
    const onMessage = vi.fn();

    const container = await renderManager({ onMessage });
    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("附着当前 Chrome"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    expect(mockBrowserExecuteAction).not.toHaveBeenCalled();
    expect(mockLaunchBrowserSession).toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith({
      type: "error",
      text: "启动资料失败: 没有检测到 profile_key=weibo_attach 的当前 Chrome 连接。请先在当前 Chrome 安装并连接 Lime Browser Bridge 扩展。",
    });
  });

  it("附着当前 Chrome 资料在 runtime attach 失败时应回退到扩展桥接", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-15T00:00:00Z",
        updated_at: "2026-03-15T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockLaunchBrowserSession.mockRejectedValueOnce(
      new Error(
        "当前资料使用“附着当前 Chrome”模式，但没有检测到可复用的浏览器会话",
      ),
    );
    mockGetChromeBridgeStatus.mockResolvedValue({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "weibo_attach",
          connected_at: "2026-03-15T00:00:00Z",
          user_agent: "Chrome",
          last_heartbeat_at: "2026-03-15T00:00:02Z",
          last_page_info: null,
        },
      ],
      controls: [],
      pending_commands: [],
    });
    const onMessage = vi.fn();
    const onProfileLaunched = vi.fn();

    const container = await renderManager({
      onMessage,
      onProfileLaunched,
    });
    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("附着当前 Chrome"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      launchButton?.click();
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).toHaveBeenCalledWith({
      profile_id: "profile-attach",
      environment_preset_id: undefined,
      open_window: false,
      stream_mode: "both",
    });
    expect(mockBrowserExecuteAction).toHaveBeenCalledWith({
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "navigate",
      args: {
        url: "https://weibo.com",
        wait_for_page_info: true,
      },
      timeout_ms: 30000,
    });
    expect(onProfileLaunched).toHaveBeenCalledWith("weibo_attach");
  });
});
