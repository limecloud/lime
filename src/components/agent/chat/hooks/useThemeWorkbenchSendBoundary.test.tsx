import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useThemeWorkbenchSendBoundary,
} from "./useThemeWorkbenchSendBoundary";
import type { BrowserTaskPreflight } from "./handleSendTypes";

interface HookHarnessProps {
  isThemeWorkbench: boolean;
  contentId?: string;
  initialDispatchKey: string | null;
  consumedInitialPromptKey: string | null;
  mappedTheme: string;
  browserTaskPreflight: BrowserTaskPreflight | null;
  isBrowserAssistReady: boolean;
}

interface HookHarness {
  getValue: () => ReturnType<typeof useThemeWorkbenchSendBoundary>;
  rerender: (props?: Partial<HookHarnessProps>) => void;
  unmount: () => void;
  onConsumeInitialPrompt: ReturnType<typeof vi.fn>;
  onResetConsumedInitialPrompt: ReturnType<typeof vi.fn>;
  onClearEntryPrompt: ReturnType<typeof vi.fn>;
  onPrepareBrowserTaskPreflight: ReturnType<typeof vi.fn>;
}

function createPreflight(): BrowserTaskPreflight {
  return {
    requestId: "browser-preflight:existing",
    createdAt: 123,
    sourceText: "旧任务",
    images: [],
    requirement: "required_with_user_step",
    reason: "需要浏览器",
    phase: "awaiting_user",
    launchUrl: "https://mp.weixin.qq.com/",
  };
}

function mountHook(initialProps?: Partial<HookHarnessProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const onConsumeInitialPrompt = vi.fn();
  const onResetConsumedInitialPrompt = vi.fn();
  const onClearEntryPrompt = vi.fn();
  const onPrepareBrowserTaskPreflight = vi.fn();

  let hookValue: ReturnType<typeof useThemeWorkbenchSendBoundary> | null = null;
  let currentProps: HookHarnessProps = {
    isThemeWorkbench: true,
    contentId: "content-1",
    initialDispatchKey: "dispatch-1",
    consumedInitialPromptKey: null,
    mappedTheme: "social-media",
    browserTaskPreflight: null,
    isBrowserAssistReady: true,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useThemeWorkbenchSendBoundary({
      ...currentProps,
      initialUserImages: [],
      socialArticleSkillKey: "social_post_with_cover",
      onConsumeInitialPrompt,
      onResetConsumedInitialPrompt,
      onClearEntryPrompt,
      onPrepareBrowserTaskPreflight,
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
    onPrepareBrowserTaskPreflight,
  };
}

describe("useThemeWorkbenchSendBoundary", () => {
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

  it("应识别社媒主题工作台的首条意图消费与技能前缀", () => {
    const harness = mountHook();

    try {
      const boundary = harness.getValue().resolveSendBoundary({
        sourceText: "请生成今天的社媒主稿",
      });

      expect(boundary.sourceText).toBe(
        "/social_post_with_cover 请生成今天的社媒主稿",
      );
      expect(boundary.shouldConsumePendingThemeWorkbenchInitialPrompt).toBe(
        true,
      );
      expect(boundary.shouldDismissThemeWorkbenchEntryPrompt).toBe(true);
      expect(boundary.browserRequirementMatch).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("已有浏览器前置引导时应阻止未确认发送", () => {
    const harness = mountHook({
      mappedTheme: "general",
      browserTaskPreflight: createPreflight(),
    });

    try {
      expect(harness.getValue().isBlockedByBrowserPreflight()).toBe(true);
      expect(
        harness.getValue().isBlockedByBrowserPreflight({
          browserPreflightConfirmed: true,
        }),
      ).toBe(false);
    } finally {
      harness.unmount();
    }
  });

  it("需要真实浏览器时应创建前置引导并同步消费初始意图", () => {
    const harness = mountHook({
      mappedTheme: "general",
      isBrowserAssistReady: false,
    });

    try {
      const boundary = harness.getValue().resolveSendBoundary({
        sourceText: "帮我把这篇文章发布到微信公众号后台",
      });

      const started = harness.getValue().maybeStartBrowserTaskPreflight({
        boundary,
        images: [],
        webSearch: false,
        thinking: false,
        sendExecutionStrategy: "auto",
      });

      expect(started).toBe(true);
      expect(harness.onPrepareBrowserTaskPreflight).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceText: "帮我把这篇文章发布到微信公众号后台",
          requirement: "required_with_user_step",
          launchUrl: "https://mp.weixin.qq.com/",
          phase: "launching",
        }),
      );
      expect(harness.onConsumeInitialPrompt).toHaveBeenCalledWith("dispatch-1");
      expect(harness.onClearEntryPrompt).toHaveBeenCalledTimes(1);
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
