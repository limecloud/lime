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
  mockDetectDesktopPlatform,
  mockOpenUrl,
  mockInstall,
  mockInstallDependency,
  mockGetEnvironmentStatus,
  mockGetStatus,
  mockCheckUpdate,
  mockPerformUpdate,
  mockGetNodeDownloadUrl,
  mockGetGitDownloadUrl,
  mockListenInstallProgress,
  mockGetProgressLogs,
  mockInstallPageRender,
  mockRefreshDashboardUrl,
  mockRefreshDashboardWindowState,
} = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockDetectDesktopPlatform: vi.fn(),
  mockOpenUrl: vi.fn(),
  mockInstall: vi.fn(),
  mockInstallDependency: vi.fn(),
  mockGetEnvironmentStatus: vi.fn(),
  mockGetStatus: vi.fn(),
  mockCheckUpdate: vi.fn(),
  mockPerformUpdate: vi.fn(),
  mockGetNodeDownloadUrl: vi.fn(),
  mockGetGitDownloadUrl: vi.fn(),
  mockListenInstallProgress: vi.fn(),
  mockGetProgressLogs: vi.fn(),
  mockInstallPageRender: vi.fn(),
  mockRefreshDashboardUrl: vi.fn(),
  mockRefreshDashboardWindowState: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: vi.fn(),
    warning: vi.fn(),
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
    checkHealth: vi.fn(),
    getChannels: vi.fn(),
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
    handleOpenDashboardWindow: vi.fn(),
    handleOpenDashboardExternal: vi.fn(),
    closeDashboardWindowSilently: vi.fn(),
  }),
}));

vi.mock("./useOpenClawStore", () => {
  const store = {
    selectedProviderId: null as string | null,
    selectedModelId: "",
    gatewayPort: 18790,
    lastSynced: null,
    setSelectedProviderId: vi.fn(),
    setSelectedModelId: vi.fn(),
    setGatewayPort: vi.fn(),
    setLastSynced: vi.fn(),
    clearLastSynced: vi.fn(),
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
  OpenClawRuntimePage: () => <div data-testid="openclaw-runtime-page" />,
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
      version: nodeStatus === "ok" ? "22.0.0" : null,
      path: nodeStatus === "ok" ? "C:/Program Files/nodejs/node.exe" : null,
      message:
        nodeStatus === "ok"
          ? "Node.js 已就绪：22.0.0"
          : "未检测到 Node.js，需要安装 22.0.0+。",
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

function renderPage() {
  return renderIntoDom(<OpenClawPage isActive />, mountedRoots);
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
  mockGetNodeDownloadUrl.mockResolvedValue("https://nodejs.org/en/download");
  mockGetGitDownloadUrl.mockResolvedValue("https://git-scm.com/download/win");
  mockListenInstallProgress.mockResolvedValue(() => {});
  mockGetProgressLogs.mockResolvedValue([]);
  mockInstall.mockResolvedValue({ success: true, message: "ok" });
  mockInstallDependency.mockResolvedValue({ success: true, message: "ok" });
  mockPerformUpdate.mockResolvedValue({ success: true, message: "ok" });
  mockRefreshDashboardUrl.mockResolvedValue(null);
  mockRefreshDashboardWindowState.mockResolvedValue(false);
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  vi.clearAllMocks();
});

describe("OpenClawPage", () => {
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
    expect(mockOpenUrl).toHaveBeenCalledWith("https://git-scm.com/download/win");
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
          "已在 npm 全局目录检测到 openclaw（0.4.1），但当前进程尚未解析到 openclaw 命令。请点击“重新检测”；若仍失败，请重启 ProxyCast。",
        summary:
          "已检测到 OpenClaw 包，但命令尚未生效；请点击“重新检测”。",
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
      "已在 npm 全局目录检测到 openclaw（0.4.1），但当前进程尚未解析到 openclaw 命令。请点击“重新检测”；若仍失败，请重启 ProxyCast。",
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
});
