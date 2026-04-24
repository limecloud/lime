import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuratedTaskBadge } from "./CuratedTaskBadge";
import { findCuratedTaskTemplateById } from "../utils/curatedTaskTemplates";
import { recordCuratedTaskRecommendationSignalFromReviewDecision } from "../utils/curatedTaskRecommendationSignals";

describe("CuratedTaskBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00.000Z"));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("命中最近复盘偏好的结果模板时，应在激活 badge 上显影复盘提示", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();

    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-badge",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要先回到账号数据和高表现样本。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一条高表现内容。",
        risk_level: "medium",
        risk_tags: ["证据不足"],
        followup_actions: ["补账号数据复盘", "拆解高表现内容"],
      },
      {
        projectId: "project-review-badge",
        sceneTitle: "短视频编排",
      },
    );

    await act(async () => {
      root.render(
        <CuratedTaskBadge
          task={task!}
          projectId="project-review-badge"
          onClear={() => undefined}
        />,
      );
    });

    const reviewSignal = container.querySelector(
      '[data-testid="curated-task-badge-review-signal"]',
    );
    expect(reviewSignal?.textContent).toContain("围绕最近复盘");
    expect(reviewSignal?.textContent).toContain("短视频编排");
  });

  it("未命中复盘偏好的结果模板时，不应显影复盘提示", async () => {
    const task = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(task).not.toBeNull();

    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-badge",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要先回到账号数据和高表现样本。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一条高表现内容。",
        risk_level: "medium",
        risk_tags: ["证据不足"],
        followup_actions: ["补账号数据复盘", "拆解高表现内容"],
      },
      {
        projectId: "project-review-badge",
        sceneTitle: "短视频编排",
      },
    );

    await act(async () => {
      root.render(
        <CuratedTaskBadge
          task={task!}
          projectId="project-review-badge"
          onClear={() => undefined}
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="curated-task-badge-review-signal"]'),
    ).toBeNull();
  });

  it("复盘模板带着 sceneapp 项目结果时，应在 badge 上显影经营摘要", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();

    await act(async () => {
      root.render(
        <CuratedTaskBadge
          task={task!}
          referenceEntries={[
            {
              id: "sceneapp:content-pack:run:1",
              sourceKind: "sceneapp_execution_summary",
              title: "AI 内容周报",
              summary: "当前已有一轮项目结果，可直接作为复盘基线。",
              category: "experience",
              categoryLabel: "成果",
              tags: ["复盘"],
              taskPrefillByTaskId: {
                "account-project-review": {
                  project_goal: "AI 内容周报",
                  existing_results:
                    "这轮运行已产出项目结果 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备周会复盘包，再决定是否继续放大。 更适合去向：周会复盘",
                },
              },
            },
          ]}
          onClear={() => undefined}
        />,
      );
    });

    const statusPill = container.querySelector(
      '[data-testid="curated-task-badge-sceneapp-status"]',
    );
    const nextPill = container.querySelector(
      '[data-testid="curated-task-badge-sceneapp-next"]',
    );

    expect(statusPill?.textContent).toContain("当前判断：先补复核与修复");
    expect(nextPill?.textContent).toContain("更适合去向：周会复盘");
    expect(statusPill?.getAttribute("title")).toContain("当前结果基线：AI 内容周报");
  });

  it("切到下游结果模板后，badge 仍应显影同一份 sceneapp 基线", async () => {
    const task = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(task).not.toBeNull();

    await act(async () => {
      root.render(
        <CuratedTaskBadge
          task={task!}
          referenceEntries={[
            {
              id: "sceneapp:content-pack:run:1",
              sourceKind: "sceneapp_execution_summary",
              title: "AI 内容周报",
              summary: "当前已有一轮项目结果，可直接作为后续生成基线。",
              category: "experience",
              categoryLabel: "成果",
              tags: ["复盘"],
              taskPrefillByTaskId: {
                "account-project-review": {
                  project_goal: "AI 内容周报",
                  existing_results:
                    "这轮运行已产出项目结果 当前卡点：复核阻塞 当前判断：先补复核与修复 经营动作：优先准备周会复盘包，再决定是否继续放大。 更适合去向：周会复盘",
                },
              },
            },
          ]}
          onClear={() => undefined}
        />,
      );
    });

    const statusPill = container.querySelector(
      '[data-testid="curated-task-badge-sceneapp-status"]',
    );
    const nextPill = container.querySelector(
      '[data-testid="curated-task-badge-sceneapp-next"]',
    );

    expect(statusPill?.textContent).toContain("当前判断：先补复核与修复");
    expect(nextPill?.textContent).toContain("更适合去向：周会复盘");
    expect(statusPill?.getAttribute("title")).toContain("当前结果基线：AI 内容周报");
  });

  it("当前模板不是最近复盘首选时，应提供改用推荐模板的动作", async () => {
    const task = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(task).not.toBeNull();
    const onApplyReviewSuggestion = vi.fn();

    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-badge-switch",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要先回到账号数据和高表现样本。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足"],
        followup_actions: ["补账号数据复盘", "拆解高表现内容"],
      },
      {
        projectId: "project-review-badge-switch",
        sceneTitle: "短视频编排",
      },
    );

    await act(async () => {
      root.render(
        <CuratedTaskBadge
          task={task!}
          projectId="project-review-badge-switch"
          onApplyReviewSuggestion={onApplyReviewSuggestion}
          onClear={() => undefined}
        />,
      );
    });

    const reviewSignal = container.querySelector(
      '[data-testid="curated-task-badge-review-signal"]',
    );
    const reviewAction = container.querySelector(
      '[data-testid="curated-task-badge-review-action"]',
    ) as HTMLButtonElement | null;

    expect(reviewSignal?.textContent).toContain("更适合：复盘这个账号/项目");
    expect(reviewAction?.textContent).toContain("改用「复盘这个账号/项目」");

    await act(async () => {
      reviewAction?.click();
    });

    expect(onApplyReviewSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "account-project-review",
        title: "复盘这个账号/项目",
      }),
    );
  });
});
