import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInitialDispatchKey,
  useBootstrapDispatchPreview,
} from "./useBootstrapDispatchPreview";

interface HookHarness {
  getValue: () => ReturnType<typeof useBootstrapDispatchPreview>;
  rerender: (
    props?: Partial<{
      initialUserPrompt?: string;
      initialUserImages?: Array<{ data: string; mediaType: string }>;
      messagesCount: number;
      isSending: boolean;
      queuedTurnCount: number;
      consumedInitialPromptKey?: string | null;
      shouldUseCompactThemeWorkbench?: boolean;
    }>,
  ) => void;
  unmount: () => void;
}

function mountHook(
  initialProps?: Partial<{
    initialUserPrompt?: string;
    initialUserImages?: Array<{ data: string; mediaType: string }>;
    messagesCount: number;
    isSending: boolean;
    queuedTurnCount: number;
    consumedInitialPromptKey?: string | null;
    shouldUseCompactThemeWorkbench?: boolean;
  }>,
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useBootstrapDispatchPreview> | null = null;
  let currentProps = {
    initialUserPrompt: "",
    initialUserImages: [],
    messagesCount: 0,
    isSending: false,
    queuedTurnCount: 0,
    consumedInitialPromptKey: null,
    shouldUseCompactThemeWorkbench: false,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useBootstrapDispatchPreview(currentProps);
    return null;
  }

  const render = (
    nextProps?: Partial<{
      initialUserPrompt?: string;
      initialUserImages?: Array<{ data: string; mediaType: string }>;
      messagesCount: number;
      isSending: boolean;
      queuedTurnCount: number;
      consumedInitialPromptKey?: string | null;
      shouldUseCompactThemeWorkbench?: boolean;
    }>,
  ) => {
    currentProps = {
      ...currentProps,
      ...nextProps,
    };
    act(() => {
      root.render(<TestComponent />);
    });
  };

  render();

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

describe("useBootstrapDispatchPreview", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    // noop
  });

  it("应生成稳定的 initialDispatchKey", () => {
    expect(
      buildInitialDispatchKey("写一篇文章", [
        { data: "abcdef1234567890", mediaType: "image/png" },
      ]),
    ).toContain("写一篇文章");
  });

  it("发送中且无消息时应展示 bootstrap 预览消息", () => {
    const harness = mountHook({
      initialUserPrompt: "请开始处理这个任务",
      isSending: true,
    });

    try {
      const value = harness.getValue();
      expect(value.initialDispatchKey).toBeTruthy();
      expect(value.shouldShowBootstrapDispatchPreview).toBe(true);
      expect(value.bootstrapDispatchPreviewMessages).toHaveLength(2);
      expect(value.bootstrapDispatchPreviewMessages[0]?.content).toBe(
        "请开始处理这个任务",
      );
    } finally {
      harness.unmount();
    }
  });

  it("有真实消息后应清空 bootstrap 预览", () => {
    const harness = mountHook({
      initialUserPrompt: "请开始处理这个任务",
      isSending: true,
    });

    try {
      expect(harness.getValue().bootstrapDispatchPreviewMessages).toHaveLength(2);

      harness.rerender({
        messagesCount: 1,
        isSending: false,
      });

      expect(harness.getValue().bootstrapDispatchPreviewMessages).toHaveLength(0);
      expect(harness.getValue().shouldShowBootstrapDispatchPreview).toBe(false);
    } finally {
      harness.unmount();
    }
  });
});
