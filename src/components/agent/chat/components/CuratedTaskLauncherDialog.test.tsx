import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuratedTaskLauncherDialog } from "./CuratedTaskLauncherDialog";
import { findCuratedTaskTemplateById } from "@/components/agent/chat/utils/curatedTaskTemplates";
import {
  CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import type { UnifiedMemory } from "@/lib/api/unifiedMemory";

const mockListUnifiedMemories = vi.hoisted(() =>
  vi.fn<() => Promise<UnifiedMemory[]>>(async () => []),
);

vi.mock("@/lib/api/unifiedMemory", () => ({
  listUnifiedMemories: mockListUnifiedMemories,
}));

describe("CuratedTaskLauncherDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // React 18 createRoot + act 在当前 Vitest 环境里需要显式打开该标记。
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    mockListUnifiedMemories.mockReset();
    mockListUnifiedMemories.mockResolvedValue([]);
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("应让启动表单主体成为可滚动区域，避免内容过长时整窗无法下拉", async () => {
    const task = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(task).not.toBeNull();

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();

    const scrollBody = document.body.querySelector(
      '[data-testid="curated-task-launcher-scroll-body"]',
    );
    expect(scrollBody).not.toBeNull();
    expect(scrollBody?.className).toContain("flex-1");
    expect(scrollBody?.className).toContain("overflow-y-auto");
    expect(dialog?.textContent).toContain("每日趋势摘要");
    expect(dialog?.textContent).toContain("开始这一步前，我先确认几件事。");
    expect(dialog?.textContent).toContain("想的话，再带几条参考");
    expect(dialog?.textContent).toContain(
      "风格、偏好、项目结果和当前上下文都可以。",
    );
  });

  it("应在参考对象卡片上显式区分灵感库与项目结果来源", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();
    mockListUnifiedMemories.mockResolvedValue([
      {
        id: "memory-style-1",
        session_id: "session-1",
        memory_type: "project",
        category: "identity",
        title: "品牌风格样本",
        content: "偏好克制的科技蓝与留白型构图。",
        summary: "偏好克制的科技蓝与留白型构图。",
        tags: ["科技蓝", "留白"],
        metadata: {
          confidence: 0.9,
          importance: 8,
          access_count: 1,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
    ]);

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          initialReferenceEntries={[
            {
              id: "sceneapp:content-pack:run:1",
              sourceKind: "sceneapp_execution_summary",
              title: "AI 内容周报",
              summary: "当前已有一轮项目结果，可直接作为复盘基线。",
              category: "experience",
              categoryLabel: "成果",
              tags: ["复盘"],
            },
          ]}
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("项目结果");
    expect(dialog?.textContent).toContain("灵感库");
    expect(dialog?.textContent).toContain("AI 内容周报");
    expect(dialog?.textContent).toContain("品牌风格样本");
  });

  it("命中最近复盘偏好的结果模板时，应在 launcher 内显影复盘提示", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();

    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-needs-evidence",
        decision_status: "needs_more_evidence",
        decision_summary: "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-review",
        sceneTitle: "短视频编排",
      },
    );

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          projectId="project-review"
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
    });

    const banner = document.body.querySelector(
      '[data-testid="curated-task-launcher-review-feedback-banner"]',
    );
    expect(banner?.textContent).toContain("围绕最近复盘");
    expect(banner?.textContent).toContain("最近复盘已更新：短视频编排 · 补证据");
    expect(banner?.textContent).toContain("这轮结果还缺证据");
  });

  it("复盘模板 launcher 应在启动确认层显影当前结果基线的经营摘要", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          initialReferenceEntries={[
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
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const baselineCard = document.body.querySelector(
      '[data-testid="curated-task-launcher-sceneapp-baseline-card"]',
    );
    expect(baselineCard?.textContent).toContain("当前结果基线");
    expect(baselineCard?.textContent).toContain("AI 内容周报");
    expect(baselineCard?.textContent).toContain("当前判断：先补复核与修复");
    expect(baselineCard?.textContent).toContain("当前卡点：复核阻塞");
    expect(baselineCard?.textContent).toContain("更适合去向：周会复盘");
    expect(document.body.textContent).toContain(
      "下面的 账号或项目目标 / 已有结果或数据 已按这轮结果自动带入",
    );
  });

  it("切到下游结果模板后，launcher 仍应显影 sceneapp 基线摘要", async () => {
    const task = findCuratedTaskTemplateById("daily-trend-briefing");
    expect(task).not.toBeNull();

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          initialReferenceEntries={[
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
          onOpenChange={() => undefined}
          onConfirm={() => undefined}
        />,
      );
      await Promise.resolve();
    });

    const baselineCard = document.body.querySelector(
      '[data-testid="curated-task-launcher-sceneapp-baseline-card"]',
    );
    expect(baselineCard?.textContent).toContain("当前结果基线");
    expect(baselineCard?.textContent).toContain("AI 内容周报");
    expect(baselineCard?.textContent).toContain("当前判断：先补复核与修复");
    expect(baselineCard?.textContent).toContain("当前卡点：复核阻塞");
    expect(baselineCard?.textContent).toContain("更适合去向：周会复盘");
  });

  it("launcher 打开时收到灵感回流信号，应即时刷新最近参考对象且不清掉已选种子", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();
    const onConfirm = vi.fn();

    mockListUnifiedMemories
      .mockResolvedValueOnce([
        {
          id: "memory-style-1",
          session_id: "session-1",
          memory_type: "project",
          category: "identity",
          title: "品牌风格样本",
          content: "偏好克制的科技蓝与留白型构图。",
          summary: "偏好克制的科技蓝与留白型构图。",
          tags: ["科技蓝", "留白"],
          metadata: {
            confidence: 0.9,
            importance: 8,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_670_000,
          updated_at: 1_712_345_678_000,
          archived: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "memory-style-1",
          session_id: "session-1",
          memory_type: "project",
          category: "identity",
          title: "品牌风格样本",
          content: "偏好克制的科技蓝与留白型构图。",
          summary: "偏好克制的科技蓝与留白型构图。",
          tags: ["科技蓝", "留白"],
          metadata: {
            confidence: 0.9,
            importance: 8,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_670_000,
          updated_at: 1_712_345_678_000,
          archived: false,
        },
        {
          id: "memory-preference-2",
          session_id: "session-1",
          memory_type: "project",
          category: "preference",
          title: "品牌语气偏好",
          content: "整体语气偏轻盈但专业。",
          summary: "整体语气偏轻盈但专业。",
          tags: ["语气", "品牌"],
          metadata: {
            confidence: 0.88,
            importance: 7,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_679_000,
          updated_at: 1_712_345_680_000,
          archived: false,
        },
      ]);

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          initialReferenceEntries={[
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
                  existing_results: "当前已有一轮项目结果，可直接作为复盘基线。",
                },
              },
            },
          ]}
          onOpenChange={() => undefined}
          onConfirm={onConfirm}
        />,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("AI 内容周报");
    expect(document.body.textContent).not.toContain("品牌语气偏好");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("AI 内容周报");
    expect(document.body.textContent).toContain("品牌语气偏好");

    const confirmButton =
      (document.body.querySelector(
        '[data-testid="curated-task-launcher-confirm"]',
      ) as HTMLButtonElement | null) ??
      Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("开始生成"),
      );
    expect(confirmButton).toBeTruthy();
    expect(confirmButton?.getAttribute("disabled")).toBeNull();

    await act(async () => {
      confirmButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ id: "account-project-review" }),
      expect.objectContaining({
        project_goal: "AI 内容周报",
        existing_results: "当前已有一轮项目结果，可直接作为复盘基线。",
      }),
      expect.objectContaining({
        referenceEntries: [
          expect.objectContaining({
            id: "sceneapp:content-pack:run:1",
            sourceKind: "sceneapp_execution_summary",
          }),
        ],
      }),
    );
  });

  it("launcher 刷新最近参考对象时，应保留用户手动勾选的非种子参考", async () => {
    const task = findCuratedTaskTemplateById("account-project-review");
    expect(task).not.toBeNull();
    const onConfirm = vi.fn();

    mockListUnifiedMemories
      .mockResolvedValueOnce([
        {
          id: "memory-style-1",
          session_id: "session-1",
          memory_type: "project",
          category: "identity",
          title: "品牌风格样本",
          content: "偏好克制的科技蓝与留白型构图。",
          summary: "偏好克制的科技蓝与留白型构图。",
          tags: ["科技蓝", "留白"],
          metadata: {
            confidence: 0.9,
            importance: 8,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_670_000,
          updated_at: 1_712_345_678_000,
          archived: false,
        },
        {
          id: "memory-preference-2",
          session_id: "session-1",
          memory_type: "project",
          category: "preference",
          title: "品牌语气偏好",
          content: "整体语气偏轻盈但专业。",
          summary: "整体语气偏轻盈但专业。",
          tags: ["语气", "品牌"],
          metadata: {
            confidence: 0.88,
            importance: 7,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_679_000,
          updated_at: 1_712_345_680_000,
          archived: false,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "memory-style-1",
          session_id: "session-1",
          memory_type: "project",
          category: "identity",
          title: "品牌风格样本",
          content: "偏好克制的科技蓝与留白型构图。",
          summary: "偏好克制的科技蓝与留白型构图。",
          tags: ["科技蓝", "留白"],
          metadata: {
            confidence: 0.9,
            importance: 8,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_670_000,
          updated_at: 1_712_345_678_000,
          archived: false,
        },
        {
          id: "memory-context-3",
          session_id: "session-1",
          memory_type: "project",
          category: "context",
          title: "活动背景补充",
          content: "这轮内容主要围绕新品发布前 48 小时预热。",
          summary: "这轮内容主要围绕新品发布前 48 小时预热。",
          tags: ["预热", "活动"],
          metadata: {
            confidence: 0.86,
            importance: 6,
            access_count: 1,
            last_accessed_at: null,
            source: "manual",
            embedding: null,
          },
          created_at: 1_712_345_681_000,
          updated_at: 1_712_345_682_000,
          archived: false,
        },
      ]);

    await act(async () => {
      root.render(
        <CuratedTaskLauncherDialog
          open
          task={task}
          initialReferenceEntries={[
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
                  existing_results: "当前已有一轮项目结果，可直接作为复盘基线。",
                },
              },
            },
          ]}
          onOpenChange={() => undefined}
          onConfirm={onConfirm}
        />,
      );
      await Promise.resolve();
    });

    const preferenceOption = document.body.querySelector(
      '[data-testid="curated-task-reference-option-memory-preference-2"]',
    );
    expect(preferenceOption).toBeTruthy();

    await act(async () => {
      preferenceOption?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("品牌语气偏好");
    expect(document.body.textContent).toContain("已选择 2 条参考对象");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("活动背景补充");
    expect(document.body.textContent).toContain("品牌语气偏好");

    const confirmButton =
      (document.body.querySelector(
        '[data-testid="curated-task-launcher-confirm"]',
      ) as HTMLButtonElement | null) ??
      Array.from(document.body.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("开始生成"),
      );
    expect(confirmButton).toBeTruthy();

    await act(async () => {
      confirmButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ id: "account-project-review" }),
      expect.objectContaining({
        project_goal: "AI 内容周报",
        existing_results: "当前已有一轮项目结果，可直接作为复盘基线。",
      }),
      expect.objectContaining({
        referenceEntries: expect.arrayContaining([
          expect.objectContaining({
            id: "sceneapp:content-pack:run:1",
            sourceKind: "sceneapp_execution_summary",
          }),
          expect.objectContaining({
            id: "memory-preference-2",
            title: "品牌语气偏好",
          }),
        ]),
      }),
    );
  });
});
