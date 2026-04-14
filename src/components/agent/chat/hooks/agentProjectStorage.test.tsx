import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LAST_PROJECT_ID_KEY,
  getSessionWorkspaceStorageKey,
  loadPersistedProjectId,
  loadPersistedSessionWorkspaceId,
  loadStoredSessionWorkspaceIdRaw,
  savePersistedProjectId,
  savePersistedSessionWorkspaceId,
  usePersistedProjectId,
} from "./agentProjectStorage";

interface HookHarness {
  getValue: () => ReturnType<typeof usePersistedProjectId>;
  rerender: (externalProjectId?: string | null) => void;
  unmount: () => void;
}

function mountHook(initialExternalProjectId?: string | null): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof usePersistedProjectId> | null = null;

  function TestComponent({
    externalProjectId,
  }: {
    externalProjectId?: string | null;
  }) {
    hookValue = usePersistedProjectId(externalProjectId);
    return null;
  }

  const render = (externalProjectId?: string | null) => {
    act(() => {
      root.render(<TestComponent externalProjectId={externalProjectId} />);
    });
  };

  render(initialExternalProjectId);

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

describe("agentProjectStorage", () => {
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

  it("应保存并读取最近项目偏好", () => {
    savePersistedProjectId(LAST_PROJECT_ID_KEY, "project-a");

    expect(loadPersistedProjectId(LAST_PROJECT_ID_KEY)).toBe("project-a");
  });

  it("应保存并读取会话绑定工作区影子缓存", () => {
    savePersistedSessionWorkspaceId("session-a", "project-a");

    expect(getSessionWorkspaceStorageKey("session-a")).toBe(
      "agent_session_workspace_session-a",
    );
    expect(loadPersistedSessionWorkspaceId("session-a")).toBe("project-a");
  });

  it("legacy 会话工作区影子缓存应保留原始值供治理判断，但 current 读取应归一为空", () => {
    localStorage.setItem(
      "agent_session_workspace_session-legacy",
      JSON.stringify("workspace-default"),
    );

    expect(loadStoredSessionWorkspaceIdRaw("session-legacy")).toBe(
      "workspace-default",
    );
    expect(loadPersistedSessionWorkspaceId("session-legacy")).toBeNull();
  });

  it("hook 应优先使用 externalProjectId，否则回退最近项目", () => {
    savePersistedProjectId(LAST_PROJECT_ID_KEY, "project-local");

    const harness = mountHook();

    try {
      expect(harness.getValue().projectId).toBe("project-local");

      harness.rerender("project-external");
      expect(harness.getValue().projectId).toBe("project-external");

      act(() => {
        harness.getValue().setProjectId("project-updated");
        harness.getValue().rememberProjectId("project-updated");
      });

      expect(harness.getValue().projectId).toBe("project-updated");
      expect(loadPersistedProjectId(LAST_PROJECT_ID_KEY)).toBe(
        "project-updated",
      );
    } finally {
      harness.unmount();
    }
  });
});
