import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { useBrowserRuntimeDebug } from "./useBrowserRuntimeDebug";
import {
  cleanupMountedRoots,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

const {
  mockBrowserRuntimeApi,
  browserEventHandlerRef,
} = vi.hoisted(() => ({
  mockBrowserRuntimeApi: {
    listBrowserProfiles: vi.fn(),
    listCdpTargets: vi.fn(),
    openCdpSession: vi.fn(),
    closeCdpSession: vi.fn(),
    startBrowserStream: vi.fn(),
    stopBrowserStream: vi.fn(),
    getBrowserSessionState: vi.fn(),
    takeOverBrowserSession: vi.fn(),
    releaseBrowserSession: vi.fn(),
    resumeBrowserSession: vi.fn(),
    getBrowserEventBuffer: vi.fn(),
    openBrowserRuntimeDebuggerWindow: vi.fn(),
    launchBrowserSession: vi.fn(),
    browserExecuteAction: vi.fn(),
    reopenProfileWindow: vi.fn(),
    listenBrowserEvent: vi.fn(),
    supportsNativeEvents: vi.fn(),
  },
  browserEventHandlerRef: {
    current: null as null | ((event: { payload: any }) => void),
  },
}));

vi.mock("./api", () => ({
  browserRuntimeApi: {
    ...mockBrowserRuntimeApi,
  },
}));

setupReactActEnvironment();

const mountedRoots: MountedRoot[] = [];

function HookHarness(props: {
  sessions: Array<{ profile_key: string; last_url?: string }>;
  onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  initialProfileKey?: string;
  initialSessionId?: string;
  openOnMount?: boolean;
}) {
  const runtime = useBrowserRuntimeDebug(props.sessions as any, props.onMessage, {
    initialProfileKey: props.initialProfileKey ?? "general_browser_assist",
    initialSessionId:
      props.initialSessionId === undefined
        ? "session-old"
        : props.initialSessionId,
  });
  const { openSession, selectedProfileKey, sessionState, streaming } = runtime;

  React.useEffect(() => {
    if (!props.openOnMount || !selectedProfileKey) {
      return;
    }
    void openSession();
  }, [openSession, props.openOnMount, selectedProfileKey]);

  return (
    <>
      <div
        data-testid="runtime-hook"
        data-session-id={sessionState?.session_id || ""}
        data-target-url={sessionState?.target_url || ""}
        data-streaming={streaming ? "true" : "false"}
      />
      <button
        type="button"
        data-testid="runtime-click"
        onClick={() => void runtime.clickAt(88, 132)}
      >
        click
      </button>
    </>
  );
}

describe("useBrowserRuntimeDebug", () => {
  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    browserEventHandlerRef.current = null;
    vi.clearAllMocks();
  });

  it("浏览器连接被外部关闭后应自动重新拉起并恢复会话", async () => {
    mockBrowserRuntimeApi.listBrowserProfiles.mockResolvedValue([
      {
        profile_key: "general_browser_assist",
        transport_kind: "managed_cdp",
      },
    ]);
    mockBrowserRuntimeApi.supportsNativeEvents.mockReturnValue(true);
    mockBrowserRuntimeApi.listenBrowserEvent.mockImplementation(
      (handler: (event: { payload: any }) => void) => {
        browserEventHandlerRef.current = handler;
        return Promise.resolve(() => undefined);
      },
    );
    mockBrowserRuntimeApi.getBrowserSessionState.mockResolvedValue({
      session_id: "session-old",
      profile_key: "general_browser_assist",
      target_id: "target-old",
      target_title: "旧页面",
      target_url: "https://news.baidu.com/",
      remote_debugging_port: 16312,
      ws_debugger_url: "ws://127.0.0.1:16312/devtools/page/old",
      stream_mode: "both",
      transport_kind: "cdp_frames",
      lifecycle_state: "live",
      control_mode: "agent",
      created_at: "2026-03-14T00:00:00Z",
      connected: true,
      last_page_info: {
        title: "旧页面",
        url: "https://news.baidu.com/",
        markdown: "",
        updated_at: "2026-03-14T00:00:01Z",
      },
    });
    mockBrowserRuntimeApi.getBrowserEventBuffer.mockResolvedValue({
      events: [],
      next_cursor: 0,
    });
    mockBrowserRuntimeApi.listCdpTargets.mockResolvedValue([]);
    mockBrowserRuntimeApi.launchBrowserSession.mockResolvedValue({
      profile: {
        success: true,
        reused: false,
        browser_source: "chrome",
        browser_path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        profile_dir: "/tmp/general_browser_assist",
        remote_debugging_port: 16312,
        pid: 12345,
        devtools_http_url: "http://127.0.0.1:16312/json/version",
        error: null,
      },
      session: {
        session_id: "session-new",
        profile_key: "general_browser_assist",
        target_id: "target-new",
        target_title: "恢复后的页面",
        target_url: "https://news.baidu.com/",
        remote_debugging_port: 16312,
        ws_debugger_url: "ws://127.0.0.1:16312/devtools/page/new",
        stream_mode: "both",
        transport_kind: "cdp_frames",
        lifecycle_state: "live",
        control_mode: "agent",
        created_at: "2026-03-14T00:01:00Z",
        connected: true,
      },
    });

    const onMessage = vi.fn();
    const { container } = mountHarness(
      HookHarness,
      {
        sessions: [
          {
            profile_key: "general_browser_assist",
            last_url: "https://news.baidu.com/",
          },
        ],
        onMessage,
      },
      mountedRoots,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      browserEventHandlerRef.current?.({
        payload: {
          session_id: "session-old",
          sequence: 2,
          occurred_at: "2026-03-14T00:01:10Z",
          type: "session_error",
          error: "读取 CDP 消息失败: IO error: Connection reset by peer (os error 54)",
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrowserRuntimeApi.launchBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_key: "general_browser_assist",
        url: "https://news.baidu.com/",
        open_window: false,
        stream_mode: "both",
      }),
    );
    expect(
      container.querySelector("[data-testid='runtime-hook']")?.getAttribute(
        "data-session-id",
      ),
    ).toBe("session-new");
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        text: expect.stringContaining("已自动重新启动并恢复会话"),
      }),
    );
  });

  it("existing_session 初始资料不应误走 CDP 标签页读取", async () => {
    mockBrowserRuntimeApi.listBrowserProfiles.mockResolvedValue([
      {
        profile_key: "attached-github",
        transport_kind: "existing_session",
      },
    ]);
    mockBrowserRuntimeApi.supportsNativeEvents.mockReturnValue(true);
    mockBrowserRuntimeApi.listenBrowserEvent.mockResolvedValue(() => undefined);

    mountHarness(
      HookHarness,
      {
        sessions: [],
        initialProfileKey: "attached-github",
        initialSessionId: "",
      },
      mountedRoots,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrowserRuntimeApi.listCdpTargets).not.toHaveBeenCalled();
    expect(mockBrowserRuntimeApi.openCdpSession).not.toHaveBeenCalled();
  });

  it("existing_session 自动连接时应优先走 launchBrowserSession", async () => {
    mockBrowserRuntimeApi.listBrowserProfiles.mockResolvedValue([
      {
        profile_key: "attached-github",
        transport_kind: "existing_session",
      },
    ]);
    mockBrowserRuntimeApi.supportsNativeEvents.mockReturnValue(true);
    mockBrowserRuntimeApi.listenBrowserEvent.mockResolvedValue(() => undefined);
    mockBrowserRuntimeApi.launchBrowserSession.mockResolvedValue({
      profile: {
        success: true,
        reused: true,
        browser_source: "system",
        browser_path: "",
        profile_dir: "",
        remote_debugging_port: 16666,
        pid: 0,
        devtools_http_url: "http://127.0.0.1:16666/json/version",
        error: null,
      },
      session: {
        session_id: "session-existing",
        profile_key: "attached-github",
        target_id: "tab-1",
        target_title: "GitHub",
        target_url: "https://github.com/",
        remote_debugging_port: 16666,
        ws_debugger_url: "ws://127.0.0.1:16666/devtools/page/tab-1",
        stream_mode: "both",
        transport_kind: "cdp_frames",
        lifecycle_state: "live",
        control_mode: "agent",
        created_at: "2026-03-30T10:00:00Z",
        connected: true,
      },
    });
    mockBrowserRuntimeApi.getBrowserEventBuffer.mockResolvedValue({
      events: [],
      next_cursor: 0,
    });

    mountHarness(
      HookHarness,
      {
        sessions: [
          {
            profile_key: "attached-github",
            last_url: "https://github.com/",
          },
        ],
        initialProfileKey: "attached-github",
        initialSessionId: "",
        openOnMount: true,
      },
      mountedRoots,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBrowserRuntimeApi.launchBrowserSession).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_key: "attached-github",
        url: "https://github.com/",
        open_window: false,
        stream_mode: "both",
      }),
    );
    expect(mockBrowserRuntimeApi.openCdpSession).not.toHaveBeenCalled();
    expect(mockBrowserRuntimeApi.listCdpTargets).not.toHaveBeenCalled();
  });

  it("existing_session 的人工控制应优先走扩展桥接后端", async () => {
    mockBrowserRuntimeApi.listBrowserProfiles.mockResolvedValue([
      {
        profile_key: "attached-github",
        transport_kind: "existing_session",
      },
    ]);
    mockBrowserRuntimeApi.supportsNativeEvents.mockReturnValue(true);
    mockBrowserRuntimeApi.listenBrowserEvent.mockResolvedValue(() => undefined);
    mockBrowserRuntimeApi.getBrowserSessionState.mockResolvedValue({
      session_id: "session-existing",
      profile_key: "attached-github",
      target_id: "tab-1",
      target_title: "GitHub",
      target_url: "https://github.com/",
      remote_debugging_port: 16666,
      ws_debugger_url: "ws://127.0.0.1:16666/devtools/page/tab-1",
      stream_mode: "both",
      transport_kind: "cdp_frames",
      lifecycle_state: "human_controlling",
      control_mode: "human",
      created_at: "2026-03-30T10:00:00Z",
      connected: true,
    });
    mockBrowserRuntimeApi.getBrowserEventBuffer.mockResolvedValue({
      events: [],
      next_cursor: 0,
    });
    mockBrowserRuntimeApi.browserExecuteAction.mockResolvedValue({
      success: true,
      backend: "lime_extension_bridge",
      action: "click",
      request_id: "browser-control-1",
      attempts: [],
      data: {},
    });

    const { container } = mountHarness(
      HookHarness,
      {
        sessions: [],
        initialProfileKey: "attached-github",
      },
      mountedRoots,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = container.querySelector(
      "[data-testid='runtime-click']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockBrowserRuntimeApi.browserExecuteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_key: "attached-github",
        backend: "lime_extension_bridge",
        action: "click",
        args: expect.objectContaining({
          x: 88,
          y: 132,
          target_id: "tab-1",
        }),
      }),
    );
  });
});
