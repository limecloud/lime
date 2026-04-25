import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationJobFocusStrip } from "./AutomationJobFocusStrip";

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

async function renderStrip(
  props: Partial<ComponentProps<typeof AutomationJobFocusStrip>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <AutomationJobFocusStrip
        jobId="job-sceneapp-1"
        summaryCard={
          {
            title: "故事短视频套件",
            businessLabel: "多模态组合",
            statusLabel: "先补结果材料",
            summary: "这条持续流程最近一轮已有可继续结果，适合继续回到生成。",
            scorecardAggregate: {
              summary: "这轮材料已经接近可复用。",
              nextAction: "优先补齐结构化结果包。",
            },
          } as any
        }
        runDetailView={
          {
            statusLabel: "成功",
            deliveryCompletionLabel: "已生成完整结果包",
          } as any
        }
        {...props}
      />,
    );
  });

  return container;
}

describe("AutomationJobFocusStrip", () => {
  it("应展示当前经营焦点摘要", async () => {
    await renderStrip();

    const text = document.body.textContent ?? "";
    expect(text).toContain("现在先继续这条");
    expect(text).toContain("故事短视频套件");
    expect(text).not.toContain("多模态组合");
    expect(text).toContain("这轮判断：这轮材料已经接近可复用。");
    expect(text).toContain("最近结果：成功 · 已生成完整结果包");
    expect(text).toContain("先做：优先补齐结构化结果包。");
  });

  it("应支持继续看结果与打开最近结果动作", async () => {
    const onReviewCurrentProject = vi.fn();
    const onOpenSceneAppGovernance = vi.fn();

    await renderStrip({
      onReviewCurrentProject,
      onOpenSceneAppGovernance,
    });

    const reviewButton = document.body.querySelector(
      "[data-testid='automation-job-focus-review-job-sceneapp-1']",
    ) as HTMLButtonElement | null;
    const governanceButton = document.body.querySelector(
      "[data-testid='automation-job-focus-governance-job-sceneapp-1']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      reviewButton?.click();
      governanceButton?.click();
      await Promise.resolve();
    });

    expect(onReviewCurrentProject).toHaveBeenCalledTimes(1);
    expect(onOpenSceneAppGovernance).toHaveBeenCalledTimes(1);
  });

  it("加载中且缺少摘要时应展示轻量占位", async () => {
    await renderStrip({
      summaryCard: null,
      runDetailView: null,
      loading: true,
    });

    expect(document.body.textContent).toContain(
      "正在整理这条做法最近一轮的结果和下一步",
    );
  });
});
