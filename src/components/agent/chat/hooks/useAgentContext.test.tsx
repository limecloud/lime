import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNotifyProjectRuntimeAgentsGuide,
  mockSetSessionExecutionStrategy,
  mockSetSessionProviderSelection,
  mockTopicsUpdater,
  mockToastError,
  mockUpdateProject,
  mockWechatChannelSetRuntimeModel,
} = vi.hoisted(() => ({
  mockNotifyProjectRuntimeAgentsGuide: vi.fn(),
  mockSetSessionExecutionStrategy: vi.fn(async () => undefined),
  mockSetSessionProviderSelection: vi.fn(async () => undefined),
  mockTopicsUpdater: vi.fn(),
  mockToastError: vi.fn(),
  mockUpdateProject: vi.fn(async () => undefined),
  mockWechatChannelSetRuntimeModel: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
  },
}));

vi.mock("@/lib/api/project", () => ({
  updateProject: mockUpdateProject,
}));

vi.mock("@/components/workspace/services/runtimeAgentsGuideService", () => ({
  notifyProjectRuntimeAgentsGuide: mockNotifyProjectRuntimeAgentsGuide,
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  wechatChannelSetRuntimeModel: mockWechatChannelSetRuntimeModel,
}));

import { useAgentContext } from "./useAgentContext";
import { loadPersistedSessionWorkspaceId } from "./agentProjectStorage";

interface HookHarness {
  getValue: () => ReturnType<typeof useAgentContext>;
  unmount: () => void;
  sendMessage: ReturnType<typeof vi.fn>;
}

function mountHook(
  workspaceId = "workspace-1",
  sessionId: string | null = null,
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const sendMessage = vi.fn(async () => undefined);
  let hookValue: ReturnType<typeof useAgentContext> | null = null;

  function TestComponent() {
    hookValue = useAgentContext({
      workspaceId,
      sessionIdRef: { current: sessionId },
      topicsUpdaterRef: { current: mockTopicsUpdater },
      sendMessageRef: { current: sendMessage },
      runtime: {
        setSessionExecutionStrategy: mockSetSessionExecutionStrategy,
        setSessionProviderSelection: mockSetSessionProviderSelection,
      },
    });
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    sendMessage,
  };
}

describe("useAgentContext", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          invoke?: () => Promise<void>;
        };
      }
    ).__TAURI_INTERNALS__ = {
      invoke: async () => undefined,
    };
    mockNotifyProjectRuntimeAgentsGuide.mockReset();
    mockSetSessionExecutionStrategy.mockClear();
    mockSetSessionProviderSelection.mockClear();
    mockTopicsUpdater.mockReset();
    mockToastError.mockReset();
    mockUpdateProject.mockReset();
    mockWechatChannelSetRuntimeModel.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    delete (
      window as Window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__;
    document.body.innerHTML = "";
  });

  it("未命中持久化配置时应默认使用完全访问", async () => {
    const harness = mountHook("workspace-default-access");

    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.getValue().accessMode).toBe("full-access");
    expect(
      JSON.parse(
        localStorage.getItem("aster_access_mode_workspace-default-access") ||
          "null",
      ),
    ).toBe("full-access");

    harness.unmount();
  });

  it("切换 provider 和 model 时应同步微信运行时模型", async () => {
    const harness = mountHook();

    await act(async () => {
      harness.getValue().setProviderType("deepseek");
      harness.getValue().setModel("deepseek-reasoner");
      await Promise.resolve();
    });

    expect(mockWechatChannelSetRuntimeModel).toHaveBeenCalledWith({
      providerId: "deepseek",
      modelId: "deepseek-reasoner",
    });

    harness.unmount();
  });

  it("当前会话切换 provider/model 时应合并回写 session provider/model", async () => {
    const harness = mountHook("workspace-1", "session-1");

    await act(async () => {
      harness.getValue().setProviderType("deepseek");
      harness.getValue().setModel("deepseek-reasoner");
      await Promise.resolve();
    });

    expect(mockSetSessionProviderSelection).toHaveBeenCalledTimes(1);
    expect(mockSetSessionProviderSelection).toHaveBeenCalledWith(
      "session-1",
      "deepseek",
      "deepseek-reasoner",
    );
    expect(
      harness.getValue().getSyncedSessionModelPreference("session-1"),
    ).toEqual({
      providerType: "deepseek",
      model: "deepseek-reasoner",
    });

    harness.unmount();
  });

  it("当前会话连续切换执行策略时应批量回写 session 并同步话题快照", async () => {
    const harness = mountHook("workspace-1", "session-1");

    await act(async () => {
      harness.getValue().setExecutionStrategy("auto");
      harness.getValue().setExecutionStrategy("code_orchestrated");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetSessionExecutionStrategy).toHaveBeenCalledTimes(1);
    expect(mockSetSessionExecutionStrategy).toHaveBeenCalledWith(
      "session-1",
      "code_orchestrated",
    );
    expect(mockTopicsUpdater).toHaveBeenCalledWith(
      "session-1",
      "code_orchestrated",
    );
    expect(
      harness.getValue().getSyncedSessionExecutionStrategy("session-1"),
    ).toBe("code_orchestrated");
    expect(
      JSON.parse(
        localStorage.getItem("aster_execution_strategy_workspace-1") || "null",
      ),
    ).toBe("code_orchestrated");

    harness.unmount();
  });

  it("无当前会话时切换执行策略应只更新影子缓存", async () => {
    const harness = mountHook("workspace-shadow");

    await act(async () => {
      harness.getValue().setExecutionStrategy("auto");
      await Promise.resolve();
    });

    expect(mockSetSessionExecutionStrategy).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        localStorage.getItem("aster_execution_strategy_workspace-shadow") ||
          "null",
      ),
    ).toBe("auto");

    harness.unmount();
  });

  it("过滤会话时应优先使用 runtime workspace_id 并回填影子缓存", () => {
    localStorage.setItem(
      "agent_session_workspace_session-runtime-current",
      JSON.stringify("workspace-stale"),
    );
    localStorage.setItem(
      "agent_session_workspace_session-runtime-other",
      JSON.stringify("workspace-1"),
    );

    const harness = mountHook("workspace-1");

    expect(
      harness
        .getValue()
        .filterSessionsByWorkspace([
          {
            id: "session-runtime-current",
            workspace_id: "workspace-1",
          },
          {
            id: "session-runtime-other",
            workspace_id: "workspace-2",
          },
          {
            id: "session-legacy-fallback",
          },
        ])
        .map((session) => session.id),
    ).toEqual(["session-runtime-current", "session-legacy-fallback"]);
    expect(loadPersistedSessionWorkspaceId("session-runtime-current")).toBe(
      "workspace-1",
    );
    expect(loadPersistedSessionWorkspaceId("session-runtime-other")).toBe(
      "workspace-2",
    );

    harness.unmount();
  });

  it("修复目录并重试时应触发运行时 AGENTS 引导", async () => {
    const harness = mountHook();

    act(() => {
      harness.getValue().setWorkspacePathMissing({
        content: "继续上次对话",
        images: [],
      });
    });

    await act(async () => {
      await harness
        .getValue()
        .fixWorkspacePathAndRetry("/tmp/workspace-linked");
    });

    expect(mockUpdateProject).toHaveBeenCalledWith("workspace-1", {
      rootPath: "/tmp/workspace-linked",
    });
    expect(mockNotifyProjectRuntimeAgentsGuide).toHaveBeenCalledWith(
      {
        id: "workspace-1",
        rootPath: "/tmp/workspace-linked",
      },
      {
        successMessage: "工作区目录已重新关联",
        showSuccessWhenGuideAlreadySeen: false,
      },
    );
    expect(harness.sendMessage).toHaveBeenCalledWith(
      "继续上次对话",
      [],
      false,
      false,
      true,
    );

    harness.unmount();
  });
});
