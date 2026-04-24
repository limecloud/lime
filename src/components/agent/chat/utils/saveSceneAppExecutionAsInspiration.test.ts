import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSceneAppExecutionInspirationLibraryPageParams,
  hasSavedSceneAppExecutionAsInspiration,
  saveSceneAppExecutionAsInspiration,
} from "./saveSceneAppExecutionAsInspiration";
import { toast } from "sonner";
import { createUnifiedMemory } from "@/lib/api/unifiedMemory";
import * as recommendationSignals from "./curatedTaskRecommendationSignals";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/unifiedMemory", () => ({
  createUnifiedMemory: vi.fn(),
}));

describe("saveSceneAppExecutionAsInspiration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("应把 sceneapp 结果沉淀为灵感并回写推荐信号", async () => {
    const recordSignalSpy = vi.spyOn(
      recommendationSignals,
      "recordCuratedTaskRecommendationSignalFromMemory",
    );
    vi.mocked(createUnifiedMemory).mockResolvedValue({
      id: "memory-1",
      title: "短视频编排 · 复核阻塞",
      summary: "当前结果包已完整回流。",
      content: "场景：短视频编排",
      category: "experience",
      tags: [],
      confidence: 0.9,
      importance: 8,
      created_at: "2026-04-23T00:00:00.000Z",
      updated_at: "2026-04-23T00:00:00.000Z",
    } as any);

    const result = await saveSceneAppExecutionAsInspiration({
      summary: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        summary: "把线框图、脚本、配乐和短视频草稿压成同一条结果链。",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        executionChainLabel: "做法 -> 生成 -> Project Pack",
        deliveryContractLabel: "Project Pack",
        planningStatusLabel: "已就绪",
        planningSummary:
          "当前已经带入 2 条参考与 1 条风格偏好，可直接进入生成。",
        activeLayers: [],
        referenceCount: 2,
        referenceItems: [],
        tasteSummary: "偏好克制的科技蓝与留白型构图。",
        feedbackSummary: "最近两次复盘都提示封面信息过密。",
        projectPackPlan: null,
        scorecardMetricKeys: [],
        scorecardFailureSignals: [],
        scorecardAggregate: {
          status: "watch",
          statusLabel: "先补复核与修复",
          summary: "这轮结果还卡在复核结论，先不要直接放大。",
          nextAction: "优先准备周会复盘包。",
          actionLabel: "建议继续优化",
          metricKeys: [],
          failureSignals: [],
          observedFailureSignals: [],
          destinations: [],
        },
        notes: [],
        runtimeBackflow: {
          runId: "run-1",
          statusLabel: "已完成",
          statusTone: "watch",
          summary: "本次运行成功，但结果包还缺少最终复核部件。",
          nextAction: "优先补齐复核意见，再决定是否进入发布动作。",
          sourceLabel: "对话执行",
          deliveryCompletionLabel: "已交付 1/2 个部件",
          evidenceSourceLabel: "当前已接入会话证据",
          startedAtLabel: "2026-04-17 12:00",
          finishedAtLabel: "2026-04-17 12:03",
          topFailureSignalLabel: "复核阻塞",
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          observedFailureSignals: [],
          governanceArtifacts: [],
        },
      },
      detailView: {
        runId: "run-fallback",
        status: "success",
        statusLabel: "成功",
        stageLabel: "结果已交付",
        summary: "最近一轮样本已经回流了可继续消费的结果文件。",
        nextAction: "继续进入编辑或发布。",
        sourceLabel: "人工试跑",
        artifactCount: 2,
        deliveryCompletionLabel: "整包已交齐 2/2 个部件",
        deliverySummary: "当前结果包已完整回流。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [{ key: "review_note", label: "复核意见" }],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        contextBaseline: {
          referenceCount: 2,
          referenceItems: [],
          tasteKeywords: [],
          avoidKeywords: [],
          feedbackSignals: [],
          feedbackSummary: "封面信息过密，需要继续收口。",
        },
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        failureSignalLabel: "复核阻塞",
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-04-16 12:00",
        finishedAtLabel: "2026-04-16 12:03",
        durationLabel: "3 分钟",
        entryAction: null,
      },
      projectId: "project-1",
      sessionId: "session-1",
    });

    expect(result).toBe(true);
    expect(createUnifiedMemory).toHaveBeenCalledTimes(1);
    expect(recordSignalSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "memory-1",
      }),
      {
        projectId: "project-1",
        sessionId: "session-1",
      },
    );
    expect(toast.success).toHaveBeenCalledWith(
      "已把这轮结果保存到灵感库",
      expect.objectContaining({
        description: "成果 · 短视频编排 · 复核阻塞",
      }),
    );
  });

  it("缺少结果摘要时应提示不能沉淀", async () => {
    const result = await saveSceneAppExecutionAsInspiration({
      summary: null,
      detailView: null,
    });

    expect(result).toBe(false);
    expect(createUnifiedMemory).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("当前这轮结果还不足以沉淀到灵感库");
  });

  it("应能根据推荐信号判断这轮结果是否已存入灵感库", async () => {
    vi.spyOn(
      recommendationSignals,
      "recordCuratedTaskRecommendationSignalFromMemory",
    );
    vi.mocked(createUnifiedMemory).mockResolvedValue({
      id: "memory-1",
      title: "短视频编排 · 复核阻塞",
      summary: "当前结果包已完整回流。",
      content: "场景：短视频编排",
      category: "experience",
      tags: [],
      confidence: 0.9,
      importance: 8,
      created_at: "2026-04-23T00:00:00.000Z",
      updated_at: "2026-04-23T00:00:00.000Z",
    } as any);

    const summary = {
      sceneappId: "story-video-suite",
      title: "短视频编排",
      summary: "把线框图、脚本、配乐和短视频草稿压成同一条结果链。",
      businessLabel: "内容闭环",
      typeLabel: "多模态组合",
      executionChainLabel: "做法 -> 生成 -> Project Pack",
      deliveryContractLabel: "Project Pack",
      planningStatusLabel: "已就绪",
      planningSummary:
        "当前已经带入 2 条参考与 1 条风格偏好，可直接进入生成。",
      activeLayers: [],
      referenceCount: 2,
      referenceItems: [],
      tasteSummary: "偏好克制的科技蓝与留白型构图。",
      feedbackSummary: "最近两次复盘都提示封面信息过密。",
      projectPackPlan: null,
      scorecardMetricKeys: [],
      scorecardFailureSignals: [],
      scorecardAggregate: {
        status: "watch",
        statusLabel: "先补复核与修复",
        summary: "这轮结果还卡在复核结论，先不要直接放大。",
        nextAction: "优先准备周会复盘包。",
        actionLabel: "建议继续优化",
        metricKeys: [],
        failureSignals: [],
        observedFailureSignals: [],
        destinations: [],
      },
      notes: [],
      runtimeBackflow: {
        runId: "run-1",
        statusLabel: "已完成",
        statusTone: "watch",
        summary: "本次运行成功，但结果包还缺少最终复核部件。",
        nextAction: "优先补齐复核意见，再决定是否进入发布动作。",
        sourceLabel: "对话执行",
        deliveryCompletionLabel: "已交付 1/2 个部件",
        evidenceSourceLabel: "当前已接入会话证据",
        startedAtLabel: "2026-04-17 12:00",
        finishedAtLabel: "2026-04-17 12:03",
        topFailureSignalLabel: "复核阻塞",
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        observedFailureSignals: [],
        governanceArtifacts: [],
      },
    } as any;
    const detailView = {
      runId: "run-fallback",
      status: "success",
      statusLabel: "成功",
      stageLabel: "结果已交付",
      summary: "最近一轮样本已经回流了可继续消费的结果文件。",
      nextAction: "继续进入编辑或发布。",
      sourceLabel: "人工试跑",
      artifactCount: 2,
      deliveryCompletionLabel: "整包已交齐 2/2 个部件",
      deliverySummary: "当前结果包已完整回流。",
      deliveryRequiredParts: [],
      deliveryCompletedParts: [],
      deliveryMissingParts: [{ key: "review_note", label: "复核意见" }],
      deliveryPartCoverageKnown: true,
      plannedDeliveryRequiredParts: [],
      packPlanNotes: [],
      contextBaseline: {
        referenceCount: 2,
        referenceItems: [],
        tasteKeywords: [],
        avoidKeywords: [],
        feedbackSignals: [],
        feedbackSummary: "封面信息过密，需要继续收口。",
      },
      deliveryArtifactEntries: [],
      governanceActionEntries: [],
      governanceArtifactEntries: [],
      failureSignalLabel: "复核阻塞",
      evidenceSourceLabel: "当前已接入会话证据",
      requestTelemetryLabel: "已关联请求遥测。",
      artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
      evidenceKnownGaps: [],
      verificationFailureOutcomes: [],
      startedAtLabel: "2026-04-16 12:00",
      finishedAtLabel: "2026-04-16 12:03",
      durationLabel: "3 分钟",
      entryAction: null,
    } as any;

    expect(
      hasSavedSceneAppExecutionAsInspiration({
        summary,
        detailView,
        projectId: "project-1",
        sessionId: "session-1",
      }),
    ).toBe(false);

    await saveSceneAppExecutionAsInspiration({
      summary,
      detailView,
      projectId: "project-1",
      sessionId: "session-1",
    });

    expect(
      hasSavedSceneAppExecutionAsInspiration({
        summary,
        detailView,
        projectId: "project-1",
        sessionId: "session-1",
      }),
    ).toBe(true);
  });

  it("应把这轮结果映射到灵感库成果分区的精准落点", () => {
    const params = buildSceneAppExecutionInspirationLibraryPageParams({
      summary: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        summary: "把线框图、脚本、配乐和短视频草稿压成同一条结果链。",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        executionChainLabel: "做法 -> 生成 -> Project Pack",
        deliveryContractLabel: "Project Pack",
        planningStatusLabel: "已就绪",
        planningSummary:
          "当前已经带入 2 条参考与 1 条风格偏好，可直接进入生成。",
        activeLayers: [],
        referenceCount: 2,
        referenceItems: [],
        tasteSummary: "偏好克制的科技蓝与留白型构图。",
        feedbackSummary: "最近两次复盘都提示封面信息过密。",
        projectPackPlan: null,
        scorecardMetricKeys: [],
        scorecardFailureSignals: [],
        scorecardAggregate: {
          status: "watch",
          statusLabel: "先补复核与修复",
          summary: "这轮结果还卡在复核结论，先不要直接放大。",
          nextAction: "优先准备周会复盘包。",
          actionLabel: "建议继续优化",
          metricKeys: [],
          failureSignals: [],
          observedFailureSignals: [],
          destinations: [],
        },
        notes: [],
        runtimeBackflow: {
          runId: "run-1",
          statusLabel: "已完成",
          statusTone: "watch",
          summary: "本次运行成功，但结果包还缺少最终复核部件。",
          nextAction: "优先补齐复核意见，再决定是否进入发布动作。",
          sourceLabel: "对话执行",
          deliveryCompletionLabel: "已交付 1/2 个部件",
          evidenceSourceLabel: "当前已接入会话证据",
          startedAtLabel: "2026-04-17 12:00",
          finishedAtLabel: "2026-04-17 12:03",
          topFailureSignalLabel: "复核阻塞",
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          observedFailureSignals: [],
          governanceArtifacts: [],
        },
      } as any,
      detailView: {
        runId: "run-fallback",
        status: "success",
        statusLabel: "成功",
        stageLabel: "结果已交付",
        summary: "最近一轮样本已经回流了可继续消费的结果文件。",
        nextAction: "继续进入编辑或发布。",
        sourceLabel: "人工试跑",
        artifactCount: 2,
        deliveryCompletionLabel: "整包已交齐 2/2 个部件",
        deliverySummary: "当前结果包已完整回流。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [{ key: "review_note", label: "复核阻塞" }],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        contextBaseline: {
          referenceCount: 2,
          referenceItems: [],
          tasteKeywords: [],
          avoidKeywords: [],
          feedbackSignals: [],
          feedbackSummary: "封面信息过密，需要继续收口。",
        },
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        failureSignalLabel: "复核阻塞",
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-04-16 12:00",
        finishedAtLabel: "2026-04-16 12:03",
        durationLabel: "3 分钟",
        entryAction: null,
      } as any,
    });

    expect(params).toEqual({
      section: "experience",
      focusMemoryTitle: "短视频编排 · 复核阻塞",
      focusMemoryCategory: "experience",
    });
  });
});
