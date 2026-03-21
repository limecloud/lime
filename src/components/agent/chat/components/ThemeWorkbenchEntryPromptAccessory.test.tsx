import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeWorkbenchEntryPromptAccessory } from "./ThemeWorkbenchEntryPromptAccessory";
import type { ThemeWorkbenchEntryPromptState } from "../hooks/useThemeWorkbenchEntryPrompt";

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }

    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }

  vi.clearAllMocks();
});

function renderAccessory(
  props?: Partial<ComponentProps<typeof ThemeWorkbenchEntryPromptAccessory>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultPrompt: ThemeWorkbenchEntryPromptState = {
    kind: "initial_prompt",
    signature: "dispatch-1",
    title: "已恢复待执行创作意图",
    description: "进入页面后不会自动开始生成，确认后再继续。",
    actionLabel: "继续生成",
    prompt: "请先生成主稿",
  };
  const defaultProps: ComponentProps<typeof ThemeWorkbenchEntryPromptAccessory> =
    {
    prompt: defaultPrompt,
    onRestart: vi.fn(),
    onContinue: vi.fn(async () => undefined),
  };

  act(() => {
    root.render(
      <ThemeWorkbenchEntryPromptAccessory {...defaultProps} {...props} />,
    );
  });

  mountedRoots.push({ container, root });
  return {
    container,
    props: {
      ...defaultProps,
      ...props,
    },
  };
}

describe("ThemeWorkbenchEntryPromptAccessory", () => {
  it("应渲染提示文案与操作按钮", () => {
    const { container } = renderAccessory();

    expect(
      container.querySelector('[data-testid="theme-workbench-entry-prompt"]')
        ?.textContent,
    ).toContain("已恢复待执行创作意图");
    expect(container.textContent).toContain("进入页面后不会自动开始生成");
    expect(container.textContent).toContain("继续生成");
    expect(container.textContent).toContain("重新开始");
  });

  it("应分发继续与重启动作", async () => {
    const onRestart = vi.fn();
    const onContinue = vi.fn(async () => undefined);
    const { container } = renderAccessory({
      onRestart,
      onContinue,
    });

    const restartButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="theme-workbench-entry-restart"]',
    );
    const continueButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="theme-workbench-entry-continue"]',
    );

    if (!restartButton || !continueButton) {
      throw new Error("未找到主题工作台入口提示操作按钮");
    }

    act(() => {
      restartButton.click();
    });
    expect(onRestart).toHaveBeenCalledTimes(1);

    await act(async () => {
      continueButton.click();
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
