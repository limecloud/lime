import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  attachExistingSessionProfile,
  buildMissingExistingSessionObserverError,
  findExistingSessionProfile,
  getExistingSessionBridgeStatus,
  loadExistingSessionAttachContext,
  listExistingSessionTabs,
  loadExistingSessionBridgeContext,
  switchExistingSessionTab,
} from "./existingSessionBridgeClient";

const {
  mockGetChromeBridgeStatus,
  mockBrowserExecuteAction,
  mockListBrowserProfiles,
} = vi.hoisted(() => ({
  mockGetChromeBridgeStatus: vi.fn(),
  mockBrowserExecuteAction: vi.fn(),
  mockListBrowserProfiles: vi.fn(),
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    getChromeBridgeStatus: mockGetChromeBridgeStatus,
    browserExecuteAction: mockBrowserExecuteAction,
    listBrowserProfiles: mockListBrowserProfiles,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("existingSessionBridgeClient", () => {
  it("应返回匹配 profile_key 的 observer 上下文", async () => {
    mockGetChromeBridgeStatus.mockResolvedValue({
      observer_count: 1,
      control_count: 0,
      pending_command_count: 0,
      observers: [
        {
          client_id: "observer-1",
          profile_key: "weibo_attach",
          connected_at: "2026-03-16T10:00:00Z",
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const context = await loadExistingSessionBridgeContext("weibo_attach");

    expect(context.observer?.client_id).toBe("observer-1");
    expect(context.bridgeStatus?.observer_count).toBe(1);
  });

  it("读取桥接状态失败时应回退为 null", async () => {
    mockGetChromeBridgeStatus.mockRejectedValue(new Error("offline"));

    await expect(getExistingSessionBridgeStatus()).resolves.toBeNull();
  });

  it("应返回当前附着资料与 observer 的统一上下文", async () => {
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
        created_at: "2026-03-16T10:00:00Z",
        updated_at: "2026-03-16T10:00:00Z",
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
          connected_at: "2026-03-16T10:00:00Z",
        },
      ],
      controls: [],
      pending_commands: [],
    });

    const context = await loadExistingSessionAttachContext("weibo_attach");

    expect(mockListBrowserProfiles).toHaveBeenCalledWith({
      include_archived: false,
    });
    expect(context.profile?.profile_key).toBe("weibo_attach");
    expect(context.observer?.client_id).toBe("observer-1");
  });

  it("应以 navigate 命令附着已有登录态页面", async () => {
    mockBrowserExecuteAction.mockResolvedValue({
      success: true,
      backend: "lime_extension_bridge",
      action: "navigate",
      request_id: "attach-1",
      attempts: [],
      data: {
        page_info: {
          title: "微博首页",
          url: "https://weibo.com/home",
          markdown: "# 微博首页",
          updated_at: "2026-03-16T10:00:00Z",
        },
      },
    });

    const pageInfo = await attachExistingSessionProfile({
      profile_key: "weibo_attach",
      launch_url: "https://weibo.com/home",
    });

    expect(mockBrowserExecuteAction).toHaveBeenCalledWith({
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "navigate",
      args: {
        url: "https://weibo.com/home",
        wait_for_page_info: true,
      },
      timeout_ms: 30000,
    });
    expect(pageInfo?.title).toBe("微博首页");
  });

  it("应统一 list_tabs 与 switch_tab 的桥接调用形状", async () => {
    mockBrowserExecuteAction
      .mockResolvedValueOnce({
        success: true,
        backend: "lime_extension_bridge",
        action: "list_tabs",
        request_id: "tabs-1",
        attempts: [],
        data: {
          data: {
            tabs: [
              {
                id: 202,
                index: 1,
                title: "创作页",
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
        request_id: "switch-1",
        attempts: [],
        data: {
          page_info: {
            title: "创作页",
            url: "https://weibo.com/compose",
            markdown: "# 创作页",
            updated_at: "2026-03-16T10:00:08Z",
          },
        },
      });

    await expect(listExistingSessionTabs("weibo_attach")).resolves.toEqual([
      {
        id: "202",
        index: 1,
        title: "创作页",
        url: "https://weibo.com/compose",
        active: false,
      },
    ]);
    await expect(
      switchExistingSessionTab("weibo_attach", "202"),
    ).resolves.toMatchObject({
      title: "创作页",
      updated_at: "2026-03-16T10:00:08Z",
    });

    expect(mockBrowserExecuteAction).toHaveBeenNthCalledWith(1, {
      profile_key: "weibo_attach",
      backend: "lime_extension_bridge",
      action: "list_tabs",
      args: undefined,
      timeout_ms: 30000,
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
  });

  it("应保留统一的缺失 observer 错误文案", () => {
    expect(
      buildMissingExistingSessionObserverError("weibo_attach").message,
    ).toContain("profile_key=weibo_attach");
  });

  it("应按 profile_key 匹配当前附着资料", () => {
    expect(
      findExistingSessionProfile(
        [
          {
            id: "profile-1",
            profile_key: "shop_us",
            name: "美区电商",
            description: "",
            site_scope: "",
            launch_url: "",
            transport_kind: "managed_cdp",
            profile_dir: "",
            managed_profile_dir: null,
            created_at: "2026-03-16T10:00:00Z",
            updated_at: "2026-03-16T10:00:00Z",
            last_used_at: null,
            archived_at: null,
          },
          {
            id: "profile-2",
            profile_key: "weibo_attach",
            name: "微博附着",
            description: "",
            site_scope: "",
            launch_url: "",
            transport_kind: "existing_session",
            profile_dir: "",
            managed_profile_dir: null,
            created_at: "2026-03-16T10:00:00Z",
            updated_at: "2026-03-16T10:00:00Z",
            last_used_at: null,
            archived_at: null,
          },
        ],
        "weibo_attach",
      )?.id,
    ).toBe("profile-2");
  });
});
