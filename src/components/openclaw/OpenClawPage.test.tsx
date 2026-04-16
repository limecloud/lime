import React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  waitForCondition,
  type MountedRoot,
} from "../image-gen/test-utils";
import { OpenClawPage } from "./OpenClawPage";

const {
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
  mockToastWarning,
  mockDetectDesktopPlatform,
  mockOpenUrl,
  mockInstall,
  mockInstallDependency,
  mockGetEnvironmentStatus,
  mockGetStatus,
  mockCheckUpdate,
  mockPerformUpdate,
  mockListRuntimeCandidates,
  mockSetPreferredRuntime,
  mockGetNodeDownloadUrl,
  mockGetGitDownloadUrl,
  mockListenInstallProgress,
  mockGetProgressLogs,
  mockInstallPageRender,
  mockRuntimePageRender,
  mockRefreshDashboardUrl,
  mockRefreshDashboardWindowState,
  mockHandleOpenDashboardWindow,
  mockCheckHealth,
  mockGetChannels,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastWarning: vi.fn(),
  mockDetectDesktopPlatform: vi.fn(),
  mockOpenUrl: vi.fn(),
  mockInstall: vi.fn(),
  mockInstallDependency: vi.fn(),
  mockGetEnvironmentStatus: vi.fn(),
  mockGetStatus: vi.fn(),
  mockCheckUpdate: vi.fn(),
  mockPerformUpdate: vi.fn(),
  mockListRuntimeCandidates: vi.fn(),
  mockSetPreferredRuntime: vi.fn(),
  mockGetNodeDownloadUrl: vi.fn(),
  mockGetGitDownloadUrl: vi.fn(),
  mockListenInstallProgress: vi.fn(),
  mockGetProgressLogs: vi.fn(),
  mockInstallPageRender: vi.fn(),
  mockRuntimePageRender: vi.fn(),
  mockRefreshDashboardUrl: vi.fn(),
  mockRefreshDashboardWindowState: vi.fn(),
  mockHandleOpenDashboardWindow: vi.fn(),
  mockCheckHealth: vi.fn(),
  mockGetChannels: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
    warning: mockToastWarning,
  },
}));

vi.mock("@/hooks/useApiKeyProvider", () => ({
  useApiKeyProvider: () => ({
    providers: [],
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProviderModels", () => ({
  useProviderModels: () => ({
    models: [],
    loading: false,
    error: null,
  }),
}));

vi.mock("@/lib/crashDiagnostic", () => ({
  detectDesktopPlatform: mockDetectDesktopPlatform,
}));

vi.mock("@/lib/api/openclaw", () => ({
  openclawApi: {
    getEnvironmentStatus: mockGetEnvironmentStatus,
    getStatus: mockGetStatus,
    checkUpdate: mockCheckUpdate,
    performUpdate: mockPerformUpdate,
    listRuntimeCandidates: mockListRuntimeCandidates,
    setPreferredRuntime: mockSetPreferredRuntime,
    getNodeDownloadUrl: mockGetNodeDownloadUrl,
    getGitDownloadUrl: mockGetGitDownloadUrl,
    listenInstallProgress: mockListenInstallProgress,
    getProgressLogs: mockGetProgressLogs,
    install: mockInstall,
    installDependency: mockInstallDependency,
    cleanupTempArtifacts: vi.fn(),
    getCommandPreview: vi.fn(),
    uninstall: vi.fn(),
    restartGateway: vi.fn(),
    startGateway: vi.fn(),
    stopGateway: vi.fn(),
    checkHealth: mockCheckHealth,
    getChannels: mockGetChannels,
    getDashboardUrl: vi.fn(),
    syncProviderConfig: vi.fn(),
  },
}));

vi.mock("./openUrl", () => ({
  openUrl: mockOpenUrl,
}));

vi.mock("./useOpenClawDashboardWindow", () => ({
  useOpenClawDashboardWindow: () => ({
    dashboardLoading: false,
    dashboardUrl: null,
    dashboardWindowBusy: false,
    dashboardWindowOpen: false,
    refreshDashboardUrl: mockRefreshDashboardUrl,
    refreshDashboardWindowState: mockRefreshDashboardWindowState,
    handleOpenDashboardWindow: mockHandleOpenDashboardWindow,
    handleOpenDashboardExternal: vi.fn(),
    closeDashboardWindowSilently: vi.fn(),
  }),
}));

vi.mock("./useOpenClawStore", () => {
  const store = {
    selectedProviderId: null as string | null,
    selectedModelId: "",
    gatewayPort: 18790,
    preferredRuntimeId: null as string | null,
    lastSynced: null,
    recentOperation: null,
    setSelectedProviderId: vi.fn(),
    setSelectedModelId: vi.fn(),
    setGatewayPort: vi.fn(),
    setPreferredRuntimeId: vi.fn(),
    setLastSynced: vi.fn(),
    setRecentOperation: vi.fn(),
    clearLastSynced: vi.fn(),
    clearRecentOperation: vi.fn(),
  };

  return {
    useOpenClawStore: (selector: (state: typeof store) => unknown) =>
      selector(store),
  };
});

vi.mock("./OpenClawInstallPage", () => ({
  OpenClawInstallPage: (props: {
    desktopPlatform: string;
    environmentStatus: { summary?: string } | null;
    onInstall: () => void;
    onInstallNode: () => void;
    onInstallGit: () => void;
    onSelectPreferredRuntime: (runtimeId: string | null) => void;
  }) => {
    mockInstallPageRender(props);
    return (
      <div data-testid="openclaw-install-page">
        <div data-testid="desktop-platform">{props.desktopPlatform}</div>
        <div data-testid="install-summary">
          {props.environmentStatus?.summary ?? "<none>"}
        </div>
        <button type="button" onClick={props.onInstall}>
          触发安装
        </button>
        <button type="button" onClick={props.onInstallNode}>
          触发 Node 安装
        </button>
        <button type="button" onClick={props.onInstallGit}>
          触发 Git 安装
        </button>
        <button
          type="button"
          onClick={() => props.onSelectPreferredRuntime("mock-runtime")}
        >
          切换运行时
        </button>
      </div>
    );
  },
}));

vi.mock("./OpenClawConfigurePage", () => ({
  OpenClawConfigurePage: () => <div data-testid="openclaw-configure-page" />,
}));

vi.mock("./OpenClawDashboardPage", () => ({
  OpenClawDashboardPage: () => <div data-testid="openclaw-dashboard-page" />,
}));

vi.mock("./OpenClawProgressPage", () => ({
  OpenClawProgressPage: () => <div data-testid="openclaw-progress-page" />,
}));

vi.mock("./OpenClawRuntimePage", () => ({
  OpenClawRuntimePage: (props: {
    onUpdate: () => void;
    onUseRecommendedUpdateRuntime: () => void;
  }) => {
    mockRuntimePageRender(props);
    return (
      <div data-testid="openclaw-runtime-page">
        <button type="button" onClick={props.onUpdate}>
          触发升级
        </button>
        <button type="button" onClick={props.onUseRecommendedUpdateRuntime}>
          切到推荐升级环境
        </button>
      </div>
    );
  },
}));

const mountedRoots: MountedRoot[] = [];

function buildEnvironmentStatus(options?: {
  nodeStatus?: "ok" | "missing" | "version_low";
  gitStatus?: "ok" | "missing";
  openclawStatus?: "ok" | "missing" | "needs_reload";
  openclawMessage?: string;
  openclawPath?: string | null;
  openclawVersion?: string | null;
  summary?: string;
}) {
  const nodeStatus = options?.nodeStatus ?? "missing";
  const gitStatus = options?.gitStatus ?? "missing";
  const openclawStatus = options?.openclawStatus ?? "missing";

  return {
    node: {
      status: nodeStatus,
      version: nodeStatus === "ok" ? "22.12.0" : null,
      path: nodeStatus === "ok" ? "C:/Program Files/nodejs/node.exe" : null,
      message:
        nodeStatus === "ok"
          ? "Node.js 已就绪：22.12.0"
          : "未检测到 Node.js，需要安装 22.12.0+。",
      autoInstallSupported: false,
    },
    git: {
      status: gitStatus,
      version: gitStatus === "ok" ? "2.44.0" : null,
      path: gitStatus === "ok" ? "C:/Program Files/Git/cmd/git.exe" : null,
      message: gitStatus === "ok" ? "Git 已就绪：2.44.0" : "未检测到 Git。",
      autoInstallSupported: false,
    },
    openclaw: {
      status: openclawStatus,
      version: options?.openclawVersion ?? null,
      path: options?.openclawPath ?? null,
      message:
        options?.openclawMessage ??
        (openclawStatus === "needs_reload"
          ? "已检测到 OpenClaw 包，但当前进程尚未解析到 openclaw 命令。"
          : openclawStatus === "ok"
            ? "已检测到 OpenClaw。"
            : "未检测到 OpenClaw。"),
      autoInstallSupported: false,
    },
    recommendedAction: "install_node",
    summary: options?.summary ?? "Windows 下请先手动安装依赖。",
    tempArtifacts: [],
  };
}

function renderPage(
  props?: Partial<React.ComponentProps<typeof OpenClawPage>>,
) {
  return renderIntoDom(<OpenClawPage isActive {...props} />, mountedRoots);
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`未找到按钮：${text}`);
  }

  return button as HTMLButtonElement;
}

async function waitForInstallPage(container: HTMLElement) {
  await waitForCondition(
    () => !!container.querySelector('[data-testid="openclaw-install-page"]'),
    40,
    "OpenClaw 安装页未在预期时间内渲染",
  );
}

async function flushInstallTimer() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  setReactActEnvironment();
  vi.clearAllMocks();

  mockDetectDesktopPlatform.mockReturnValue("windows");
  mockGetEnvironmentStatus.mockResolvedValue(buildEnvironmentStatus());
  mockGetStatus.mockResolvedValue({ status: "stopped", port: 18790 });
  mockCheckUpdate.mockResolvedValue({
    hasUpdate: false,
    currentVersion: "2026.3.8",
    latestVersion: "2026.3.8",
    channel: "stable",
    installKind: "package",
    packageManager: "pnpm",
    message: null,
  });
  mockListRuntimeCandidates.mockResolvedValue([]);
  mockSetPreferredRuntime.mockResolvedValue({
    success: true,
    message: "已切换为自动选择执行环境。",
  });
  mockGetNodeDownloadUrl.mockResolvedValue("https://nodejs.org/en/download");
  mockGetGitDownloadUrl.mockResolvedValue("https://git-scm.com/download/win");
  mockListenInstallProgress.mockResolvedValue(() => {});
  mockGetProgressLogs.mockResolvedValue([]);
  mockInstall.mockResolvedValue({ success: true, message: "ok" });
  mockInstallDependency.mockResolvedValue({ success: true, message: "ok" });
  mockPerformUpdate.mockResolvedValue({ success: true, message: "ok" });
  mockCheckHealth.mockResolvedValue({
    status: "healthy",
    gatewayPort: 18790,
    uptime: 10,
    version: "2026.3.8",
  });
  mockGetChannels.mockResolvedValue([]);
  mockRefreshDashboardUrl.mockResolvedValue(null);
  mockRefreshDashboardWindowState.mockResolvedValue(false);
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  vi.clearAllMocks();
});

describe("OpenClawPage", () => {
  it("应在头部明确 remote 主入口与 OpenClaw compat 的职责边界", async () => {
    const onNavigate = vi.fn();
    const mounted = renderPage({ onNavigate });
    await waitForInstallPage(mounted.container);
    await flushEffects();

    expect(mounted.container.textContent).toContain(
      "当前 remote 主入口已收口到消息渠道与浏览器连接器",
    );
    expect(mounted.container.textContent).toContain(
      "OpenClaw 继续负责本地 Gateway、安装修复和兼容接入",
    );

    await act(async () => {
      findButton(mounted.container, "去消息渠道").click();
      findButton(mounted.container, "去浏览器连接器").click();
      await flushEffects();
    });

    expect(onNavigate).toHaveBeenCalledWith("channels");
    expect(onNavigate).toHaveBeenCalledWith("settings", {
      tab: "chrome-relay",
    });
  });

  it("Windows 缺依赖时点击安装不应真正调用安装接口", async () => {
    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    expect(mounted.container.textContent).toContain("windows");

    await act(async () => {
      findButton(mounted.container, "触发安装").click();
      await flushEffects();
    });

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "Windows 下请先手动安装 Node.js / Git，完成后点击“重新检测”，再安装 OpenClaw。",
    );
  });

  it("Windows 缺少 Node.js 时点击依赖安装应改为打开下载链接", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "missing",
        gitStatus: "ok",
        summary: "Windows 下请先手动安装 Node.js。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发 Node 安装").click();
      await flushEffects();
    });

    expect(mockInstallDependency).not.toHaveBeenCalled();
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Windows 下请先手动下载安装 Node.js 22+，安装完成后重新检测。",
    );
    expect(mockGetNodeDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).toHaveBeenCalledWith("https://nodejs.org/en/download");
  });

  it("Windows 缺少 Git 时点击依赖安装应改为打开下载链接", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "missing",
        summary: "Windows 下请先手动安装 Git。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发 Git 安装").click();
      await flushEffects();
    });

    expect(mockInstallDependency).not.toHaveBeenCalled();
    expect(mockToastInfo).toHaveBeenCalledWith(
      "Windows 下请先手动下载安装 Git，并在安装时勾选加入 PATH，完成后重新检测。",
    );
    expect(mockGetGitDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://git-scm.com/download/win",
    );
  });

  it("macOS 缺少 Node.js 时点击依赖安装应继续走应用内修复", async () => {
    mockDetectDesktopPlatform.mockReturnValue("macos");
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "missing",
        gitStatus: "ok",
        summary: "macOS 下可继续一键修复 Node.js。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发 Node 安装").click();
      await flushEffects();
    });

    expect(mockInstallDependency).toHaveBeenCalledWith("node");
    expect(mockGetNodeDownloadUrl).not.toHaveBeenCalled();
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("Windows 依赖已就绪时点击安装应继续调用安装接口", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        summary: "Windows 运行环境已就绪，可以继续安装 OpenClaw。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发安装").click();
      await flushEffects();
    });
    await flushInstallTimer();

    await waitForCondition(
      () => mockInstall.mock.calls.length > 0,
      20,
      "Windows 就绪环境下未触发安装接口",
    );
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("检测到 OpenClaw 包但命令待生效时点击安装应提示重新检测", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "needs_reload",
        openclawVersion: "0.4.1",
        openclawPath: "C:/Users/demo/AppData/Roaming/npm",
        openclawMessage:
          "已在 npm 全局目录检测到 openclaw（0.4.1），但当前进程尚未解析到 openclaw 命令。请点击“重新检测”；若仍失败，请重启 Lime。",
        summary: "已检测到 OpenClaw 包，但命令尚未生效；请点击“重新检测”。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发安装").click();
      await flushEffects();
    });

    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "已在 npm 全局目录检测到 openclaw（0.4.1），但当前进程尚未解析到 openclaw 命令。请点击“重新检测”；若仍失败，请重启 Lime。",
    );
  });

  it("macOS 缺依赖时点击安装应继续走自动修复安装流程", async () => {
    mockDetectDesktopPlatform.mockReturnValue("macos");
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "missing",
        gitStatus: "missing",
        summary: "macOS 下可继续一键修复环境并安装 OpenClaw。",
      }),
    );

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "触发安装").click();
      await flushEffects();
    });
    await flushInstallTimer();

    await waitForCondition(
      () => mockInstall.mock.calls.length > 0,
      20,
      "macOS 缺依赖时未触发安装接口",
    );
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("切换执行环境时应先同步后端再刷新页面状态", async () => {
    mockListRuntimeCandidates.mockResolvedValue([
      {
        id: "mock-runtime",
        source: "nvm",
        binDir: "/Users/demo/.nvm/versions/node/v23.4.0/bin",
        nodePath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/node",
        nodeVersion: "23.4.0",
        npmPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/npm",
        npmGlobalPrefix: "/Users/demo/.nvm/versions/node/v23.4.0",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        openclawVersion: "2026.3.8",
        openclawPackagePath:
          "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json",
        isActive: true,
        isPreferred: false,
      },
    ]);
    mockSetPreferredRuntime.mockResolvedValue({
      success: true,
      message: "已固定使用执行环境：nvm · Node 23.4.0。",
    });

    const mounted = renderPage();
    await waitForInstallPage(mounted.container);
    await flushEffects();

    await act(async () => {
      findButton(mounted.container, "切换运行时").click();
      await flushEffects();
    });

    await waitForCondition(
      () =>
        mockSetPreferredRuntime.mock.calls.some(
          ([runtimeId]) => runtimeId === "mock-runtime",
        ),
      20,
      "切换执行环境后未同步到后端",
    );
    expect(mockGetEnvironmentStatus.mock.calls.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("命令待刷新但 Gateway 已运行时不应阻塞进入后续页面", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "needs_reload",
        openclawVersion: "2026.3.13-zh.1",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0",
        summary: "已检测到 OpenClaw 包，但命令尚未生效。",
      }),
    );
    mockGetStatus.mockResolvedValue({ status: "running", port: 18790 });

    const mounted = renderPage();
    await flushEffects();

    await waitForCondition(
      () =>
        !!mounted.container.querySelector(
          '[data-testid="openclaw-runtime-page"]',
        ),
      40,
      "Gateway 已运行时仍被阻塞在安装页",
    );
  });

  it("命令待刷新时仍应允许进入安装页重新检测", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "needs_reload",
        openclawVersion: "2026.3.13-zh.1",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0",
        summary: "已检测到 OpenClaw 包，但命令尚未生效。",
      }),
    );
    mockGetStatus.mockResolvedValue({ status: "running", port: 18790 });

    const mounted = renderPage({
      pageParams: { subpage: "install" },
      onNavigate: vi.fn(),
    });
    await waitForInstallPage(mounted.container);
    await flushEffects();

    expect(
      mounted.container.querySelector('[data-testid="openclaw-install-page"]'),
    ).toBeTruthy();
  });

  it("工作台概览中的安装路径摘要应压缩显示长路径", async () => {
    const longInstallPath =
      "/Users/demo/Library/Application Support/lime/runtime/openclaw/node_modules/@qingchencloud/openclaw-zh/package.json";

    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "ok",
        openclawVersion: "2026.3.18",
        openclawPath: longInstallPath,
        summary: "OpenClaw 已安装。",
      }),
    );

    const mounted = renderPage();
    await flushEffects();

    await waitForCondition(
      () => mounted.container.textContent?.includes("OpenClaw 工作台") ?? false,
      40,
      "OpenClaw 工作台未在预期时间内渲染",
    );

    const compactedEntries = Array.from(
      mounted.container.querySelectorAll("[title]"),
    ).filter((item) => item.getAttribute("title") === longInstallPath);

    expect(compactedEntries.length).toBeGreaterThan(0);
    expect(
      compactedEntries.some(
        (item) =>
          item.textContent !== longInstallPath &&
          item.textContent?.includes("..."),
      ),
    ).toBe(true);
  });

  it("工作台摘要中的桌面面板快捷按钮应直接触发打开动作", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "ok",
        openclawVersion: "2026.3.13",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        summary: "OpenClaw 已安装。",
      }),
    );
    mockGetStatus.mockResolvedValue({ status: "running", port: 18790 });

    const mounted = renderPage();
    await flushEffects();

    await waitForCondition(
      () =>
        !!mounted.container.querySelector(
          '[data-testid="openclaw-runtime-page"]',
        ),
      40,
      "OpenClaw 运行页未在预期时间内渲染",
    );

    await act(async () => {
      // 切换到快捷操作 tab
      findButton(mounted.container, "快捷操作").click();
      await flushEffects();
    });

    await act(async () => {
      findButton(mounted.container, "打开桌面面板").click();
      await flushEffects();
    });

    expect(mockHandleOpenDashboardWindow).toHaveBeenCalledTimes(1);
  });

  it("智能升级前会自动切到检测到 OpenClaw 的执行环境", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "ok",
        openclawVersion: "2026.3.8",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        summary: "OpenClaw 已安装。",
      }),
    );
    mockDetectDesktopPlatform.mockReturnValue("macos");
    mockListRuntimeCandidates.mockResolvedValue([
      {
        id: "node-without-openclaw",
        source: "PhpWebStudy",
        binDir: "/Users/demo/Library/PhpWebStudy/env/node/bin",
        nodePath: "/Users/demo/Library/PhpWebStudy/env/node/bin/node",
        nodeVersion: "22.12.0",
        npmPath: "/Users/demo/Library/PhpWebStudy/env/node/bin/npm",
        npmGlobalPrefix: "/Users/demo/Library/PhpWebStudy/env/node",
        openclawPath: null,
        openclawVersion: null,
        openclawPackagePath: null,
        isActive: true,
        isPreferred: false,
      },
      {
        id: "node-with-openclaw",
        source: "nvm",
        binDir: "/Users/demo/.nvm/versions/node/v23.4.0/bin",
        nodePath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/node",
        nodeVersion: "23.4.0",
        npmPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/npm",
        npmGlobalPrefix: "/Users/demo/.nvm/versions/node/v23.4.0",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        openclawVersion: "2026.3.8",
        openclawPackagePath:
          "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json",
        isActive: false,
        isPreferred: false,
      },
    ]);

    const mounted = renderPage();
    await flushEffects();

    await waitForCondition(
      () =>
        !!mounted.container.querySelector(
          '[data-testid="openclaw-runtime-page"]',
        ),
      40,
      "OpenClaw 运行页未在预期时间内渲染",
    );

    await act(async () => {
      findButton(mounted.container, "触发升级").click();
      await flushEffects();
    });
    await flushInstallTimer();

    await waitForCondition(
      () =>
        mockSetPreferredRuntime.mock.calls.some(
          ([runtimeId]) => runtimeId === "node-with-openclaw",
        ),
      40,
      "升级前未自动切换到检测到 OpenClaw 的执行环境",
    );
    expect(mockPerformUpdate).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).toHaveBeenCalledWith(
      "已自动切换到检测到 OpenClaw 的执行环境。",
      expect.objectContaining({
        description: expect.stringContaining("OpenClaw 2026.3.8"),
      }),
    );
  });

  it("升级后若运行中仍是旧版本应显示 warning 而不是默认 success", async () => {
    mockGetEnvironmentStatus.mockResolvedValue(
      buildEnvironmentStatus({
        nodeStatus: "ok",
        gitStatus: "ok",
        openclawStatus: "ok",
        openclawVersion: "2026.3.13-zh.1",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        summary: "OpenClaw 已安装。",
      }),
    );
    mockDetectDesktopPlatform.mockReturnValue("macos");
    mockGetStatus.mockResolvedValue({ status: "running", port: 18790 });
    mockCheckHealth.mockResolvedValue({
      status: "healthy",
      gatewayPort: 18790,
      uptime: 20,
      version: "2026.3.8",
    });
    mockCheckUpdate.mockResolvedValue({
      hasUpdate: true,
      currentVersion: "2026.3.13",
      latestVersion: "2026.3.13",
      channel: "stable",
      installKind: "package",
      packageManager: "pnpm",
      message: null,
    });
    mockListRuntimeCandidates.mockResolvedValue([
      {
        id: "node-with-openclaw",
        source: "nvm",
        binDir: "/Users/demo/.nvm/versions/node/v23.4.0/bin",
        nodePath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/node",
        nodeVersion: "23.4.0",
        npmPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/npm",
        npmGlobalPrefix: "/Users/demo/.nvm/versions/node/v23.4.0",
        openclawPath: "/Users/demo/.nvm/versions/node/v23.4.0/bin/openclaw",
        openclawVersion: "2026.3.13",
        openclawPackagePath:
          "/Users/demo/.nvm/versions/node/v23.4.0/lib/node_modules/@qingchencloud/openclaw-zh/package.json",
        isActive: true,
        isPreferred: false,
      },
    ]);

    const mounted = renderPage();
    await flushEffects();

    await waitForCondition(
      () =>
        !!mounted.container.querySelector(
          '[data-testid="openclaw-runtime-page"]',
        ),
      40,
      "OpenClaw 运行页未在预期时间内渲染",
    );

    await act(async () => {
      findButton(mounted.container, "触发升级").click();
      await flushEffects();
    });
    await flushInstallTimer();

    await waitForCondition(
      () => mockPerformUpdate.mock.calls.length > 0,
      40,
      "未触发升级接口",
    );

    expect(mockToastWarning).toHaveBeenCalledWith(
      "新版本已经安装，但当前仍在运行旧版 Gateway。",
      expect.objectContaining({
        description: expect.stringContaining("当前运行中 2026.3.8"),
      }),
    );
    expect(mockToastSuccess).not.toHaveBeenCalledWith("ok");
  });
});
