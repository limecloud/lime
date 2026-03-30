import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveBrowserAssistSessionScopeKey,
  resolveBrowserAssistSessionStorageKey,
} from "../utils/browserAssistSession";
import { buildBrowserAssistArtifact } from "./browserAssistArtifact";
import { useWorkspaceBrowserAssistRuntime } from "./useWorkspaceBrowserAssistRuntime";

const mockSiteRunAdapter = vi.fn();
const mockLaunchBrowserSession = vi.fn();
const mockBrowserExecuteAction = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-loading"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/webview-api", () => ({
  browserExecuteAction: (...args: unknown[]) =>
    mockBrowserExecuteAction(...args),
  launchBrowserSession: (...args: unknown[]) => mockLaunchBrowserSession(...args),
  siteRunAdapter: (...args: unknown[]) => mockSiteRunAdapter(...args),
}));

type HookProps = Parameters<typeof useWorkspaceBrowserAssistRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function createStreamingArtifact(): Artifact {
  return {
    id: "artifact-streaming-1",
    type: "document",
    title: "brief.md",
    content: "# Brief",
    status: "streaming",
    meta: {
      filePath: "brief.md",
      filename: "brief.md",
      writePhase: "streaming",
    },
    position: { start: 0, end: 7 },
    createdAt: 1,
    updatedAt: 2,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceBrowserAssistRuntime> | null =
    null;

  const defaultProps: HookProps = {
    activeTheme: "general",
    projectId: "workspace-1",
    sessionId: "session-1",
    input: "",
    initialUserPrompt: "",
    openBrowserAssistOnMount: false,
    artifacts: [],
    messages: [],
    setLayoutMode: vi.fn(),
    upsertGeneralArtifact: vi.fn(),
    generalBrowserAssistProfileKey: "general-browser",
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceBrowserAssistRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockSiteRunAdapter.mockReset();
  mockLaunchBrowserSession.mockReset();
  mockBrowserExecuteAction.mockReset();
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
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("useWorkspaceBrowserAssistRuntime", () => {
  it("初始站点技能载荷应在 Claw 工作区内直接执行且不被动展开画布", async () => {
    const setLayoutMode = vi.fn();
    const upsertGeneralArtifact = vi.fn();
    mockSiteRunAdapter.mockResolvedValue({
      ok: true,
      adapter: "github/search",
      domain: "github.com",
      profile_key: "attached-github",
      session_id: "session-browser-1",
      target_id: "target-1",
      entry_url: "https://github.com/search?q=browser+assist+mcp",
      source_url: "https://github.com/search?q=browser+assist+mcp",
      saved_content: {
        content_id: "content-current",
        project_id: "workspace-1",
        title: "GitHub 仓库线索",
      },
      saved_by: "context_content",
    });

    const { render, getValue } = renderHook({
      contentId: "content-current",
      initialSiteSkillLaunch: {
        adapterName: "github/search",
        args: {
          query: "browser assist mcp",
          limit: 10,
        },
        autoRun: true,
        profileKey: "attached-github",
        targetId: "tab-github",
        requireAttachedSession: true,
        skillTitle: "GitHub 仓库线索检索",
      },
      setLayoutMode,
      upsertGeneralArtifact,
    });

    await render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSiteRunAdapter).toHaveBeenCalledWith({
      adapter_name: "github/search",
      args: {
        query: "browser assist mcp",
        limit: 10,
      },
      profile_key: "attached-github",
      target_id: "tab-github",
      content_id: "content-current",
      project_id: "workspace-1",
      save_title: undefined,
      require_attached_session: true,
      skill_title: "GitHub 仓库线索检索",
    });
    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "browser-assist:general",
        type: "browser_assist",
        status: "complete",
      }),
    );
    expect(setLayoutMode).not.toHaveBeenCalled();
    expect(getValue().siteSkillExecutionState).toEqual(
      expect.objectContaining({
        phase: "success",
        adapterName: "github/search",
        skillTitle: "GitHub 仓库线索检索",
      }),
    );
  });

  it("恢复完成态 browser assist 会话时不应被动展开画布", async () => {
    const setLayoutMode = vi.fn();
    const scopeKey = resolveBrowserAssistSessionScopeKey(
      "workspace-1",
      "session-1",
    );
    const readyArtifact = buildBrowserAssistArtifact({
      scopeKey,
      profileKey: "general-browser",
      browserSessionId: "browser-session-1",
      url: "https://example.com",
      title: "浏览器协助",
    });
    const { render } = renderHook({
      artifacts: [readyArtifact],
      setLayoutMode,
    });

    await render();

    expect(setLayoutMode).not.toHaveBeenCalled();
  });

  it("普通产物处于流式写入时仍应自动展开画布", async () => {
    const setLayoutMode = vi.fn();
    const { render } = renderHook({
      artifacts: [createStreamingArtifact()],
      setLayoutMode,
    });

    await render();

    expect(setLayoutMode).toHaveBeenCalledWith("chat-canvas");
  });

  it("existing_session 启动失败时应回退到当前 Chrome 扩展桥接", async () => {
    mockBrowserExecuteAction.mockResolvedValue({
      success: true,
      action: "navigate",
      request_id: "req-1",
      target_id: "tab-attached",
      data: {
        page_info: {
          title: "GitHub",
          url: "https://github.com/",
          markdown: "# GitHub",
          updated_at: "2026-03-29T00:00:00Z",
        },
      },
      attempts: [],
    });

    const upsertGeneralArtifact = vi.fn();
    const { render, getValue } = renderHook({
      input: "https://github.com/",
      upsertGeneralArtifact,
    });

    await render();

    await act(async () => {
      await getValue().ensureBrowserAssistCanvas("https://github.com/", {
        navigationMode: "explicit-url",
        silent: true,
      });
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
    expect(mockBrowserExecuteAction).toHaveBeenCalledWith({
      profile_key: "general-browser",
      backend: "lime_extension_bridge",
      action: "navigate",
      args: {
        url: "https://github.com/",
        wait_for_page_info: true,
      },
      timeout_ms: 20000,
    });
    expect(getValue().browserAssistSessionState).toEqual(
      expect.objectContaining({
        profileKey: "general-browser",
        targetId: "tab-attached",
        url: "https://github.com/",
        title: "GitHub",
        transportKind: "existing_session",
      }),
    );
    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
      }),
    );
  });

  it("existing_session 已建立后再次导航失败时不应回退到 cdp_direct", async () => {
    mockBrowserExecuteAction.mockResolvedValueOnce({
      success: true,
      action: "navigate",
      request_id: "req-initial",
      target_id: "tab-attached",
      data: {
        page_info: {
          title: "GitHub",
          url: "https://github.com/",
          markdown: "# GitHub",
          updated_at: "2026-03-29T00:00:00Z",
        },
      },
      attempts: [],
    });

    const { render, getValue } = renderHook({
      input: "https://github.com/",
    });

    await render();

    await act(async () => {
      await getValue().ensureBrowserAssistCanvas("https://github.com/", {
        navigationMode: "explicit-url",
        silent: true,
      });
      await Promise.resolve();
    });

    mockBrowserExecuteAction.mockClear();
    mockBrowserExecuteAction.mockRejectedValueOnce(
      new Error("当前 Chrome bridge 暂时不可用"),
    );

    await act(async () => {
      await getValue().ensureBrowserAssistCanvas("https://github.com/features", {
        navigationMode: "explicit-url",
        silent: true,
      });
      await Promise.resolve();
    });

    expect(mockBrowserExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockBrowserExecuteAction).toHaveBeenCalledWith({
      profile_key: "general-browser",
      backend: "lime_extension_bridge",
      action: "navigate",
      args: {
        url: "https://github.com/features",
        wait_for_page_info: true,
      },
      timeout_ms: 20000,
    });
    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
  });

  it("限制为附着会话时不应回退拉起托管浏览器", async () => {
    mockBrowserExecuteAction.mockRejectedValue(
      new Error("没有可用的 Chrome observer 连接"),
    );

    const upsertGeneralArtifact = vi.fn();
    const { render, getValue } = renderHook({
      input: "https://github.com/",
      initialSiteSkillLaunch: {
        adapterName: "github/search",
        profileKey: "attached-github",
        requireAttachedSession: true,
        preferredBackend: "lime_extension_bridge",
        autoLaunch: false,
      },
      upsertGeneralArtifact,
    });

    await render();

    await act(async () => {
      await getValue().ensureBrowserAssistCanvas("https://github.com/", {
        navigationMode: "explicit-url",
        silent: true,
      });
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
    expect(upsertGeneralArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
      }),
    );
  });

  it("只有 transient 恢复态时不应自动补拉旧浏览器会话", async () => {
    const storageKey = resolveBrowserAssistSessionStorageKey(
      "workspace-1",
      "session-1",
    );
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        profileKey: "general-browser",
        url: "https://www.google.com/",
        title: "浏览器协助",
        updatedAt: Date.now(),
      }),
    );

    const { render, getValue } = renderHook();
    await render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLaunchBrowserSession).not.toHaveBeenCalled();
    expect(mockBrowserExecuteAction).not.toHaveBeenCalled();
    expect(getValue().browserAssistSessionState).toEqual(
      expect.objectContaining({
        profileKey: "general-browser",
        url: "https://www.google.com/",
      }),
    );
  });
});
