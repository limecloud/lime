import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserSiteAdapterPanel } from "./BrowserSiteAdapterPanel";

const {
  mockSiteListAdapters,
  mockSiteGetAdapterCatalogStatus,
  mockListBrowserProfiles,
  mockSiteRunAdapter,
  mockSiteSaveAdapterResult,
  mockListProjects,
  mockGetStoredResourceProjectId,
  mockSetStoredResourceProjectId,
  mockOnResourceProjectChange,
} = vi.hoisted(() => ({
  mockSiteListAdapters: vi.fn(),
  mockSiteGetAdapterCatalogStatus: vi.fn(),
  mockListBrowserProfiles: vi.fn(),
  mockSiteRunAdapter: vi.fn(),
  mockSiteSaveAdapterResult: vi.fn(),
  mockListProjects: vi.fn(),
  mockGetStoredResourceProjectId: vi.fn(),
  mockSetStoredResourceProjectId: vi.fn(),
  mockOnResourceProjectChange: vi.fn(),
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    siteListAdapters: mockSiteListAdapters,
    siteGetAdapterCatalogStatus: mockSiteGetAdapterCatalogStatus,
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
    saved_content: request.project_id
      ? {
          content_id: "content-auto-1",
          project_id: request.project_id,
          title: request.save_title || "站点采集 github/search 2026-03-25 12:00:00",
        }
      : undefined,
    saved_project_id: request.project_id,
    saved_by: request.project_id ? "explicit_project" : undefined,
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
      workspaceType: "knowledge",
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
    content_id: "content-1",
    project_id: request.project_id,
    title: request.save_title || "站点采集 github/search 2026-03-25 12:00:00",
  }));
  mockGetStoredResourceProjectId.mockReturnValue("project-2");
  mockSetStoredResourceProjectId.mockImplementation(() => undefined);
  mockOnResourceProjectChange.mockImplementation(() => () => undefined);
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
});
