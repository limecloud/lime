import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationOverviewFocusCard } from "./AutomationOverviewFocusCard";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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

async function renderCard(
  props: Partial<ComponentProps<typeof AutomationOverviewFocusCard>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <AutomationOverviewFocusCard
        job={
          {
            id: "job-sceneapp-overview-1",
            name: "短视频持续投放",
            workspace_id: "workspace-default",
          } as any
        }
        workspaceName="默认工作区"
        summaryCard={
          {
            sceneappId: "story-video-suite",
            title: "故事短视频套件",
            businessLabel: "多模态组合",
            typeLabel: "组合做法",
            patternSummary: "步骤链",
            status: "watch",
            statusLabel: "先补结果材料",
            summary: "这条持续流程最近一轮已有可继续结果，适合继续回到生成。",
            nextAction: "先把这轮结果材料沉淀好，再决定是否继续放大。",
            destinations: [
              {
                key: "task-center",
                label: "生成",
                description: "带着材料回到生成继续推进。",
              },
            ],
            scorecardAggregate: {
              status: "watch",
              statusLabel: "先补结果材料",
              summary: "这轮材料已经接近可复用。",
              nextAction: "优先补齐结构化结果包。",
              actionLabel: "建议继续优化",
              topFailureSignalLabel: "结果材料不完整",
              metricKeys: [],
              failureSignals: [],
              observedFailureSignals: [],
              destinations: [
                {
                  key: "task-center",
                  label: "生成",
                  description: "带着材料回到生成继续推进。",
                },
              ],
            },
            automationSummary: "1 条持续流程 · 1 条启用中 · 当前无风险提醒",
            latestAutomationLabel: "最近运行：短视频持续投放 · 成功",
          } as any
        }
        runDetailView={
          {
            runId: "run-sceneapp-overview-1",
            status: "success",
            statusLabel: "成功",
            stageLabel: "结果已回流",
            summary: "最近一轮结果已回流，并带着结果材料。",
            nextAction: "继续看这轮结果。",
            deliveryCompletionLabel: "已生成完整结果包",
          } as any
        }
        {...props}
      />,
    );
  });

  return container;
}

describe("AutomationOverviewFocusCard", () => {
  it("应展示当前经营焦点摘要", async () => {
    await renderCard();

    const text = document.body.textContent ?? "";
    expect(text).toContain("现在先继续这条");
    expect(text).toContain("短视频持续投放");
    expect(text).toContain("故事短视频套件");
    expect(text).toContain("这轮材料已经接近可复用。");
    expect(text).toContain("先做：优先补齐结构化结果包。");
    expect(text).toContain("最近结果");
  });

  it("应支持继续复盘与打开详情动作", async () => {
    const onReviewCurrentProject = vi.fn();
    const onOpenSceneAppGovernance = vi.fn();
    const onOpenSceneAppDetail = vi.fn();
    const onOpenJobDetails = vi.fn();

    await renderCard({
      onReviewCurrentProject,
      onOpenSceneAppGovernance,
      onOpenSceneAppDetail,
      onOpenJobDetails,
    });

    const reviewButton = document.body.querySelector(
      "[data-testid='automation-overview-review-current-project']",
    ) as HTMLButtonElement | null;
    const governanceButton = document.body.querySelector(
      "[data-testid='automation-overview-open-governance']",
    ) as HTMLButtonElement | null;
    const detailButton = document.body.querySelector(
      "[data-testid='automation-overview-open-detail']",
    ) as HTMLButtonElement | null;
    const jobDetailsButton = document.body.querySelector(
      "[data-testid='automation-overview-open-job-details']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      reviewButton?.click();
      governanceButton?.click();
      detailButton?.click();
      jobDetailsButton?.click();
      await Promise.resolve();
    });

    expect(onReviewCurrentProject).toHaveBeenCalledTimes(1);
    expect(onOpenSceneAppGovernance).toHaveBeenCalledTimes(1);
    expect(onOpenSceneAppDetail).toHaveBeenCalledTimes(1);
    expect(onOpenJobDetails).toHaveBeenCalledTimes(1);
  });

  it("没有焦点任务时应展示空态", async () => {
    await renderCard({
      job: null,
      workspaceName: null,
      summaryCard: null,
      runDetailView: null,
    });

    expect(document.body.textContent).toContain("还没有持续接上的做法");
  });
});
