import { describe, expect, it } from "vitest";
import {
  buildCuratedTaskReferenceEntryFromSceneAppExecution,
  buildSceneAppExecutionReviewFollowUpAction,
} from "./sceneAppCuratedTaskReference";

describe("sceneAppCuratedTaskReference", () => {
  it("应把 sceneapp 执行摘要编译成复盘可用的 reference entry", () => {
    const entry = buildCuratedTaskReferenceEntryFromSceneAppExecution({
      summary: {
        sceneappId: "sceneapp-content-pack",
        title: "AI 内容周报",
        summary: "围绕 AI 内容周报生成一轮项目结果。",
        businessLabel: "内容生产",
        typeLabel: "项目资料包",
        executionChainLabel: "生成主执行面",
        deliveryContractLabel: "项目资料包",
        planningStatusLabel: "已规划",
        planningSummary: "当前已具备一轮复盘基线。",
        activeLayers: [],
        referenceCount: 2,
        referenceItems: [],
        projectPackPlan: null,
        scorecardMetricKeys: [],
        scorecardFailureSignals: [
          {
            key: "review_blocked",
            label: "复核阻塞",
          },
        ],
        notes: [],
        runtimeBackflow: {
          runId: "run-001",
          statusLabel: "已完成",
          statusTone: "watch",
          summary: "这轮运行已产出项目结果，但仍需复核。",
          nextAction: "优先补齐复核意见后再继续发布。",
          sourceLabel: "Agent 工作区",
          deliveryCompletionLabel: "已交付 3/4 个部件",
          evidenceSourceLabel: "当前已接入会话证据",
          startedAtLabel: "2026-04-20 10:00:00",
          finishedAtLabel: "2026-04-20 10:03:00",
          topFailureSignalLabel: "复核阻塞",
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          observedFailureSignals: [],
          governanceArtifacts: [],
        },
      },
      latestRunDetailView: {
        runId: "run-001",
        status: "success",
        statusLabel: "已完成",
        stageLabel: "结果整理",
        summary: "这轮运行已产出项目结果，但仍需复核。",
        nextAction: "优先补齐复核意见后再继续发布。",
        sourceLabel: "Agent 工作区",
        artifactCount: 4,
        deliveryCompletionLabel: "已交付 3/4 个部件",
        deliverySummary: "当前还缺最终复核记录。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        contextBaseline: null,
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联 2 条请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        failureSignalLabel: "复核阻塞",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-04-20 10:00:00",
        finishedAtLabel: "2026-04-20 10:03:00",
        durationLabel: "3 分钟",
        entryAction: null,
      },
    });

    expect(entry).toMatchObject({
      id: "sceneapp:sceneapp-content-pack:run:run-001",
      sourceKind: "sceneapp_execution_summary",
      title: "AI 内容周报",
      category: "experience",
      taskPrefillByTaskId: {
        "account-project-review": {
          project_goal: "AI 内容周报",
          existing_results: expect.stringContaining("这轮运行已产出项目结果"),
        },
      },
    });
  });

  it("应把 sceneapp reference entry 编译成复盘 continuation action", () => {
    const referenceEntry = buildCuratedTaskReferenceEntryFromSceneAppExecution({
      summary: {
        sceneappId: "sceneapp-content-pack",
        title: "AI 内容周报",
        summary: "围绕 AI 内容周报生成一轮项目结果。",
        businessLabel: "内容生产",
        typeLabel: "项目资料包",
        executionChainLabel: "生成主执行面",
        deliveryContractLabel: "项目资料包",
        planningStatusLabel: "已规划",
        planningSummary: "当前已具备一轮复盘基线。",
        activeLayers: [],
        referenceCount: 2,
        referenceItems: [],
        projectPackPlan: null,
        scorecardMetricKeys: [],
        scorecardFailureSignals: [],
        notes: [],
        runtimeBackflow: {
          runId: "run-001",
          statusLabel: "已完成",
          statusTone: "watch",
          summary: "这轮运行已产出项目结果，但仍需复核。",
          nextAction: "优先补齐复核意见后再继续发布。",
          sourceLabel: "Agent 工作区",
          deliveryCompletionLabel: "已交付 3/4 个部件",
          evidenceSourceLabel: "当前已接入会话证据",
          startedAtLabel: "2026-04-20 10:00:00",
          finishedAtLabel: "2026-04-20 10:03:00",
          deliveryCompletedParts: [],
          deliveryMissingParts: [],
          observedFailureSignals: [],
          governanceArtifacts: [],
        },
      },
      latestRunDetailView: {
        runId: "run-001",
        status: "success",
        statusLabel: "已完成",
        stageLabel: "结果整理",
        summary: "这轮运行已产出项目结果，但仍需复核。",
        nextAction: "优先补齐复核意见后再继续发布。",
        sourceLabel: "Agent 工作区",
        artifactCount: 4,
        deliveryCompletionLabel: "已交付 3/4 个部件",
        deliverySummary: "当前还缺最终复核记录。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        contextBaseline: null,
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联 2 条请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-04-20 10:00:00",
        finishedAtLabel: "2026-04-20 10:03:00",
        durationLabel: "3 分钟",
        entryAction: null,
      },
    });
    const action = buildSceneAppExecutionReviewFollowUpAction({
      referenceEntries: [referenceEntry],
    });

    expect(action).not.toBeNull();
    expect(action).toMatchObject({
      capabilityRoute: {
        kind: "curated_task",
        taskId: "account-project-review",
        taskTitle: "复盘这个账号/项目",
        launchInputValues: {
          project_goal: "AI 内容周报",
          existing_results: expect.stringContaining("这轮运行已产出项目结果"),
        },
        referenceEntries: [
          expect.objectContaining({
            sourceKind: "sceneapp_execution_summary",
            title: "AI 内容周报",
          }),
        ],
      },
      prompt: expect.stringContaining("请帮我复盘这个账号或项目"),
    });
    expect(action?.prompt).toContain("账号或项目目标：AI 内容周报");
  });
});
