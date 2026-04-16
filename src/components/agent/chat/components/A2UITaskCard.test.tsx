import { afterEach, describe, expect, it, vi } from "vitest";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import {
  CHAT_A2UI_TASK_CARD_PRESET,
  type A2UIResponse,
} from "@/lib/workspace/a2ui";
import {
  cleanupMountedRoots,
  clickButtonByText,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";

setupReactActEnvironment();

const createConfirmationResponse: A2UIResponse = {
  id: "create-confirmation-project-1",
  root: "create_confirmation_root",
  data: {},
  components: [
    {
      id: "create_confirmation_hint",
      component: "Text",
      text: "我已经收到你的提示，先确认要继续已有内容还是创建新稿。",
      variant: "body",
    },
    {
      id: "create_confirmation_option",
      component: "ChoicePicker",
      label: "你希望我如何开始这次创作？",
      value: [],
      variant: "mutuallyExclusive",
      layout: "vertical",
      options: [
        {
          value: "continue_history",
          label: "继续完善已有内容",
          description: "直接回到最近相关文稿继续，不额外新建。",
        },
        {
          value: "new_post",
          label: "新写一篇内容",
          description: "创建新的独立文稿，从这次需求开始写。",
        },
      ],
    },
    {
      id: "create_confirmation_root",
      component: "Column",
      children: ["create_confirmation_hint", "create_confirmation_option"],
      gap: 16,
      align: "stretch",
    },
  ],
  submitAction: {
    label: "开始处理",
    action: {
      name: "submit",
    },
  },
};

describe("A2UITaskCard", () => {
  const mountedRoots: MountedRoot[] = [];

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("应渲染统一任务卡头部与提交区域", async () => {
    const submitSpy = vi.fn();
    const { container } = mountHarness(
      A2UITaskCard,
      {
        response: createConfirmationResponse,
        onSubmit: submitSpy,
        preset: CHAT_A2UI_TASK_CARD_PRESET,
      },
      mountedRoots,
    );

    expect(
      container.querySelector("[data-testid='agent-a2ui-task-card']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("补充信息");
    expect(container.textContent).toContain("等你确认");

    clickButtonByText(container, "新写一篇内容");
    await flushEffects();
    clickButtonByText(container, "开始处理");
    await flushEffects();

    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        create_confirmation_option: ["new_post"],
      }),
    );
  });

  it("应渲染统一加载卡片", () => {
    const { container } = mountHarness(
      A2UITaskLoadingCard,
      {
        title: "补充信息",
        subtitle: "正在解析结构化问题，请稍等。",
      },
      mountedRoots,
    );

    expect(
      container.querySelector("[data-testid='agent-a2ui-task-loading-card']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("正在解析结构化问题，请稍等。");
    expect(container.textContent).toContain("这一步加载中...");
  });

  it("内嵌表面模式应压平外层卡壳但保持表单可提交", async () => {
    const submitSpy = vi.fn();
    const { container } = mountHarness(
      A2UITaskCard,
      {
        response: createConfirmationResponse,
        onSubmit: submitSpy,
        preset: CHAT_A2UI_TASK_CARD_PRESET,
        compact: true,
        surface: "embedded",
      },
      mountedRoots,
    );

    expect(
      container.querySelector<HTMLElement>(
        "[data-testid='agent-a2ui-task-card']",
      )?.dataset.surface,
    ).toBe("embedded");
    expect(container.querySelector(".a2ui-container")?.className).toContain(
      "space-y-2.5",
    );
    expect(container.querySelector(".a2ui-choice-option")).not.toBeNull();

    clickButtonByText(container, "新写一篇内容");
    await flushEffects();
    clickButtonByText(container, "开始处理");
    await flushEffects();

    expect(submitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        create_confirmation_option: ["new_post"],
      }),
    );
  });
});
