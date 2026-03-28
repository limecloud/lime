import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2UITaskCard,
  A2UITaskLoadingCard,
} from "./A2UITaskCard";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import {
  cleanupMountedRoots,
  clickButtonByText,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import {
  buildCreateConfirmationA2UI,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";

setupReactActEnvironment();

describe("A2UITaskCard", () => {
  const mountedRoots: MountedRoot[] = [];

  const pendingConfirmation: PendingCreateConfirmation = {
    projectId: "project-1",
    source: "workspace_prompt",
    creationMode: "guided",
    initialUserPrompt: "帮我继续这篇内容",
    createdAt: 1_700_000_000_000,
  };

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("应渲染统一任务卡头部与提交区域", async () => {
    const submitSpy = vi.fn();
    const { container } = mountHarness(
      A2UITaskCard,
      {
        response: buildCreateConfirmationA2UI(pendingConfirmation),
        onSubmit: submitSpy,
        preset: CHAT_A2UI_TASK_CARD_PRESET,
      },
      mountedRoots,
    );

    expect(container.querySelector("[data-testid='agent-a2ui-task-card']")).not.toBeNull();
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
});
