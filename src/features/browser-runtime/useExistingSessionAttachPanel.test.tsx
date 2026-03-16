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
import { useExistingSessionAttachPanel } from "./useExistingSessionAttachPanel";

const {
  mockLoadExistingSessionAttachContext,
  mockListExistingSessionTabs,
  mockReadExistingSessionPage,
  mockSwitchExistingSessionTab,
} = vi.hoisted(() => ({
  mockLoadExistingSessionAttachContext: vi.fn(),
  mockListExistingSessionTabs: vi.fn(),
  mockReadExistingSessionPage: vi.fn(),
  mockSwitchExistingSessionTab: vi.fn(),
}));

vi.mock("./existingSessionBridgeClient", async () => {
  const actual =
    await vi.importActual<typeof import("./existingSessionBridgeClient")>(
      "./existingSessionBridgeClient",
    );
  return {
    ...actual,
    loadExistingSessionAttachContext: mockLoadExistingSessionAttachContext,
    listExistingSessionTabs: mockListExistingSessionTabs,
    readExistingSessionPage: mockReadExistingSessionPage,
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

const MANAGED_PROFILE: BrowserProfileRecord = {
  ...ATTACH_PROFILE,
  id: "profile-managed",
  profile_key: "managed_profile",
  name: "托管资料",
  transport_kind: "managed_cdp",
};

const HOME_PAGE_INFO: ChromeBridgePageInfo = {
  title: "微博首页",
  url: "https://weibo.com/home",
  markdown: "# 微博首页",
  updated_at: "2026-03-16T10:00:05Z",
};

const COMPOSE_PAGE_INFO: ChromeBridgePageInfo = {
  title: "微博创作中心",
  url: "https://weibo.com/compose",
  markdown: "# 微博创作中心",
  updated_at: "2026-03-16T10:00:08Z",
};

const COMPOSE_TAB: ExistingSessionTabRecord = {
  id: "202",
  index: 1,
  title: "微博创作中心",
  url: "https://weibo.com/compose",
  active: false,
};

type HookHarnessProps = {
  selectedProfileKey?: string | null;
  initialProfileKey?: string;
  sessionState?: unknown | null;
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  onReady: (panel: ReturnType<typeof useExistingSessionAttachPanel>) => void;
};

function HookHarness(props: HookHarnessProps) {
  const panel = useExistingSessionAttachPanel({
    selectedProfileKey: props.selectedProfileKey,
    initialProfileKey: props.initialProfileKey,
    sessionState: props.sessionState ?? null,
    onMessage: props.onMessage,
  });

  useEffect(() => {
    props.onReady(panel);
  }, [panel, props]);

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
    last_page_info: HOME_PAGE_INFO,
    ...overrides,
  };
}

function createBridgeStatus(
  observerOverrides: Array<Partial<ChromeBridgeObserverSnapshot>> = [],
): ChromeBridgeStatusSnapshot {
  const observers = observerOverrides.map((observer) => createObserver(observer));
  return {
    observer_count: observers.length,
    control_count: 0,
    pending_command_count: 0,
    observers,
    controls: [],
    pending_commands: [],
  };
}

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const mountedRoots: MountedRoot[] = [];

describe("useExistingSessionAttachPanel", () => {
  let latestPanel: ReturnType<typeof useExistingSessionAttachPanel> | null;

  beforeEach(() => {
    setupReactActEnvironment();
    latestPanel = null;
    vi.clearAllMocks();
    mockLoadExistingSessionAttachContext.mockResolvedValue({
      profile: ATTACH_PROFILE,
      observer: createObserver(),
      bridgeStatus: createBridgeStatus([{}]),
    });
    mockReadExistingSessionPage.mockResolvedValue(HOME_PAGE_INFO);
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
    mockSwitchExistingSessionTab.mockResolvedValue(COMPOSE_PAGE_INFO);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  async function renderHook(
    props: Omit<HookHarnessProps, "onReady"> = {},
  ) {
    const mounted = mountHarness(
      HookHarness,
      {
        selectedProfileKey: ATTACH_PROFILE.profile_key,
        initialProfileKey: "",
        sessionState: null,
        ...props,
        onReady: (panel) => {
          latestPanel = panel;
        },
      },
      mountedRoots,
    );
    await flushEffects(6);
    return mounted;
  }

  function getPanel() {
    expect(latestPanel).not.toBeNull();
    return latestPanel as ReturnType<typeof useExistingSessionAttachPanel>;
  }

  it("应在附着资料首次显示时自动同步桥接上下文", async () => {
    await renderHook();

    const panel = getPanel();
    expect(mockLoadExistingSessionAttachContext).toHaveBeenCalledWith(
      ATTACH_PROFILE.profile_key,
    );
    expect(panel.shouldUseAttachPresentation).toBe(true);
    expect(panel.attachProfile?.profile_key).toBe(ATTACH_PROFILE.profile_key);
    expect(panel.attachObserver?.client_id).toBe("observer-1");
    expect(panel.attachPageInfo).toEqual(HOME_PAGE_INFO);
  });

  it("读取当前页面后应保留较新的页面摘要并提示成功", async () => {
    const onMessage = vi.fn();
    mockLoadExistingSessionAttachContext
      .mockResolvedValueOnce({
        profile: ATTACH_PROFILE,
        observer: createObserver(),
        bridgeStatus: createBridgeStatus([{}]),
      })
      .mockResolvedValue({
        profile: ATTACH_PROFILE,
        observer: createObserver({
          last_page_info: HOME_PAGE_INFO,
        }),
        bridgeStatus: createBridgeStatus([
          {
            last_page_info: HOME_PAGE_INFO,
          },
        ]),
      });
    mockReadExistingSessionPage.mockResolvedValue(COMPOSE_PAGE_INFO);

    await renderHook({ onMessage });

    await act(async () => {
      await getPanel().loadAttachPage();
    });
    await flushEffects();

    expect(mockReadExistingSessionPage).toHaveBeenCalledWith(
      ATTACH_PROFILE.profile_key,
    );
    expect(getPanel().attachPageInfo).toEqual(COMPOSE_PAGE_INFO);
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已读取当前页面摘要",
    });
  });

  it("切换标签页后应刷新标签列表和页面摘要", async () => {
    const onMessage = vi.fn();
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
    mockLoadExistingSessionAttachContext
      .mockResolvedValueOnce({
        profile: ATTACH_PROFILE,
        observer: createObserver(),
        bridgeStatus: createBridgeStatus([{}]),
      })
      .mockResolvedValue({
        profile: ATTACH_PROFILE,
        observer: createObserver({
          last_page_info: HOME_PAGE_INFO,
        }),
        bridgeStatus: createBridgeStatus([
          {
            last_page_info: HOME_PAGE_INFO,
          },
        ]),
      });

    await renderHook({ onMessage });

    await act(async () => {
      await getPanel().handleSwitchAttachTab(COMPOSE_TAB);
    });
    await flushEffects();

    const panel = getPanel();
    expect(mockSwitchExistingSessionTab).toHaveBeenCalledWith(
      ATTACH_PROFILE.profile_key,
      COMPOSE_TAB.id,
    );
    expect(panel.attachTabs).toEqual([
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
    expect(panel.attachPageInfo).toEqual(COMPOSE_PAGE_INFO);
    expect(panel.switchingAttachTabId).toBeNull();
    expect(onMessage).toHaveBeenCalledWith({
      type: "success",
      text: "已切换到标签页：微博创作中心",
    });
  });

  it("较旧的 read_page 结果不应覆盖较新的切页结果", async () => {
    const deferredReadPage = createDeferredPromise<ChromeBridgePageInfo | null>();
    mockReadExistingSessionPage.mockImplementationOnce(() => deferredReadPage.promise);
    mockLoadExistingSessionAttachContext
      .mockResolvedValueOnce({
        profile: ATTACH_PROFILE,
        observer: createObserver(),
        bridgeStatus: createBridgeStatus([{}]),
      })
      .mockResolvedValue({
        profile: ATTACH_PROFILE,
        observer: createObserver({
          last_page_info: HOME_PAGE_INFO,
        }),
        bridgeStatus: createBridgeStatus([
          {
            last_page_info: HOME_PAGE_INFO,
          },
        ]),
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

    await renderHook();

    let pendingReadPage: Promise<ChromeBridgePageInfo | null>;
    await act(async () => {
      pendingReadPage = getPanel().loadAttachPage();
      await Promise.resolve();
    });

    await act(async () => {
      await getPanel().handleSwitchAttachTab(COMPOSE_TAB);
    });
    await flushEffects();

    expect(getPanel().attachPageInfo).toEqual(COMPOSE_PAGE_INFO);

    await act(async () => {
      deferredReadPage.resolve({
        title: "过期页面",
        url: "https://weibo.com/stale",
        markdown: "# 过期页面",
        updated_at: "2026-03-16T10:00:06Z",
      });
      await pendingReadPage!;
    });
    await flushEffects();

    expect(getPanel().attachPageInfo).toEqual(COMPOSE_PAGE_INFO);
  });

  it("存在独立会话时不应进入附着展示模式", async () => {
    mockLoadExistingSessionAttachContext.mockResolvedValue({
      profile: MANAGED_PROFILE,
      observer: null,
      bridgeStatus: createBridgeStatus([]),
    });

    await renderHook({
      selectedProfileKey: MANAGED_PROFILE.profile_key,
      sessionState: { session_id: "session-1" },
    });

    expect(getPanel().shouldUseAttachPresentation).toBe(false);
    expect(mockLoadExistingSessionAttachContext).not.toHaveBeenCalled();
  });

  it("切换 profile_key 时不应短暂复用旧资料信息", async () => {
    const deferredContext = createDeferredPromise<{
      profile: BrowserProfileRecord | null;
      observer: ChromeBridgeObserverSnapshot | null;
      bridgeStatus: ChromeBridgeStatusSnapshot | null;
    }>();

    const mounted = await renderHook();

    expect(getPanel().attachProfile?.profile_key).toBe(ATTACH_PROFILE.profile_key);

    mockLoadExistingSessionAttachContext.mockImplementationOnce(
      () => deferredContext.promise,
    );

    mounted.rerender({
      selectedProfileKey: MANAGED_PROFILE.profile_key,
      initialProfileKey: "",
      sessionState: null,
      onReady: (panel) => {
        latestPanel = panel;
      },
    });
    await flushEffects();

    expect(getPanel().attachProfile).toBeNull();

    await act(async () => {
      deferredContext.resolve({
        profile: MANAGED_PROFILE,
        observer: null,
        bridgeStatus: createBridgeStatus([]),
      });
      await deferredContext.promise;
    });
    await flushEffects();

    expect(getPanel().attachProfile?.profile_key).toBe(MANAGED_PROFILE.profile_key);
  });
});
