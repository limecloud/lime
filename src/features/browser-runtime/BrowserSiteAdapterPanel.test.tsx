import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSiteAdapterPanel } from "./BrowserSiteAdapterPanel";

const {
  mockSiteListAdapters,
  mockSiteRecommendAdapters,
  mockSiteGetAdapterCatalogStatus,
  mockGetChromeBridgeStatus,
  mockListBrowserProfiles,
  mockSiteRunAdapter,
  mockSiteSaveAdapterResult,
  mockListProjects,
  mockGetStoredResourceProjectId,
  mockSetStoredResourceProjectId,
  mockOnResourceProjectChange,
  mockSubscribeSiteAdapterCatalogChanged,
} = vi.hoisted(() => ({
  mockSiteListAdapters: vi.fn(),
  mockSiteRecommendAdapters: vi.fn(),
  mockSiteGetAdapterCatalogStatus: vi.fn(),
  mockGetChromeBridgeStatus: vi.fn(),
  mockListBrowserProfiles: vi.fn(),
  mockSiteRunAdapter: vi.fn(),
  mockSiteSaveAdapterResult: vi.fn(),
  mockListProjects: vi.fn(),
  mockGetStoredResourceProjectId: vi.fn(),
  mockSetStoredResourceProjectId: vi.fn(),
  mockOnResourceProjectChange: vi.fn(),
  mockSubscribeSiteAdapterCatalogChanged: vi.fn(),
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    siteListAdapters: mockSiteListAdapters,
    siteRecommendAdapters: mockSiteRecommendAdapters,
    siteGetAdapterCatalogStatus: mockSiteGetAdapterCatalogStatus,
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    listBrowserProfiles: mockListBrowserProfiles,
    siteRunAdapter: mockSiteRunAdapter,
    siteSaveAdapterResult: mockSiteSaveAdapterResult,
  },
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: mockListProjects,
}));

vi.mock("@/lib/resourceProjectSelection", () => ({
  getStoredResourceProjectId: mockGetStoredResourceProjectId,
  setStoredResourceProjectId: mockSetStoredResourceProjectId,
  onResourceProjectChange: mockOnResourceProjectChange,
}));

vi.mock("@/lib/siteAdapterCatalogBootstrap", () => ({
  subscribeSiteAdapterCatalogChanged: mockSubscribeSiteAdapterCatalogChanged,
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

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
        "已检测到资料 通用浏览器资料 当前停留在 github.com，可直接复用已连接的 Chrome 上下文。",
      profile_key: "general_browser_assist",
      target_id: "mock-target-1",
      entry_url:
        "https://github.com/search?q=model%20context%20protocol&type=repositories",
      score: 100,
    },
  ]);
  mockSiteGetAdapterCatalogStatus.mockResolvedValue({
    exists: true,
    source_kind: "server_synced",
    registry_version: 3,
    directory: "/tmp/site-adapters/server-synced",
    catalog_version: "tenant-sync-1",
    tenant_id: "tenant-demo",
    synced_at: "2026-03-25T12:00:00.000Z",
    adapter_count: 1,
  });
  mockListBrowserProfiles.mockResolvedValue([
    {
      id: "profile-1",
      profile_key: "general_browser_assist",
      name: "通用浏览器资料",
      description: "默认资料",
      site_scope: "github.com",
      launch_url: "https://github.com",
      transport_kind: "managed_cdp",
      profile_dir: "/tmp/profile",
      managed_profile_dir: "/tmp/managed-profile",
      created_at: "2026-03-24T00:00:00Z",
      updated_at: "2026-03-24T00:00:00Z",
      last_used_at: null,
      archived_at: null,
    },
  ]);
  mockGetChromeBridgeStatus.mockResolvedValue({
    observer_count: 0,
    control_count: 0,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
  });
  mockSiteRunAdapter.mockImplementation(async (request) => ({
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
    saved_content:
      request.content_id || request.project_id
        ? {
            content_id: request.content_id || "content-auto-1",
            project_id: request.project_id || "project-1",
            title: request.content_id
              ? "当前主稿"
              : request.save_title ||
                "站点采集 github/search 2026-03-25 12:00:00",
          }
        : undefined,
    saved_project_id:
      request.project_id || (request.content_id ? "project-1" : undefined),
    saved_by: request.content_id
      ? "explicit_content"
      : request.project_id
        ? "explicit_project"
        : undefined,
  }));
  mockListProjects.mockResolvedValue([
    {
      id: "project-1",
      name: "默认项目",
      workspaceType: "general",
      rootPath: "/tmp/project-1",
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
      isFavorite: false,
      isArchived: false,
      tags: [],
    },
    {
      id: "project-2",
      name: "竞品情报",
      workspaceType: "general",
      rootPath: "/tmp/project-2",
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
      isFavorite: false,
      isArchived: false,
      tags: [],
    },
  ]);
  mockSiteSaveAdapterResult.mockImplementation(async (request) => ({
    content_id: request.content_id || "content-1",
    project_id: request.project_id || "project-1",
    title: request.content_id
      ? "当前主稿"
      : request.save_title || "站点采集 github/search 2026-03-25 12:00:00",
  }));
  mockGetStoredResourceProjectId.mockReturnValue("project-2");
  mockSetStoredResourceProjectId.mockImplementation(() => undefined);
  mockOnResourceProjectChange.mockImplementation(() => () => undefined);
  mockSubscribeSiteAdapterCatalogChanged.mockImplementation(() => vi.fn());
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

async function renderPanel(
  props?: Partial<React.ComponentProps<typeof BrowserSiteAdapterPanel>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(
      <BrowserSiteAdapterPanel
        selectedProfileKey="general_browser_assist"
        variant="workspace"
        {...props}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe("BrowserSiteAdapterPanel", () => {
  it("工作台模式应支持把站点结果保存到资源项目", async () => {
    const onMessage = vi.fn();
    const onNavigate = vi.fn();
    const container = await renderPanel({ onMessage, onNavigate });

    expect(container.textContent).toContain("站点采集工作台");
    expect(container.textContent).toContain("竞品情报");
    expect(container.textContent).toContain("目录来源：服务端同步");
    expect(container.textContent).toContain("目录版本：tenant-sync-1");
    expect(container.textContent).toContain("租户：tenant-demo");
    expect(container.textContent).toContain("生效适配器：1");
    expect(container.textContent).toContain("服务端目录项：1");
    expect(container.textContent).toContain("推荐适配器");
    expect(container.textContent).toContain("已匹配标签页");

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("执行成功");
    expect(container.textContent).toContain("返回 1 条结构化记录");
    expect(mockSiteRunAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter_name: "github/search",
        profile_key: "general_browser_assist",
        project_id: "project-2",
        save_title: "站点采集 github/search · model context protocol",
        args: expect.objectContaining({
          query: "model context protocol",
          limit: 5,
        }),
      }),
    );
    expect(mockSiteSaveAdapterResult).not.toHaveBeenCalled();
    expect(mockSetStoredResourceProjectId).toHaveBeenCalledWith("project-2", {
      source: "browser-runtime",
      emitEvent: true,
    });
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      type: "success",
      text: "站点命令 github/search 执行完成，已保存到资源项目：竞品情报",
    });
    expect(container.textContent).toContain(
      "已保存：站点采集 github/search · model context protocol · 竞品情报",
    );

    const openSavedContentButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("打开已保存内容"));
    expect(openSavedContentButton).toBeTruthy();

    await act(async () => {
      openSavedContentButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      projectId: "project-2",
      contentId: "content-auto-1",
      lockTheme: true,
      fromResources: true,
    });

    const saveTitleInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "留空则自动生成标题",
    );
    expect(saveTitleInput).toBeTruthy();
    expect(saveTitleInput).toBeInstanceOf(HTMLInputElement);
    expect((saveTitleInput as HTMLInputElement).value).toBe(
      "站点采集 github/search · model context protocol",
    );

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("结果文档"),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      if (saveTitleInput instanceof HTMLInputElement) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        expect(valueSetter).toBeTypeOf("function");
        valueSetter?.call(saveTitleInput, "GitHub MCP 自定义标题");
        saveTitleInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await Promise.resolve();
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSiteSaveAdapterResult).toHaveBeenCalledTimes(1);
    expect(mockSiteSaveAdapterResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        project_id: "project-2",
        save_title: "GitHub MCP 自定义标题",
        run_request: expect.objectContaining({
          adapter_name: "github/search",
          profile_key: "general_browser_assist",
          args: expect.objectContaining({
            query: "model context protocol",
            limit: 5,
          }),
        }),
        result: expect.objectContaining({
          adapter: "github/search",
          profile_key: "general_browser_assist",
        }),
      }),
    );
    expect(onMessage).toHaveBeenNthCalledWith(2, {
      type: "success",
      text: "已保存站点结果到资源项目：竞品情报",
    });
    expect(container.textContent).toContain("已保存：GitHub MCP 自定义标题");
  });

  it("未显式指定 profile_key 时应优先选择已连接的 existing_session 资料", async () => {
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-attach",
        profile_key: "research_attach",
        name: "研究附着资料",
        description: "当前 Chrome",
        site_scope: null,
        launch_url: "https://github.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
      {
        id: "profile-1",
        profile_key: "general_browser_assist",
        name: "通用浏览器资料",
        description: "默认资料",
        site_scope: "github.com",
        launch_url: "https://github.com",
        transport_kind: "managed_cdp",
        profile_dir: "/tmp/profile",
        managed_profile_dir: "/tmp/managed-profile",
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockGetChromeBridgeStatus.mockResolvedValueOnce({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "research_attach",
          connected_at: "2026-03-24T00:00:00Z",
          user_agent: "Chrome",
          last_heartbeat_at: "2026-03-24T00:00:01Z",
          last_page_info: {
            title: "GitHub",
            url: "https://github.com/trending",
            markdown: "GitHub",
            updated_at: "2026-03-24T00:00:01Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const container = await renderPanel({ selectedProfileKey: undefined });
    expect(container.textContent).toContain("当前将使用：research_attach");
    expect(container.textContent).toContain("已优先选择：");
    expect(container.textContent).toContain("研究附着资料");
    expect(container.textContent).toContain("模式：existing_session");

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_key: "research_attach",
      }),
    );
  });

  it("点击推荐适配器后应切换当前适配器与推荐资料", async () => {
    mockSiteListAdapters.mockResolvedValueOnce([
      {
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
      {
        name: "zhihu/search",
        domain: "www.zhihu.com",
        description: "按关键词采集知乎搜索结果。",
        read_only: true,
        capabilities: ["search", "research"],
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
          },
          required: ["query"],
        },
        example_args: {
          query: "AI Agent",
          limit: 5,
        },
        example: 'zhihu/search {"query":"AI Agent","limit":5}',
        auth_hint: "请先在浏览器中登录知乎，再重试该命令。",
      },
    ]);
    mockSiteRecommendAdapters.mockResolvedValueOnce([
      {
        adapter: {
          name: "zhihu/search",
          domain: "www.zhihu.com",
          description: "按关键词采集知乎搜索结果。",
          read_only: true,
          capabilities: ["search", "research"],
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string" },
              limit: { type: "integer" },
            },
            required: ["query"],
          },
          example_args: {
            query: "AI Agent",
            limit: 5,
          },
          example: 'zhihu/search {"query":"AI Agent","limit":5}',
          auth_hint: "请先在浏览器中登录知乎，再重试该命令。",
        },
        reason:
          "资料 知乎附着资料 已绑定站点范围 www.zhihu.com，可优先作为该适配器的执行上下文。",
        profile_key: "zhihu_attach",
        target_id: undefined,
        entry_url: "https://www.zhihu.com/search?type=content&q=AI%20Agent",
        score: 75,
      },
    ]);
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-1",
        profile_key: "general_browser_assist",
        name: "通用浏览器资料",
        description: "默认资料",
        site_scope: "github.com",
        launch_url: "https://github.com",
        transport_kind: "managed_cdp",
        profile_dir: "/tmp/profile",
        managed_profile_dir: "/tmp/managed-profile",
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
      {
        id: "profile-2",
        profile_key: "zhihu_attach",
        name: "知乎附着资料",
        description: "知乎登录态",
        site_scope: "www.zhihu.com",
        launch_url: "https://www.zhihu.com",
        transport_kind: "existing_session",
        profile_dir: "",
        managed_profile_dir: null,
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);

    const container = await renderPanel();

    const recommendButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("zhihu/search"));
    expect(recommendButton).toBeTruthy();

    await act(async () => {
      recommendButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    const adapterSelect = container.querySelector("select");
    expect(adapterSelect).toBeInstanceOf(HTMLSelectElement);
    expect((adapterSelect as HTMLSelectElement).value).toBe("zhihu/search");
    expect(container.textContent).toContain("当前将使用：zhihu_attach");
    expect(container.textContent).toContain("资料 知乎附着资料");
  });

  it("目录变更事件后应自动刷新站点目录与推荐状态", async () => {
    const container = await renderPanel();

    expect(mockSiteListAdapters).toHaveBeenCalledTimes(1);
    expect(mockSiteGetAdapterCatalogStatus).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("生效适配器：1");

    mockSiteListAdapters.mockResolvedValueOnce([
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
      {
        name: "zhihu/search",
        domain: "www.zhihu.com",
        description: "按关键词采集知乎搜索结果。",
        read_only: true,
        capabilities: ["search", "research"],
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        example_args: {
          query: "AI Agent",
        },
        example: 'zhihu/search {"query":"AI Agent"}',
        auth_hint: "请先在浏览器中登录知乎，再重试该命令。",
      },
    ]);
    mockSiteRecommendAdapters.mockResolvedValueOnce([
      {
        adapter: {
          name: "zhihu/search",
          domain: "www.zhihu.com",
          description: "按关键词采集知乎搜索结果。",
          read_only: true,
          capabilities: ["search", "research"],
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
          example_args: {
            query: "AI Agent",
          },
          example: 'zhihu/search {"query":"AI Agent"}',
          auth_hint: "请先在浏览器中登录知乎，再重试该命令。",
        },
        reason: "服务端目录已刷新，可新增知乎脚本。",
        profile_key: "general_browser_assist",
        target_id: "mock-target-2",
        entry_url: "https://www.zhihu.com/search?type=content&q=AI%20Agent",
        score: 98,
      },
    ]);
    mockSiteGetAdapterCatalogStatus.mockResolvedValueOnce({
      exists: true,
      source_kind: "server_synced",
      registry_version: 4,
      directory: "/tmp/site-adapters/server-synced",
      catalog_version: "tenant-sync-2",
      tenant_id: "tenant-demo",
      synced_at: "2026-03-26T12:00:00.000Z",
      adapter_count: 2,
    });
    mockListBrowserProfiles.mockResolvedValueOnce([
      {
        id: "profile-1",
        profile_key: "general_browser_assist",
        name: "通用浏览器资料",
        description: "默认资料",
        site_scope: "github.com",
        launch_url: "https://github.com",
        transport_kind: "managed_cdp",
        profile_dir: "/tmp/profile",
        managed_profile_dir: "/tmp/managed-profile",
        created_at: "2026-03-24T00:00:00Z",
        updated_at: "2026-03-24T00:00:00Z",
        last_used_at: null,
        archived_at: null,
      },
    ]);
    mockGetChromeBridgeStatus.mockResolvedValueOnce({
      observer_count: 0,
      control_count: 0,
      pending_command_count: 0,
      observers: [],
      controls: [],
      pending_commands: [],
    });

    const changedListener =
      mockSubscribeSiteAdapterCatalogChanged.mock.calls[0]?.[0];
    expect(changedListener).toBeTypeOf("function");

    await act(async () => {
      changedListener?.({
        exists: true,
        source_kind: "server_synced",
        adapter_count: 2,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSiteListAdapters).toHaveBeenCalledTimes(2);
    expect(mockSiteGetAdapterCatalogStatus).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("目录版本：tenant-sync-2");
    expect(container.textContent).toContain("生效适配器：2");
    expect(container.textContent).toContain("zhihu/search");
  });

  it("站点不可达时应展示错误码与恢复建议", async () => {
    mockSiteRunAdapter.mockResolvedValueOnce({
      ok: false,
      adapter: "github/search",
      domain: "github.com",
      profile_key: "general_browser_assist",
      session_id: "mock-cdp-session",
      target_id: "mock-target-1",
      entry_url:
        "https://github.com/search?q=model%20context%20protocol&type=repositories",
      error_code: "site_unreachable",
      error_message: "导航站点失败: CDP 命令超时: Page.navigate",
      report_hint:
        "目标站点可能加载较慢、发生重定向，或当前网络暂时不可达；请先确认入口 URL 能正常打开，必要时增大 timeout_ms 后重试。",
    });

    const container = await renderPanel();
    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("执行失败");
    expect(container.textContent).toContain("错误码：site_unreachable");
    expect(container.textContent).toContain(
      "导航站点失败: CDP 命令超时: Page.navigate",
    );
    expect(container.textContent).toContain("建议：");
    expect(container.textContent).toContain("timeout_ms");
  });

  it("带初始站点脚本参数进入时应自动预填并执行", async () => {
    const onMessage = vi.fn();
    const container = await renderPanel({
      onMessage,
      currentProjectId: "project-1",
      currentContentId: "content-launch-1",
      initialAdapterName: "github/search",
      initialArgs: {
        query: "browser assist mcp",
        limit: 10,
      },
      initialAutoRun: true,
      initialSaveTitle: "GitHub 仓库线索 · browser assist mcp",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter_name: "github/search",
        content_id: "content-launch-1",
        project_id: undefined,
        save_title: undefined,
        args: {
          query: "browser assist mcp",
          limit: 10,
        },
      }),
    );
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "站点命令 github/search 执行完成，已写回当前主稿",
    });
    expect(container.textContent).toContain("执行成功");

    const argsTextarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(argsTextarea?.value).toContain("browser assist mcp");
  });

  it("要求附着会话且未连接当前 Chrome 时应阻止自动执行", async () => {
    mockGetChromeBridgeStatus.mockResolvedValueOnce({
      observer_count: 0,
      control_count: 0,
      pending_command_count: 0,
      observers: [],
      controls: [],
      pending_commands: [],
    });

    const onMessage = vi.fn();
    const container = await renderPanel({
      onMessage,
      currentProjectId: "project-1",
      currentContentId: "content-launch-1",
      initialAdapterName: "github/search",
      initialArgs: {
        query: "browser assist mcp",
        limit: 10,
      },
      initialAutoRun: true,
      initialRequireAttachedSession: true,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "当前技能要求附着会话；如果还没连接当前 Chrome，自动执行会被阻止。",
    );
    expect(container.textContent).toContain(
      "当前技能要求复用已附着的 Chrome 会话，请先连接当前 Chrome 并保持目标站点登录态。",
    );
    expect(onMessage).toHaveBeenCalledWith({
      type: "error",
      text: "当前技能要求复用已附着的 Chrome 会话，请先连接当前 Chrome 并保持目标站点登录态。",
    });
  });

  it("要求附着会话时应忽略托管资料并交给后端自动选择已连接会话", async () => {
    mockGetChromeBridgeStatus.mockResolvedValueOnce({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "observer-only",
          connected_at: "2026-03-24T00:00:00Z",
          user_agent: "Chrome",
          last_heartbeat_at: "2026-03-24T00:00:01Z",
          last_page_info: {
            title: "GitHub",
            url: "https://github.com/trending",
            markdown: "GitHub",
            updated_at: "2026-03-24T00:00:01Z",
          },
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const container = await renderPanel({
      initialRequireAttachedSession: true,
    });

    expect(container.textContent).toContain("当前将使用：自动选择已连接会话");

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter_name: "github/search",
        profile_key: undefined,
      }),
    );
  });

  it("存在当前 contentId 时应优先写回当前主稿", async () => {
    const onMessage = vi.fn();
    const onNavigate = vi.fn();
    const container = await renderPanel({
      onMessage,
      onNavigate,
      currentProjectId: "project-1",
      currentContentId: "content-current-1",
    });

    expect(container.textContent).toContain("写回当前主稿");
    expect(container.textContent).toContain("内容 ID：content-current-1");

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("执行站点命令"),
    );
    expect(runButton).toBeTruthy();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        adapter_name: "github/search",
        content_id: "content-current-1",
        project_id: undefined,
        save_title: undefined,
      }),
    );
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "站点命令 github/search 执行完成，已写回当前主稿",
    });
    expect(container.textContent).toContain("已写回：当前主稿 · 当前主稿");

    const rewriteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("再次写回当前主稿"),
    );
    expect(rewriteButton).toBeTruthy();

    await act(async () => {
      rewriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockSiteSaveAdapterResult).toHaveBeenCalledWith(
      expect.objectContaining({
        content_id: "content-current-1",
        project_id: undefined,
      }),
    );
    expect(onMessage).toHaveBeenLastCalledWith({
      type: "success",
      text: "已写回当前主稿",
    });

    const openCurrentContentButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("打开当前主稿"));
    expect(openCurrentContentButton).toBeTruthy();

    await act(async () => {
      openCurrentContentButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenCalledWith("agent", {
      projectId: "project-1",
      contentId: "content-current-1",
      lockTheme: true,
      fromResources: false,
    });
  });
});
