import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LAST_PROJECT_ID_KEY } from "./agentProjectStorage";
import { useWorkspaceProjectSelection } from "./useWorkspaceProjectSelection";

interface HookHarness {
  getValue: () => ReturnType<typeof useWorkspaceProjectSelection>;
  rerender: (props?: {
    externalProjectId?: string | null;
    newChatAt?: number;
  }) => void;
  unmount: () => void;
}

function mountHook(
  initialProps: {
    externalProjectId?: string | null;
    newChatAt?: number;
  } = {},
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useWorkspaceProjectSelection> | null = null;

  function TestComponent(props: {
    externalProjectId?: string | null;
    newChatAt?: number;
  }) {
    hookValue = useWorkspaceProjectSelection(props);
    return null;
  }

  const render = (props?: {
    externalProjectId?: string | null;
    newChatAt?: number;
  }) => {
    act(() => {
      root.render(<TestComponent {...props} />);
    });
  };

  render(initialProps);

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useWorkspaceProjectSelection", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("应在新会话请求未处理前屏蔽最近项目恢复", () => {
    localStorage.setItem(LAST_PROJECT_ID_KEY, JSON.stringify("project-local"));
    const harness = mountHook({
      newChatAt: 123,
    });

    try {
      expect(harness.getValue().projectId).toBeUndefined();
      expect(harness.getValue().shouldDisableSessionRestore).toBe(true);

      act(() => {
        harness.getValue().markNewChatRequestHandled("123");
        harness.getValue().applyProjectSelection(null);
      });

      expect(harness.getValue().projectId).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });

  it("应统一处理项目选择与最近项目记忆", () => {
    const harness = mountHook();

    try {
      act(() => {
        harness.getValue().applyProjectSelection("project-a");
      });

      expect(harness.getValue().projectId).toBe("project-a");
      expect(harness.getValue().getRememberedProjectId()).toBe("project-a");

      act(() => {
        harness.getValue().resetProjectSelection();
      });

      expect(harness.getValue().projectId).toBeUndefined();
      expect(harness.getValue().getRememberedProjectId()).toBe("project-a");
    } finally {
      harness.unmount();
    }
  });

  it("应在项目切换完成后恢复待执行的任务切换", () => {
    const harness = mountHook();

    try {
      expect(harness.getValue().startTopicProjectResolution()).toBe(true);
      expect(harness.getValue().startTopicProjectResolution()).toBe(false);

      act(() => {
        harness.getValue().deferTopicSwitch("topic-1", "project-target");
      });

      expect(harness.getValue().projectId).toBe("project-target");
      expect(
        harness.getValue().consumePendingTopicSwitch("project-other"),
      ).toBeNull();
      expect(
        harness.getValue().consumePendingTopicSwitch("project-target"),
      ).toEqual({
        topicId: "topic-1",
        targetProjectId: "project-target",
      });

      harness.getValue().finishTopicProjectResolution();
      expect(harness.getValue().startTopicProjectResolution()).toBe(true);
    } finally {
      harness.unmount();
    }
  });

  it("有外部项目锁定时不应覆盖当前项目选择", () => {
    const harness = mountHook({
      externalProjectId: "project-external",
    });

    try {
      expect(harness.getValue().projectId).toBe("project-external");

      act(() => {
        harness.getValue().applyProjectSelection("project-local");
      });

      expect(harness.getValue().projectId).toBe("project-external");
      expect(harness.getValue().getRememberedProjectId()).toBeNull();
    } finally {
      harness.unmount();
    }
  });
});
