import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeneralWorkbenchEntryPromptActions } from "./useGeneralWorkbenchEntryPromptActions";
import type { GeneralWorkbenchEntryPromptState } from "./useGeneralWorkbenchEntryPrompt";

interface HookProps {
  generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
  input: string;
  initialDispatchKey: string | null;
}

interface HookHarness {
  getValue: () => ReturnType<typeof useGeneralWorkbenchEntryPromptActions>;
  rerender: (props?: Partial<HookProps>) => void;
  unmount: () => void;
  onContinuePrompt: ReturnType<typeof vi.fn>;
  dismissGeneralWorkbenchEntryPrompt: ReturnType<typeof vi.fn>;
  onConsumeInitialPrompt: ReturnType<typeof vi.fn>;
  onInputChange: ReturnType<typeof vi.fn>;
  onRequirePrompt: ReturnType<typeof vi.fn>;
}

function mountHook(initialProps?: Partial<HookProps>): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const onContinuePrompt = vi.fn(async () => undefined);
  const dismissGeneralWorkbenchEntryPrompt = vi.fn();
  const onConsumeInitialPrompt = vi.fn();
  const onInputChange = vi.fn();
  const onRequirePrompt = vi.fn();

  let hookValue: ReturnType<
    typeof useGeneralWorkbenchEntryPromptActions
  > | null = null;
  let currentProps: HookProps = {
    generalWorkbenchEntryPrompt: null,
    input: "",
    initialDispatchKey: null,
    ...initialProps,
  };

  function TestComponent() {
    hookValue = useGeneralWorkbenchEntryPromptActions({
      ...currentProps,
      onContinuePrompt,
      dismissGeneralWorkbenchEntryPrompt,
      onConsumeInitialPrompt,
      onInputChange,
      onRequirePrompt,
    });
    return null;
  }

  const render = (nextProps?: Partial<HookProps>) => {
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
    onContinuePrompt,
    dismissGeneralWorkbenchEntryPrompt,
    onConsumeInitialPrompt,
    onInputChange,
    onRequirePrompt,
  };
}

describe("useGeneralWorkbenchEntryPromptActions", () => {
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

  it("继续时应优先发送当前输入，没有输入时回退到提示文案", async () => {
    const harness = mountHook({
      generalWorkbenchEntryPrompt: {
        kind: "initial_prompt",
        signature: "dispatch-1",
        title: "已恢复待执行创作意图",
        description: "desc",
        actionLabel: "继续生成",
        prompt: "请先生成主稿",
      },
      input: "",
      initialDispatchKey: "dispatch-1",
    });

    try {
      await act(async () => {
        await harness.getValue().handleContinueGeneralWorkbenchEntryPrompt();
      });
      expect(harness.onContinuePrompt).toHaveBeenCalledWith("请先生成主稿");

      harness.rerender({
        input: "我已经补充了额外要求",
      });

      await act(async () => {
        await harness.getValue().handleContinueGeneralWorkbenchEntryPrompt();
      });
      expect(harness.onContinuePrompt).toHaveBeenLastCalledWith(
        "我已经补充了额外要求",
      );
    } finally {
      harness.unmount();
    }
  });

  it("继续时没有任何可发送内容应提示补充", async () => {
    const harness = mountHook({
      generalWorkbenchEntryPrompt: {
        kind: "resume",
        signature: "resume-1",
        title: "发现上次未完成任务",
        description: "desc",
        actionLabel: "继续任务",
        prompt: "   ",
      },
      input: "  ",
    });

    try {
      await act(async () => {
        await harness.getValue().handleContinueGeneralWorkbenchEntryPrompt();
      });
      expect(harness.onRequirePrompt).toHaveBeenCalledTimes(1);
      expect(harness.onContinuePrompt).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("重新开始初始提示时应消费意图并清空输入", () => {
    const harness = mountHook({
      generalWorkbenchEntryPrompt: {
        kind: "initial_prompt",
        signature: "dispatch-1",
        title: "已恢复待执行创作意图",
        description: "desc",
        actionLabel: "继续生成",
        prompt: "请先生成主稿",
      },
      initialDispatchKey: "dispatch-1",
      input: "已有内容",
    });

    try {
      act(() => {
        harness.getValue().handleRestartGeneralWorkbenchEntryPrompt();
      });

      expect(harness.dismissGeneralWorkbenchEntryPrompt).toHaveBeenCalledTimes(
        1,
      );
      const options =
        harness.dismissGeneralWorkbenchEntryPrompt.mock.calls[0]?.[0];
      expect(options?.consumeInitialPrompt).toBe(true);
      options?.onConsumeInitialPrompt?.();
      expect(harness.onConsumeInitialPrompt).toHaveBeenCalledWith("dispatch-1");
      expect(harness.onInputChange).toHaveBeenCalledWith("");
    } finally {
      harness.unmount();
    }
  });
});
