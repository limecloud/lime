import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenClawDependencyStatus,
  OpenClawEnvironmentStatus,
} from "@/lib/api/openclaw";
import { OpenClawInstallPage } from "./OpenClawInstallPage";

vi.mock("./OpenClawMark", () => ({
  OpenClawMark: () => <div data-testid="openclaw-mark" />,
}));

type OpenClawInstallPageProps = Parameters<typeof OpenClawInstallPage>[0];

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

function buildDependencyStatus(
  overrides: Partial<OpenClawDependencyStatus>,
): OpenClawDependencyStatus {
  return {
    status: "ok",
    version: "22.12.0",
    path: "/usr/local/bin/tool",
    message: "已就绪",
    autoInstallSupported: true,
    ...overrides,
  };
}

function buildEnvironmentStatus(options?: {
  node?: Partial<OpenClawDependencyStatus>;
  git?: Partial<OpenClawDependencyStatus>;
  openclaw?: Partial<OpenClawDependencyStatus>;
  summary?: string;
  diagnostics?: OpenClawEnvironmentStatus["diagnostics"];
}): OpenClawEnvironmentStatus {
  return {
    node: buildDependencyStatus(options?.node ?? {}),
    git: buildDependencyStatus({
      version: "2.44.0",
      path: "/usr/bin/git",
      ...options?.git,
    }),
    openclaw: buildDependencyStatus({
      path: "/usr/local/bin/openclaw",
      autoInstallSupported: false,
      ...options?.openclaw,
    }),
    recommendedAction: "ready",
    summary: options?.summary ?? "环境已就绪。",
    diagnostics: options?.diagnostics,
    tempArtifacts: [],
  };
}

function renderPage(
  overrides?: Partial<OpenClawInstallPageProps>,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: OpenClawInstallPageProps = {
    environmentStatus: buildEnvironmentStatus(),
    runtimeCandidates: [],
    preferredRuntimeId: null,
    desktopPlatform: "macos",
    busy: false,
    switchingRuntime: false,
    installing: false,
    installingNode: false,
    installingGit: false,
    cleaningTemp: false,
    onInstall: () => {},
    onInstallNode: () => {},
    onInstallGit: () => {},
    onRefresh: () => {},
    onCleanupTemp: () => {},
    onOpenDocs: () => {},
    onDownloadNode: () => {},
    onDownloadGit: () => {},
    onSelectPreferredRuntime: () => {},
  };

  act(() => {
    root.render(<OpenClawInstallPage {...defaultProps} {...overrides} />);
  });

  mountedRoots.push({ container, root });
  return container;
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

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }

    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }

  vi.clearAllMocks();
});

describe("OpenClawInstallPage", () => {
  it("Windows 缺依赖时应阻止直接安装 OpenClaw", () => {
    const container = renderPage({
      desktopPlatform: "windows",
      environmentStatus: buildEnvironmentStatus({
        node: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 Node.js，需要安装 22.12.0+。",
          autoInstallSupported: false,
        },
        git: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 Git。",
          autoInstallSupported: false,
        },
        openclaw: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 OpenClaw。",
          autoInstallSupported: false,
        },
        summary: "Windows 下请先手动安装依赖。",
      }),
    });

    const blockedButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((button) =>
      button.textContent?.includes("请先安装 Node.js / Git"),
    );

    expect(blockedButtons.length).toBeGreaterThan(0);
    expect(
      blockedButtons.every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(container.textContent).toContain(
      "Windows 下请先手动安装 Node.js / Git，完成后点击“重新检测”，再安装 OpenClaw。",
    );
  });

  it("macOS 缺依赖时仍允许一键修复并继续安装", () => {
    const container = renderPage({
      desktopPlatform: "macos",
      environmentStatus: buildEnvironmentStatus({
        node: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 Node.js，需要安装 22.12.0+。",
          autoInstallSupported: true,
        },
        git: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 Git。",
          autoInstallSupported: true,
        },
        openclaw: {
          status: "missing",
          version: null,
          path: null,
          message: "未检测到 OpenClaw。",
          autoInstallSupported: false,
        },
      }),
    });

    const repairButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("一键修复环境并安装 OpenClaw"),
    );

    expect(repairButton).toBeTruthy();
    expect(repairButton?.hasAttribute("disabled")).toBe(false);
    expect(container.textContent).not.toContain("Windows 下请先手动安装");
  });

  it("检测到 OpenClaw 包但命令待生效时应提示先重新检测", () => {
    const container = renderPage({
      desktopPlatform: "windows",
      environmentStatus: buildEnvironmentStatus({
        node: {
          status: "ok",
          version: "22.12.0",
          path: "C:/Program Files/nodejs/node.exe",
          message: "Node.js 已就绪：22.12.0",
          autoInstallSupported: false,
        },
        git: {
          status: "ok",
          version: "2.44.0",
          path: "C:/Program Files/Git/cmd/git.exe",
          message: "Git 已就绪：2.44.0",
          autoInstallSupported: false,
        },
        openclaw: {
          status: "needs_reload",
          version: "0.4.1",
          path: "C:/Users/demo/AppData/Roaming/npm",
          message:
            "已在 npm 全局目录检测到 openclaw（0.4.1），但当前进程尚未解析到 openclaw 命令。",
          autoInstallSupported: false,
        },
        summary: "已检测到 OpenClaw 包，但命令尚未生效；请点击“重新检测”。",
        diagnostics: {
          npmPath: "C:/Program Files/nodejs/npm.cmd",
          npmGlobalPrefix: "C:/Users/demo/AppData/Roaming/npm",
          openclawPackagePath:
            "C:/Users/demo/AppData/Roaming/npm/node_modules/openclaw/package.json",
          whereCandidates: [],
          supplementalSearchDirs: ["C:/Users/demo/AppData/Roaming/npm"],
          supplementalCommandCandidates: [
            "C:/Users/demo/AppData/Roaming/npm/openclaw.cmd",
          ],
          gitWhereCandidates: ["C:/Program Files/Git/cmd/git.exe"],
          gitSupplementalSearchDirs: [
            "C:/Program Files/Git/cmd",
            "C:/Program Files/Git/bin",
          ],
          gitSupplementalCommandCandidates: [
            "C:/Program Files/Git/cmd/git.exe",
          ],
        },
      }),
    });

    const blockedButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("请先重新检测 OpenClaw"));

    expect(blockedButtons.length).toBeGreaterThan(0);
    expect(
      blockedButtons.every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(container.textContent).toContain("待刷新");
    expect(container.textContent).toContain(
      "已检测到 OpenClaw 包，但命令尚未生效。请先点击“重新检测”；若仍失败，请重启 Lime 后再试。",
    );
    expect(container.textContent).toContain("检测诊断");
    expect(container.textContent).toContain("C:/Program Files/nodejs/npm.cmd");
    expect(container.textContent).toContain("~/AppData/Roaming/npm");

    act(() => {
      findButton(container, "查看详细诊断").click();
    });

    expect(container.textContent).toContain("收起详细诊断");
    expect(container.textContent).toContain(
      "C:/Users/demo/AppData/Roaming/npm/openclaw.cmd",
    );
    expect(container.textContent).toContain("`where git` 命中");
    expect(container.textContent).toContain("C:/Program Files/Git/cmd/git.exe");
  });

  it("长路径应在执行环境与诊断摘要中压缩显示，并通过折叠入口展开详情", () => {
    const runtimeNodePath =
      "/Users/demo/Library/Application Support/lime/runtime/node/versions/very-long-version/bin/node";
    const diagnosticsNpmPath =
      "/Users/demo/Library/Application Support/lime/runtime/npm/prefix/very-long-segment/bin/npm";

    const container = renderPage({
      environmentStatus: buildEnvironmentStatus({
        diagnostics: {
          npmPath: diagnosticsNpmPath,
          npmGlobalPrefix:
            "/Users/demo/Library/Application Support/lime/runtime/npm/prefix/very-long-segment",
          openclawPackagePath:
            "/Users/demo/Library/Application Support/lime/runtime/openclaw/node_modules/@qingchencloud/openclaw-zh/package.json",
          whereCandidates: [],
          supplementalSearchDirs: [],
          supplementalCommandCandidates: [],
          gitWhereCandidates: [],
          gitSupplementalSearchDirs: [],
          gitSupplementalCommandCandidates: [],
        },
      }),
      runtimeCandidates: [
        {
          id: "runtime-demo",
          source: "nvm",
          binDir:
            "/Users/demo/Library/Application Support/lime/runtime/node/versions/very-long-version/bin",
          nodePath: runtimeNodePath,
          nodeVersion: "22.12.0",
          npmPath:
            "/Users/demo/Library/Application Support/lime/runtime/node/versions/very-long-version/bin/npm",
          npmGlobalPrefix:
            "/Users/demo/Library/Application Support/lime/runtime/npm/prefix/very-long-segment",
          openclawPath:
            "/Users/demo/Library/Application Support/lime/runtime/node/versions/very-long-version/bin/openclaw",
          openclawVersion: "2026.3.18",
          openclawPackagePath:
            "/Users/demo/Library/Application Support/lime/runtime/openclaw/node_modules/@qingchencloud/openclaw-zh/package.json",
          isActive: true,
          isPreferred: false,
        },
      ],
    });

    const titledElements = Array.from(container.querySelectorAll("[title]"));
    const runtimeSummary = titledElements.find(
      (item) => item.getAttribute("title") === runtimeNodePath,
    );
    const diagnosticsSummary = titledElements.find(
      (item) => item.getAttribute("title") === diagnosticsNpmPath,
    );

    expect(runtimeSummary?.textContent).toContain("...");
    expect(runtimeSummary?.textContent).not.toBe(runtimeNodePath);
    expect(diagnosticsSummary?.textContent).toContain("...");
    expect(diagnosticsSummary?.textContent).not.toBe(diagnosticsNpmPath);

    act(() => {
      findButton(container, "查看详情").click();
    });
    expect(container.textContent).toContain("收起详情");

    act(() => {
      findButton(container, "查看详细诊断").click();
    });
    expect(container.textContent).toContain("收起详细诊断");
  });
});
