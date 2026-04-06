import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useWorkflowInputState } from "./workflowInputState";

describe("useWorkflowInputState", () => {
  it("非内容主题工作台场景不应返回生成态与快捷动作", () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    let state: ReturnType<typeof useWorkflowInputState> | null = null;
    const container = document.createElement("div");
    const root = createRoot(container);

    function TestComponent() {
      state = useWorkflowInputState({
        isWorkspaceVariant: false,
        isSending: true,
      });
      return null;
    }

    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(state).not.toBeNull();
    expect(state!.workflowQuickActions).toEqual([]);
    expect(state!.workflowQueueItems).toEqual([]);
    expect(state!.renderWorkflowGeneratingPanel).toBe(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
