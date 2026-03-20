import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useThemeWorkbenchInputState } from "./useThemeWorkbenchInputState";

describe("useThemeWorkbenchInputState", () => {
  it("执行仍在继续时不应继续展示 A2UI 已提交提示", () => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    let state: ReturnType<typeof useThemeWorkbenchInputState> | null = null;
    const container = document.createElement("div");
    const root = createRoot(container);

    function TestComponent() {
      state = useThemeWorkbenchInputState({
        isThemeWorkbenchVariant: false,
        isSending: true,
        hasPendingA2UIForm: false,
        hasSubmissionNotice: true,
      });
      return null;
    }

    act(() => {
      root.render(React.createElement(TestComponent));
    });

    expect(state).not.toBeNull();
    expect(state!.shouldShowA2UISubmissionNotice).toBe(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
