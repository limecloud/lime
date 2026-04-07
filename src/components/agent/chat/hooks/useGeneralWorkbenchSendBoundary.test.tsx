import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeneralWorkbenchSendBoundary } from "./useGeneralWorkbenchSendBoundary";

interface HookHarnessProps {
  isThemeWorkbench: boolean;
  contentId?: string;
  initialDispatchKey: string | null;
  consumedInitialPromptKey: string | null;
  mappedTheme: string;
}

interface HookHarness {
  getValue: () => ReturnType<typeof useGeneralWorkbenchSendBoundary>;
  rerender: (props?: Partial<HookHarnessProps>) => void;
  unmount: () => void;
  onConsumeInitialPrompt: ReturnType<typeof vi.fn>;
  onResetConsumedInitialPrompt: ReturnType<typeof vi.fn>;
  onClearEntryPrompt: ReturnType<typeof vi.fn>;
}

function mountHook(initialProps?: Partial<HookHarnessProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const onConsumeInitialPrompt = vi.fn();
  const onResetConsumedInitialPrompt = vi.fn();
  const onClearEntryPrompt = vi.fn();

  let hookValue: ReturnType<typeof useGeneralWorkbenchSendBoundary> | null =
    null;
  let currentProps: HookHarnessProps = {
    isThemeWorkbench: true,
    contentId: "content-1",
    initialDispatchKey: "dispatch-1",
    consumedInitialPromptKey: null,
    mappedTheme: "general",
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useGeneralWorkbenchSendBoundary({
      ...currentProps,
      initialUserImages: [],
      socialArticleSkillKey: "content_post_with_cover",
      onConsumeInitialPrompt,
      onResetConsumedInitialPrompt,
      onClearEntryPrompt,
    });
    return null;
  }

  const render = (nextProps?: Partial<HookHarnessProps>) => {
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
    onConsumeInitialPrompt,
    onResetConsumedInitialPrompt,
    onClearEntryPrompt,
  };
}

describe("useGeneralWorkbenchSendBoundary", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("应识别工作区内容编排的首条意图消费", () => {
    const harness = mountHook();

    try {
      const boundary = harness.getValue().resolveSendBoundary({
        sourceText: "请生成今天的社媒主稿",
      });

      expect(boundary.sourceText).toBe(
        "/content_post_with_cover 请生成今天的社媒主稿",
      );
      expect(boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt).toBe(
        true,
      );
      expect(boundary.shouldDismissGeneralWorkbenchEntryPrompt).toBe(true);
      expect(boundary.browserRequirementMatch).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("需要真实浏览器时应仅保留 requirement 检测，不再恢复旧状态机", () => {
    const harness = mountHook();

    try {
      const boundary = harness.getValue().resolveSendBoundary({
        sourceText: "帮我把这篇文章发布到微信公众号后台",
      });

      expect(boundary.sourceText).toBe(
        "/content_post_with_cover 帮我把这篇文章发布到微信公众号后台",
      );
      expect(boundary.browserRequirementMatch).toEqual(
        expect.objectContaining({
          requirement: "required_with_user_step",
          launchUrl: "https://mp.weixin.qq.com/",
          platformLabel: "微信公众号后台",
        }),
      );
      expect(harness.onConsumeInitialPrompt).not.toHaveBeenCalled();
      expect(harness.onClearEntryPrompt).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("发送失败时应回滚已消费的首条意图", () => {
    const harness = mountHook();

    try {
      const boundary = harness.getValue().resolveSendBoundary({
        sourceText: "请生成今天的社媒主稿",
      });

      act(() => {
        harness.getValue().rollbackAfterSendFailure(boundary);
      });

      expect(harness.onResetConsumedInitialPrompt).toHaveBeenCalledTimes(1);
    } finally {
      harness.unmount();
    }
  });
});
