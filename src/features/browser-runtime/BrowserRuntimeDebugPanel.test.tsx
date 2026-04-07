import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRuntimeDebugPanel } from "./BrowserRuntimeDebugPanel";

const { mockUseBrowserRuntimeDebug } = vi.hoisted(() => ({
  mockUseBrowserRuntimeDebug: vi.fn(),
}));

const {
  mockGetBrowserRuntimeAuditLogs,
  mockListBrowserProfiles,
  mockGetChromeBridgeStatus,
  mockBrowserExecuteAction,
  mockSiteListAdapters,
  mockSiteRecommendAdapters,
  mockSiteGetAdapterCatalogStatus,
  mockSiteRunAdapter,
} = vi.hoisted(() => ({
  mockGetBrowserRuntimeAuditLogs: vi.fn(),
  mockListBrowserProfiles: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
  mockBrowserExecuteAction: vi.fn(),
  mockSiteListAdapters: vi.fn(),
  mockSiteRecommendAdapters: vi.fn(),
  mockSiteGetAdapterCatalogStatus: vi.fn(),
  mockSiteRunAdapter: vi.fn(),
}));

const defaultRuntimeState = {
  selectedSession: null,
  selectedProfileKey: "general_browser_assist",
  setSelectedProfileKey: vi.fn(),
  selectedTargetId: "",
  setSelectedTargetId: vi.fn(),
  targets: [],
  sessionState: null,
  latestFrame: null,
  latestFrameMetadata: null,
  consoleEvents: [],
  networkEvents: [],
  loadingTargets: false,
  openingSession: false,
  streaming: false,
  refreshingState: false,
  controlBusy: false,
  selectedProfileTransportKind: "managed_cdp",
  runtimeConnectionError: null,
  lifecycleState: null,
  isHumanControlling: false,
  isWaitingForHuman: false,
  isAgentResuming: false,
  isExistingSessionProfile: false,
  canDirectControl: false,
  refreshTargets: vi.fn(async () => undefined),
  openSession: vi.fn(async () => undefined),
  startStream: vi.fn(async () => undefined),
  stopStream: vi.fn(async () => undefined),
  closeSession: vi.fn(async () => undefined),
  refreshSessionState: vi.fn(async () => undefined),
  takeOverSession: vi.fn(async () => undefined),
  releaseSession: vi.fn(async () => undefined),
  resumeSession: vi.fn(async () => undefined),
  clickAt: vi.fn(async () => undefined),
  scrollPage: vi.fn(async () => undefined),
  typeIntoFocusedElement: vi.fn(async () => undefined),
};

vi.mock("./useBrowserRuntimeDebug", () => ({
  useBrowserRuntimeDebug: mockUseBrowserRuntimeDebug,
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    getBrowserRuntimeAuditLogs: mockGetBrowserRuntimeAuditLogs,
    listBrowserProfiles: mockListBrowserProfiles,
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    browserExecuteAction: mockBrowserExecuteAction,
    siteListAdapters: mockSiteListAdapters,
    siteRecommendAdapters: mockSiteRecommendAdapters,
    siteGetAdapterCatalogStatus: mockSiteGetAdapterCatalogStatus,
    siteRunAdapter: mockSiteRunAdapter,
    openBrowserRuntimeDebuggerWindow: vi.fn(async () => undefined),
    reopenProfileWindow: vi.fn(async () => undefined),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockUseBrowserRuntimeDebug.mockReturnValue({
    ...defaultRuntimeState,
  });
  mockGetBrowserRuntimeAuditLogs.mockResolvedValue([]);
  mockListBrowserProfiles.mockResolvedValue([]);
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
    action: "read_page",
    request_id: "browser-attach-default",
    attempts: [],
    data: {
      page_info: {
        title: "默认页面",
        url: "https://example.com/default",
        markdown: "# 默认页面",
        updated_at: "2026-03-16T10:00:00Z",
      },
    },
  });
  mockSiteListAdapters.mockResolvedValue([
    {
      name: "github/search",
      domain: "github.com",
      description: "按关键词采集 GitHub 仓库搜索结果。",
      read_only: true,
      capabilities: ["search", "repository"],
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["query"],
      },
      example_args: {
        query: "model context protocol",
        limit: 5,
      },
      example: 'github/search {"query":"model context protocol","limit":5}',
      auth_hint: "若需要完整结果，请先在浏览器中登录 GitHub。",
    },
  ]);
  mockSiteRecommendAdapters.mockResolvedValue([
    {
      adapter: {
        name: "github/search",
        domain: "github.com",
        description: "按关键词采集 GitHub 仓库搜索结果。",
        read_only: true,
        capabilities: ["search", "repository", "research"],
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
          },
          required: ["query"],
        },
        example_args: {
          query: "model context protocol",
          limit: 5,
        },
        example: 'github/search {"query":"model context protocol","limit":5}',
        auth_hint: "若需要完整结果，请先在浏览器中登录 GitHub。",
      },
      reason:
        "已检测到资料 general_browser_assist 当前停留在 github.com，可直接复用已连接的浏览器上下文。",
      profile_key: "general_browser_assist",
      target_id: "mock-target-1",
      entry_url:
        "https://github.com/search?q=model%20context%20protocol&type=repositories",
      score: 100,
    },
  ]);
  mockSiteGetAdapterCatalogStatus.mockResolvedValue({
    exists: false,
    source_kind: "server_synced",
    registry_version: 1,
    catalog_version: "test-catalog",
    tenant_id: "local-test",
    synced_at: "2026-03-16T10:00:00Z",
    adapter_count: 1,
  });
  mockSiteRunAdapter.mockResolvedValue({
    ok: true,
    adapter: "github/search",
    domain: "github.com",
    profile_key: "general_browser_assist",
    session_id: "mock-cdp-session",
    target_id: "mock-target-1",
    entry_url:
      "https://github.com/search?q=model%20context%20protocol&type=repositories",
    source_url:
      "https://github.com/search?q=model%20context%20protocol&type=repositories",
    data: {
      items: [{ title: "mock repo", url: "https://github.com/mock/repo" }],
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

async function renderPanel(props?: {
  initialProfileKey?: string;
  initialSessionId?: string;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(
      <BrowserRuntimeDebugPanel
        sessions={[]}
        initialProfileKey={props?.initialProfileKey ?? "general_browser_assist"}
        initialSessionId={props?.initialSessionId ?? "browser-session-1"}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

async function flushPanelEffects(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("BrowserRuntimeDebugPanel", () => {
  it("存在初始附着会话时不应因空 session 列表而退回占位提示", async () => {
    const container = await renderPanel();
    expect(container.textContent).toContain("浏览器实时会话");
    expect(container.textContent).toContain("正在连接浏览器会话");
    expect(container.textContent).not.toContain(
      "还没有运行中的独立 Chrome Profile",
    );
  });

  it("启动浏览器时应展示明确的加载提示", async () => {
    mockUseBrowserRuntimeDebug.mockReturnValue({
      ...defaultRuntimeState,
      openingSession: true,
      refreshingState: false,
    });

    const container = await renderPanel();

    expect(container.textContent).toContain("正在启动 Chrome、连接调试通道");
    expect(container.textContent).toContain("通常需要 3–8 秒");
  });

  it("展开高级调试后应展示最近启动与动作审计", async () => {
    mockGetBrowserRuntimeAuditLogs.mockResolvedValue([
      {
        id: "audit-launch-1",
        created_at: "2026-03-15T10:00:00Z",
        kind: "launch",
        profile_key: "general_browser_assist",
        profile_id: "browser-profile-1",
        success: true,
        url: "https://example.com",
        environment_preset_name: "美区桌面",
        reused: false,
        open_window: true,
        stream_mode: "both",
        browser_source: "system",
        remote_debugging_port: 13001,
      },
      {
        id: "audit-action-1",
        created_at: "2026-03-15T10:00:03Z",
        kind: "action",
        action: "navigate",
        profile_key: "general_browser_assist",
        success: true,
        attempts: [
          {
            backend: "aster_compat",
            success: true,
            message: "执行成功",
          },
        ],
      },
    ]);

    const container = await renderPanel();
    const toggleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("高级调试"),
    );

    expect(toggleButton).toBeTruthy();

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockGetBrowserRuntimeAuditLogs).toHaveBeenCalledWith(16);
    expect(container.textContent).toContain("最近启动与动作审计");
    expect(container.textContent).toContain("启动成功");
    expect(container.textContent).toContain("美区桌面");
    expect(container.textContent).toContain("动作 · navigate");
  }, 10000);

  it("高级调试中应支持执行站点命令", async () => {
    const container = await renderPanel();
    const toggleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("高级调试"),
    );

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPanelEffects();

    expect(container.textContent).toContain("站点命令调试");
    expect(container.textContent).toContain("github/search");

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushPanelEffects();

    expect(mockSiteRunAdapter).toHaveBeenCalledWith({
      adapter_name: "github/search",
      args: {
        query: "model context protocol",
        limit: 5,
      },
      profile_key: "general_browser_assist",
    });
    expect(container.textContent).toContain("执行成功");
    expect(container.textContent).toContain("mock repo");
  });

  it("无 CDP 会话但存在附着资料时应展示附着当前 Chrome 调试面板", async () => {
    mockUseBrowserRuntimeDebug.mockReturnValue({
      ...defaultRuntimeState,
      selectedProfileKey: "weibo_attach",
    });
    mockListBrowserProfiles.mockResolvedValue([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com/home",
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
          last_heartbeat_at: "2026-03-15T00:00:08Z",
          last_page_info: {
            title: "微博首页",
            url: "https://weibo.com/home",
            markdown: "# 微博首页",
            updated_at: "2026-03-15T00:00:08Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const container = await renderPanel({
      initialProfileKey: "weibo_attach",
      initialSessionId: undefined,
    });
    const toggleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("高级调试"),
    );

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("附着当前 Chrome");
    expect(container.textContent).toContain("微博附着");
    expect(container.textContent).toContain("微博首页");
    expect(container.textContent).toContain("当前窗口标签页");
  });

  it("existing_session 正在切到 runtime 会话时不应回退附着面板", async () => {
    mockUseBrowserRuntimeDebug.mockReturnValue({
      ...defaultRuntimeState,
      selectedProfileKey: "weibo_attach",
      selectedSession: {
        profile_key: "weibo_attach",
        browser_source: "system",
        browser_path: "",
        profile_dir: "",
        remote_debugging_port: 16666,
        pid: 0,
        started_at: "2026-03-15T00:00:00Z",
        last_url: "https://weibo.com/home",
      },
      openingSession: true,
      selectedProfileTransportKind: "existing_session",
      isExistingSessionProfile: true,
    });
    mockListBrowserProfiles.mockResolvedValue([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com/home",
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
          last_heartbeat_at: "2026-03-15T00:00:08Z",
          last_page_info: {
            title: "微博首页",
            url: "https://weibo.com/home",
            markdown: "# 微博首页",
            updated_at: "2026-03-15T00:00:08Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const container = await renderPanel({
      initialProfileKey: "weibo_attach",
      initialSessionId: undefined,
    });

    expect(container.textContent).toContain("正在启动 Chrome、连接调试通道");
    expect(container.textContent).not.toContain("当前窗口标签页");
    expect(container.textContent).not.toContain("附着当前 Chrome");
  });

  it("附着模式应支持读取并切换当前 Chrome 标签页", async () => {
    const onMessage = vi.fn();
    mockUseBrowserRuntimeDebug.mockReturnValue({
      ...defaultRuntimeState,
      selectedProfileKey: "weibo_attach",
    });
    mockListBrowserProfiles.mockResolvedValue([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com/home",
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
      })
      .mockResolvedValue({
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

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    await act(async () => {
      root.render(
        <BrowserRuntimeDebugPanel
          sessions={[]}
          initialProfileKey="weibo_attach"
          onMessage={onMessage}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    const toggleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("高级调试"),
    );

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const loadTabsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("读取标签页"));

    await act(async () => {
      loadTabsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockBrowserExecuteAction).toHaveBeenNthCalledWith(1, {
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "list_tabs",
      timeout_ms: 30000,
    });
    expect(container.textContent).toContain("微博创作中心");

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("切换到此页"),
    );

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
    expect(container.textContent).toContain("微博创作中心");
    expect(container.textContent).toContain("https://weibo.com/compose");
  });

  it("附着模式不应让较旧的 read_page 结果覆盖较新的切页结果", async () => {
    const deferredReadPage = createDeferredPromise<{
      success: boolean;
      backend: string;
      action: string;
      request_id: string;
      attempts: unknown[];
      data: {
        page_info: {
          title: string;
          url: string;
          markdown: string;
          updated_at: string;
        };
      };
    }>();

    mockUseBrowserRuntimeDebug.mockReturnValue({
      ...defaultRuntimeState,
      selectedProfileKey: "weibo_attach",
    });
    mockListBrowserProfiles.mockResolvedValue([
      {
        id: "profile-attach",
        profile_key: "weibo_attach",
        name: "微博附着",
        description: "复用当前 Chrome",
        site_scope: "weibo.com",
        launch_url: "https://weibo.com/home",
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
          last_heartbeat_at: "2026-03-15T00:00:06Z",
          last_page_info: {
            title: "初始页面",
            url: "https://weibo.com/home",
            markdown: "# 初始页面",
            updated_at: "2026-03-15T00:00:05Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });
    mockBrowserExecuteAction
      .mockImplementationOnce(() => deferredReadPage.promise)
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "list_tabs",
        request_id: "browser-tabs-race-1",
        attempts: [],
        data: {
          data: {
            tabs: [
              {
                id: 101,
                index: 0,
                title: "原页面标签",
                url: "https://weibo.com/home",
                active: true,
              },
              {
                id: 202,
                index: 1,
                title: "目标标签",
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
        request_id: "browser-switch-race-1",
        attempts: [],
        data: {
          page_info: {
            title: "切换后页面",
            url: "https://weibo.com/compose",
            markdown: "# 切换后页面",
            updated_at: "2026-03-15T00:00:08Z",
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "list_tabs",
        request_id: "browser-tabs-race-2",
        attempts: [],
        data: {
          data: {
            tabs: [
              {
                id: 101,
                index: 0,
                title: "原页面标签",
                url: "https://weibo.com/home",
                active: false,
              },
              {
                id: 202,
                index: 1,
                title: "目标标签",
                url: "https://weibo.com/compose",
                active: true,
              },
            ],
          },
        },
      });

    const container = await renderPanel({
      initialProfileKey: "weibo_attach",
      initialSessionId: undefined,
    });
    const toggleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("高级调试"),
    );

    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const loadPageButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("读取当前页面"));

    await act(async () => {
      loadPageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const loadTabsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("读取标签页"));

    await act(async () => {
      loadTabsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("切换到此页"),
    );

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("切换后页面");
    expect(container.textContent).not.toContain("过期页面");

    await act(async () => {
      deferredReadPage.resolve({
        success: true,
        backend: "lime_extension_bridge",
        action: "read_page",
        request_id: "browser-read-race-1",
        attempts: [],
        data: {
          page_info: {
            title: "过期页面",
            url: "https://weibo.com/stale",
            markdown: "# 过期页面",
            updated_at: "2026-03-15T00:00:06Z",
          },
        },
      });
      await deferredReadPage.promise;
      await Promise.resolve();
    });

    expect(container.textContent).toContain("切换后页面");
    expect(container.textContent).not.toContain("过期页面");
  });
});
