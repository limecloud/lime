import { describe, expect, it } from "vitest";
import {
  buildWorkflowStepSnapshot,
  buildWorkflowSummaryText,
  formatWorkflowProgressLabel,
  getWorkflowStatusLabel,
} from "./workflowStepPresentation";

describe("workflowStepPresentation", () => {
  it("应按当前任务优先级排序并裁剪输入区队列", () => {
    const snapshot = buildWorkflowStepSnapshot(
      [
        { id: "completed", title: "完成素材整理", status: "completed" as const },
        { id: "pending-a", title: "等待补充案例", status: "pending" as const },
        { id: "active", title: "编写正文", status: "active" as const },
        { id: "error", title: "封面生成失败", status: "error" as const },
        { id: "pending-b", title: "排版收尾", status: "pending" as const },
        { id: "skipped", title: "跳过旧分支", status: "skipped" as const },
      ],
      3,
    );

    expect(snapshot.leadingStep?.id).toBe("active");
    expect(snapshot.remainingCount).toBe(4);
    expect(snapshot.completedCount).toBe(1);
    expect(snapshot.sortedSteps.map((step) => step.id)).toEqual([
      "active",
      "error",
      "pending-a",
      "pending-b",
      "completed",
      "skipped",
    ]);
    expect(snapshot.visibleQueueItems.map((step) => step.id)).toEqual([
      "active",
      "error",
      "pending-a",
    ]);
  });

  it("应返回稳定的中文状态标签", () => {
    expect(getWorkflowStatusLabel("active")).toBe("进行中");
    expect(getWorkflowStatusLabel("pending")).toBe("待处理");
    expect(getWorkflowStatusLabel("error")).toBe("异常");
    expect(getWorkflowStatusLabel("completed")).toBe("已完成");
    expect(getWorkflowStatusLabel("skipped")).toBe("已跳过");
  });

  it("应生成统一的摘要文案与进度标签", () => {
    expect(
      buildWorkflowSummaryText({
        leadingStep: { status: "active" as const },
        remainingCount: 3,
      }),
    ).toBe("正在推进，后续还有 2 项待处理");
    expect(
      buildWorkflowSummaryText({
        leadingStep: { status: "error" as const },
        remainingCount: 1,
      }),
    ).toBe("当前步骤异常，请先处理");
    expect(
      buildWorkflowSummaryText({
        leadingStep: null,
        remainingCount: 0,
        emptyLabel: "等待创建第一条任务",
      }),
    ).toBe("等待创建第一条任务");
    expect(
      formatWorkflowProgressLabel({ completedCount: 2, totalCount: 5 }),
    ).toBe("已完成 2/5");
  });
});
