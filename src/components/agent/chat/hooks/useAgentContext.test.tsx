import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockNotifyProjectRuntimeAgentsGuide,
  mockSetSessionExecutionStrategy,
  mockToastError,
  mockUpdateProject,
} = vi.hoisted(() => ({
  mockNotifyProjectRuntimeAgentsGuide: vi.fn(),
  mockSetSessionExecutionStrategy: vi.fn(async () => undefined),
  mockToastError: vi.fn(),
  mockUpdateProject: vi.fn(async () => undefined),
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

import { useAgentContext } from "./useAgentContext";

interface HookHarness {
  getValue: () => ReturnType<typeof useAgentContext>;
  unmount: () => void;
  sendMessage: ReturnType<typeof vi.fn>;
}

function mountHook(workspaceId = "workspace-1"): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const sendMessage = vi.fn(async () => undefined);
  let hookValue: ReturnType<typeof useAgentContext> | null = null;

  function TestComponent() {
    hookValue = useAgentContext({
      workspaceId,
      sessionIdRef: { current: null },
      topicsUpdaterRef: { current: null },
      sendMessageRef: { current: sendMessage },
      runtime: {
        setSessionExecutionStrategy: mockSetSessionExecutionStrategy,
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
    mockToastError.mockReset();
    mockUpdateProject.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
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
