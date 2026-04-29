import { describe, expect, it } from "vitest";
import { buildSceneAppExecutionInspirationDraft } from "./sceneAppExecutionInspirationDraft";

describe("buildSceneAppExecutionInspirationDraft", () => {
  it("应把结果工作台摘要整理成成果类灵感沉淀请求", () => {
    const result = buildSceneAppExecutionInspirationDraft(
      {
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
          nextAction: "优先准备结果对齐包。",
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
      {
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
        entryAction: {
          kind: "open_agent_session",
          label: "恢复对应 Agent 会话",
          helperText: "回到底层执行会话继续看完整上下文。",
          sessionId: "session-1",
        },
      },
      {
        sessionId: "session-1",
      },
    );

    expect(result).toMatchObject({
      category: "experience",
      categoryLabel: "成果",
      section: "experience",
      title: "短视频编排 · 复核阻塞",
      request: {
        session_id: "session-1",
        category: "experience",
        confidence: 0.9,
        importance: 8,
        tags: [
          "内容闭环",
          "多模态组合",
          "Project Pack",
          "复核阻塞",
          "先补复核与修复",
        ],
      },
    });
    expect(result?.request.summary).toContain("当前结果包已完整回流");
    expect(result?.request.summary).toContain("下一步：继续进入编辑或发布");
    expect(result?.request.content).toContain("场景：短视频编排");
    expect(result?.request.content).toContain(
      "建议下一步：继续进入编辑或发布。",
    );
    expect(result?.request.content).toContain("待补部件：复核意见");
  });

  it("缺少摘要或结果详情时不应生成灵感沉淀请求", () => {
    expect(buildSceneAppExecutionInspirationDraft(null, null)).toBeNull();
  });
});
