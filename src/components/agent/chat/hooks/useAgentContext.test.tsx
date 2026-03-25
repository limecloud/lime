import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNotifyProjectRuntimeAgentsGuide,
  mockSetSessionExecutionStrategy,
  mockSetSessionProviderSelection,
  mockToastError,
  mockUpdateProject,
  mockWechatChannelSetRuntimeModel,
} = vi.hoisted(() => ({
  mockNotifyProjectRuntimeAgentsGuide: vi.fn(),
  mockSetSessionExecutionStrategy: vi.fn(async () => undefined),
  mockSetSessionProviderSelection: vi.fn(async () => undefined),
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
      topicsUpdaterRef: { current: null },
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
    mockNotifyProjectRuntimeAgentsGuide.mockReset();
    mockSetSessionExecutionStrategy.mockClear();
    mockSetSessionProviderSelection.mockClear();
    mockToastError.mockReset();
    mockUpdateProject.mockReset();
    mockWechatChannelSetRuntimeModel.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
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
