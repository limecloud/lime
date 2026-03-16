import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserRuntimeWorkspace } from "./BrowserRuntimeWorkspace";

const { mockGetChromeProfileSessions, mockGetExistingSessionBridgeStatus } =
  vi.hoisted(() => ({
    mockGetChromeProfileSessions: vi.fn(),
    mockGetExistingSessionBridgeStatus: vi.fn(),
  }));

vi.mock("@/lib/webview-api", () => ({
  getChromeProfileSessions: mockGetChromeProfileSessions,
}));

vi.mock("./existingSessionBridgeClient", () => ({
  getExistingSessionBridgeStatus: mockGetExistingSessionBridgeStatus,
}));

vi.mock("./BrowserRuntimeDebugPanel", () => ({
  BrowserRuntimeDebugPanel: ({
    sessions,
    onMessage,
  }: {
    sessions: Array<{ profile_key: string }>;
    onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  }) => (
    <div data-testid="browser-runtime-debug-panel">
      <span>{sessions.length}</span>
      <button
        type="button"
        data-testid="emit-browser-runtime-error"
        onClick={() =>
          onMessage?.({
            type: "error",
            text: "读取 CDP 标签页失败: 没有可用的 Chrome profile 会话",
          })
        }
      >
        emit
      </button>
    </div>
  ),
}));

vi.mock("./BrowserProfileManager", () => ({
  BrowserProfileManager: ({
    onMessage,
  }: {
    onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  }) => (
    <div data-testid="browser-profile-manager">
      <button
        type="button"
        data-testid="emit-browser-profile-success"
        onClick={() =>
          onMessage?.({
            type: "success",
            text: "已创建资料：美区电商账号",
          })
        }
      >
        emit
      </button>
    </div>
  ),
}));

vi.mock("./BrowserEnvironmentPresetManager", () => ({
  BrowserEnvironmentPresetManager: ({
    onMessage,
  }: {
    onMessage?: (message: { type: "success" | "error"; text: string }) => void;
  }) => (
    <div data-testid="browser-environment-manager">
      <button
        type="button"
        data-testid="emit-browser-environment-success"
        onClick={() =>
          onMessage?.({
            type: "success",
            text: "已创建环境预设：美区桌面",
          })
        }
      >
        emit
      </button>
    </div>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockGetChromeProfileSessions.mockResolvedValue([]);
  mockGetExistingSessionBridgeStatus.mockResolvedValue({
    observer_count: 0,
    control_count: 0,
    pending_command_count: 0,
    observers: [],
    controls: [],
    pending_commands: [],
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

async function renderWorkspace() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(<BrowserRuntimeWorkspace />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

async function renderWorkspaceWithProps(
  props?: Partial<React.ComponentProps<typeof BrowserRuntimeWorkspace>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  await act(async () => {
    root.render(<BrowserRuntimeWorkspace {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe("BrowserRuntimeWorkspace", () => {
  it("渲染会话数量并把数据透传给调试面板", async () => {
    mockGetChromeProfileSessions.mockResolvedValueOnce([
      {
        profile_key: "search_google",
        browser_source: "system",
        browser_path: "/Applications/Google Chrome",
        profile_dir: "/tmp/profile",
        remote_debugging_port: 13001,
        pid: 12345,
        started_at: "2026-03-14T00:00:00Z",
        last_url: "https://example.com",
      },
    ]);
    mockGetExistingSessionBridgeStatus.mockResolvedValueOnce({
      observer_count: 2,
      control_count: 0,
      pending_command_count: 0,
      observers: [],
      controls: [],
      pending_commands: [],
    });

    const container = await renderWorkspace();
    expect(container.textContent).toContain("当前运行 Profile");
    expect(container.textContent).toContain("1");
    expect(container.textContent).toContain("当前附着 Chrome：");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain(
      "附着当前 Chrome 复用的是你正在使用的浏览器页面，不会额外创建独立实时会话。",
    );
    expect(
      container.querySelector("[data-testid='browser-profile-manager']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='browser-environment-manager']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='browser-runtime-debug-panel']")
        ?.textContent,
    ).toContain("1");
  });

  it("未激活时不应启动会话刷新或渲染调试面板", async () => {
    const container = await renderWorkspaceWithProps({ active: false });

    expect(mockGetChromeProfileSessions).not.toHaveBeenCalled();
    expect(mockGetExistingSessionBridgeStatus).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='browser-runtime-debug-panel']"),
    ).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("嵌入模式应占满父级高度且不再渲染独立标题区", async () => {
    const container = await renderWorkspaceWithProps({
      embedded: true,
      initialProfileKey: "general_browser_assist",
    });

    const shell = container.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain("h-full");
    expect(shell?.className).toContain("min-h-0");
    expect(shell?.className).toContain("flex-col");
    expect(container.textContent).not.toContain("浏览器实时会话");
    expect(
      container.querySelector("[data-testid='browser-profile-manager']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='browser-environment-manager']"),
    ).toBeNull();
  });

  it("嵌入模式错误消息应支持手动关闭，并抑制同类消息立即重复出现", async () => {
    const container = await renderWorkspaceWithProps({
      embedded: true,
      initialProfileKey: "general_browser_assist",
    });

    const emitButton = container.querySelector(
      "[data-testid='emit-browser-runtime-error']",
    ) as HTMLButtonElement | null;

    expect(emitButton).not.toBeNull();

    await act(async () => {
      emitButton?.click();
    });

    expect(container.textContent).toContain("读取 CDP 标签页失败");

    const closeButton = container.querySelector(
      'button[aria-label="关闭消息"]',
    ) as HTMLButtonElement | null;

    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.click();
    });

    expect(container.textContent).not.toContain("读取 CDP 标签页失败");

    await act(async () => {
      emitButton?.click();
    });

    expect(container.textContent).not.toContain("读取 CDP 标签页失败");
  });

  it("资料管理成功消息应复用工作台级提示条", async () => {
    const container = await renderWorkspace();

    const emitButton = container.querySelector(
      "[data-testid='emit-browser-profile-success']",
    ) as HTMLButtonElement | null;

    expect(emitButton).not.toBeNull();

    await act(async () => {
      emitButton?.click();
    });

    expect(container.textContent).toContain("已创建资料：美区电商账号");
  });

  it("环境预设成功消息应复用工作台级提示条", async () => {
    const container = await renderWorkspace();

    const emitButton = container.querySelector(
      "[data-testid='emit-browser-environment-success']",
    ) as HTMLButtonElement | null;

    expect(emitButton).not.toBeNull();

    await act(async () => {
      emitButton?.click();
    });

    expect(container.textContent).toContain("已创建环境预设：美区桌面");
  });
});
