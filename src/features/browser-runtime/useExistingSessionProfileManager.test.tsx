import { useEffect } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserProfileRecord,
  ChromeBridgeObserverSnapshot,
  ChromeBridgePageInfo,
  ChromeBridgeStatusSnapshot,
} from "@/lib/webview-api";
import {
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import type { ExistingSessionTabRecord } from "./existingSessionBridge";
import { useExistingSessionProfileManager } from "./useExistingSessionProfileManager";

const {
  mockAttachExistingSessionProfile,
  mockGetExistingSessionBridgeStatus,
  mockListExistingSessionTabs,
  mockLoadExistingSessionBridgeContext,
  mockSwitchExistingSessionTab,
} = vi.hoisted(() => ({
  mockAttachExistingSessionProfile: vi.fn(),
  mockGetExistingSessionBridgeStatus: vi.fn(),
  mockListExistingSessionTabs: vi.fn(),
  mockLoadExistingSessionBridgeContext: vi.fn(),
  mockSwitchExistingSessionTab: vi.fn(),
}));

vi.mock("./existingSessionBridgeClient", async () => {
  const actual = await vi.importActual<
    typeof import("./existingSessionBridgeClient")
  >("./existingSessionBridgeClient");
  return {
    ...actual,
    attachExistingSessionProfile: mockAttachExistingSessionProfile,
    getExistingSessionBridgeStatus: mockGetExistingSessionBridgeStatus,
    listExistingSessionTabs: mockListExistingSessionTabs,
    loadExistingSessionBridgeContext: mockLoadExistingSessionBridgeContext,
    switchExistingSessionTab: mockSwitchExistingSessionTab,
  };
});

const ATTACH_PROFILE: BrowserProfileRecord = {
  id: "profile-attach",
  profile_key: "weibo_attach",
  name: "微博附着",
  description: "复用当前 Chrome",
  site_scope: "weibo.com",
  launch_url: "https://weibo.com/home",
  transport_kind: "existing_session",
  profile_dir: "",
  managed_profile_dir: null,
  created_at: "2026-03-16T00:00:00Z",
  updated_at: "2026-03-16T00:00:00Z",
  last_used_at: null,
  archived_at: null,
};

const COMPOSE_TAB: ExistingSessionTabRecord = {
  id: "202",
  index: 1,
  title: "微博创作中心",
  url: "https://weibo.com/compose",
  active: false,
};

type HookHarnessProps = {
  profiles?: BrowserProfileRecord[];
  existingSessionEnvironmentNotice?: string | null;
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  onProfileLaunched?: (profileKey: string) => void;
  onReady: (
    manager: ReturnType<typeof useExistingSessionProfileManager>,
  ) => void;
};

function HookHarness(props: HookHarnessProps) {
  const manager = useExistingSessionProfileManager({
    profiles: props.profiles ?? [ATTACH_PROFILE],
    existingSessionEnvironmentNotice: props.existingSessionEnvironmentNotice,
    onMessage: props.onMessage,
    onProfileLaunched: props.onProfileLaunched,
  });

  useEffect(() => {
    props.onReady(manager);
  }, [manager, props]);

  return null;
}

function createObserver(
  overrides: Partial<ChromeBridgeObserverSnapshot> = {},
): ChromeBridgeObserverSnapshot {
  return {
    client_id: "observer-1",
    profile_key: ATTACH_PROFILE.profile_key,
    connected_at: "2026-03-16T10:00:00Z",
    user_agent: "Chrome",
    last_heartbeat_at: "2026-03-16T10:00:01Z",
    ...overrides,
  };
}

function createBridgeStatus(
  observerOverrides: Array<Partial<ChromeBridgeObserverSnapshot>> = [],
): ChromeBridgeStatusSnapshot {
  const observers = observerOverrides.map((observer) =>
    createObserver(observer),
  );
  return {
    observer_count: observers.length,
    control_count: 0,
    pending_command_count: 0,
    observers,
    controls: [],
    pending_commands: [],
  };
}

const mountedRoots: MountedRoot[] = [];

describe("useExistingSessionProfileManager", () => {
  let latestManager: ReturnType<typeof useExistingSessionProfileManager> | null;

  beforeEach(() => {
    setupReactActEnvironment();
    latestManager = null;
    vi.clearAllMocks();
    mockAttachExistingSessionProfile.mockResolvedValue(null);
    mockGetExistingSessionBridgeStatus.mockResolvedValue(null);
    mockListExistingSessionTabs.mockResolvedValue([]);
    mockLoadExistingSessionBridgeContext.mockResolvedValue({
      bridgeStatus: null,
      observer: null,
    });
    mockSwitchExistingSessionTab.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  async function renderHook(
    props: Omit<HookHarnessProps, "onReady"> = {},
  ): Promise<void> {
    mountHarness(
      HookHarness,
      {
        ...props,
        onReady: (manager) => {
          latestManager = manager;
        },
      },
      mountedRoots,
    );
    await flushEffects();
  }

  function getManager() {
    expect(latestManager).not.toBeNull();
    return latestManager as ReturnType<typeof useExistingSessionProfileManager>;
  }

  it("附着成功后应同步连接状态、页面摘要并复用环境限制提示", async () => {
    const onMessage = vi.fn();
    const onProfileLaunched = vi.fn();
    const pageInfo: ChromeBridgePageInfo = {
      title: "微博首页",
      url: "https://weibo.com/home",
      markdown: "# 微博首页",
      updated_at: "2026-03-16T10:00:08Z",
    };
    mockLoadExistingSessionBridgeContext.mockResolvedValue({
      bridgeStatus: createBridgeStatus([
        {
          last_page_info: {
            title: "微博旧页",
            url: "https://weibo.com/old",
            markdown: "# 微博旧页",
            updated_at: "2026-03-16T10:00:05Z",
          },
        },
      ]),
      observer: createObserver(),
    });
    mockAttachExistingSessionProfile.mockResolvedValue(pageInfo);

    await renderHook({
      onMessage,
      onProfileLaunched,
      existingSessionEnvironmentNotice: "附着模式不应用启动环境。",
    });

    await act(async () => {
      await getManager().handleAttachExistingSession(ATTACH_PROFILE);
    });
    await flushEffects();

    const manager = getManager();
    expect(mockLoadExistingSessionBridgeContext).toHaveBeenCalledWith(
      ATTACH_PROFILE.profile_key,
    );
    expect(mockAttachExistingSessionProfile).toHaveBeenCalledWith(
      ATTACH_PROFILE,
    );
    expect(manager.bridgeConnectionCount).toBe(1);
    expect(manager.connectedAttachCount).toBe(1);
    expect(manager.pageInfoByProfileKey[ATTACH_PROFILE.profile_key]).toEqual(
      pageInfo,
    );
    expect(onProfileLaunched).toHaveBeenCalledWith(ATTACH_PROFILE.profile_key);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        text: expect.stringContaining("附着模式不应用启动环境。"),
      }),
    );
  });

  it("缺失 observer 时应抛统一错误并保留桥接状态快照", async () => {
    const onMessage = vi.fn();
    const onProfileLaunched = vi.fn();
    mockLoadExistingSessionBridgeContext.mockResolvedValue({
      bridgeStatus: createBridgeStatus(),
      observer: null,
    });

    await renderHook({
      onMessage,
      onProfileLaunched,
    });

    let error: unknown = null;
    await act(async () => {
      try {
        await getManager().handleAttachExistingSession(ATTACH_PROFILE);
      } catch (nextError) {
        error = nextError;
      }
    });
    await flushEffects();

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `profile_key=${ATTACH_PROFILE.profile_key}`,
    );
    expect(getManager().bridgeConnectionCount).toBe(0);
    expect(onProfileLaunched).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("展开和收起标签页面板时应只在首次展开读取标签页", async () => {
    mockListExistingSessionTabs.mockResolvedValue([
      {
        id: "101",
        index: 0,
        title: "微博首页",
        url: "https://weibo.com/home",
        active: true,
      },
      COMPOSE_TAB,
    ]);

    await renderHook();

    await act(async () => {
      await getManager().handleToggleExistingSessionTabs(ATTACH_PROFILE);
    });
    await flushEffects();

    expect(getManager().tabPanelsOpen[ATTACH_PROFILE.profile_key]).toBe(true);
    expect(
      getManager().tabsByProfileKey[ATTACH_PROFILE.profile_key],
    ).toHaveLength(2);
    expect(mockListExistingSessionTabs).toHaveBeenCalledTimes(1);

    await act(async () => {
      await getManager().handleToggleExistingSessionTabs(ATTACH_PROFILE);
    });
    await flushEffects();

    expect(getManager().tabPanelsOpen[ATTACH_PROFILE.profile_key]).toBe(false);
    expect(mockListExistingSessionTabs).toHaveBeenCalledTimes(1);
  });

  it("切换标签页后不应让较旧桥接快照覆盖较新的页面摘要", async () => {
    const onMessage = vi.fn();
    mockSwitchExistingSessionTab.mockResolvedValue({
      title: "微博创作中心",
      url: "https://weibo.com/compose",
      markdown: "# 微博创作中心",
      updated_at: "2026-03-16T10:00:08Z",
    });
    mockListExistingSessionTabs.mockResolvedValue([
      {
        id: "101",
        index: 0,
        title: "微博首页",
        url: "https://weibo.com/home",
        active: false,
      },
      {
        ...COMPOSE_TAB,
        active: true,
      },
    ]);
    mockGetExistingSessionBridgeStatus.mockResolvedValue(
      createBridgeStatus([
        {
          last_page_info: {
            title: "微博首页",
            url: "https://weibo.com/home",
            markdown: "# 微博首页",
            updated_at: "2026-03-16T10:00:05Z",
          },
        },
      ]),
    );

    await renderHook({ onMessage });

    await act(async () => {
      await getManager().handleSwitchExistingSessionTab(
        ATTACH_PROFILE,
        COMPOSE_TAB,
      );
    });
    await flushEffects();

    const manager = getManager();
    expect(mockSwitchExistingSessionTab).toHaveBeenCalledWith(
      ATTACH_PROFILE.profile_key,
      COMPOSE_TAB.id,
    );
    expect(
      manager.pageInfoByProfileKey[ATTACH_PROFILE.profile_key],
    ).toMatchObject({
      title: "微博创作中心",
      updated_at: "2026-03-16T10:00:08Z",
    });
    expect(manager.tabsByProfileKey[ATTACH_PROFILE.profile_key]).toEqual([
      {
        id: "101",
        index: 0,
        title: "微博首页",
        url: "https://weibo.com/home",
        active: false,
      },
      {
        ...COMPOSE_TAB,
        active: true,
      },
    ]);
    expect(manager.switchingTabKey).toBeNull();
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已切换到标签页：微博创作中心",
    });
  });
});
