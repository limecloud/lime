import { describe, expect, it } from "vitest";
import {
  buildSceneAppExecutionCuratedTaskFollowUpAction,
  buildCuratedTaskReferenceEntryFromSceneAppExecution,
  buildSceneAppExecutionReviewPrefillHighlights,
  buildSceneAppExecutionReviewPrefillSnapshot,
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
        scorecardAggregate: {
          status: "risk",
          statusLabel: "先补复核与修复",
          summary: "这轮结果已经回流，但当前主要卡在复核阻塞。",
          nextAction: "优先准备周会复盘包，再决定是否继续放大。",
          actionLabel: "建议继续优化",
          topFailureSignalLabel: "复核阻塞",
          metricKeys: [],
          failureSignals: [
            {
              key: "review_blocked",
              label: "复核阻塞",
            },
          ],
          observedFailureSignals: [],
          destinations: [
            {
              key: "weekly-review",
              label: "周会复盘",
              description: "把证据摘要和复核记录带去业务复盘。",
            },
          ],
        },
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
      tags: expect.arrayContaining(["先补复核与修复", "复核阻塞"]),
      taskPrefillByTaskId: {
        "account-project-review": {
          project_goal: "AI 内容周报",
          existing_results: expect.stringContaining("这轮运行已产出项目结果"),
        },
      },
    });
    expect(
      entry?.taskPrefillByTaskId?.["account-project-review"]?.existing_results,
    ).toContain("当前判断：先补复核与修复");
    expect(
      entry?.taskPrefillByTaskId?.["account-project-review"]?.existing_results,
    ).toContain("更适合去向：周会复盘");
  });

  it("应从 sceneapp reference entry 里拆出复盘卡片需要的经营摘要", () => {
    const snapshot = buildSceneAppExecutionReviewPrefillSnapshot({
      referenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为复盘基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "项目结果"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "这轮运行已产出项目结果 当前卡点：复核阻塞 建议下一步：先补齐复核意见后再继续发布。 当前判断：先补复核与修复 经营动作：优先准备周会复盘包，再决定是否继续放大。 更适合去向：周会复盘",
            },
          },
        },
      ],
    });

    expect(snapshot).toEqual({
      sourceTitle: "AI 内容周报",
      projectGoal: "AI 内容周报",
      existingResults: expect.stringContaining("这轮运行已产出项目结果"),
      statusLabel: "先补复核与修复",
      failureSignalLabel: "复核阻塞",
      nextAction: "先补齐复核意见后再继续发布。",
      operatingAction: "优先准备周会复盘包，再决定是否继续放大。",
      destinationsLabel: "周会复盘",
    });
    expect(buildSceneAppExecutionReviewPrefillHighlights(snapshot)).toEqual([
      "当前判断：先补复核与修复",
      "当前卡点：复核阻塞",
      "经营动作：优先准备周会复盘包，再决定是否继续放大。",
      "更适合去向：周会复盘",
    ]);
  });

  it("切到下游结果模板时，仍应继续复用 sceneapp 的复盘基线", () => {
    const snapshot = buildSceneAppExecutionReviewPrefillSnapshot({
      taskId: "daily-trend-briefing",
      referenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为后续生成基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "项目结果"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "这轮运行已产出项目结果 当前卡点：复核阻塞 建议下一步：先补齐复核意见后再继续发布。 当前判断：先补复核与修复 经营动作：优先准备周会复盘包，再决定是否继续放大。 更适合去向：周会复盘",
            },
          },
        },
      ],
    });

    expect(snapshot).toEqual({
      sourceTitle: "AI 内容周报",
      projectGoal: "AI 内容周报",
      existingResults: expect.stringContaining("这轮运行已产出项目结果"),
      statusLabel: "先补复核与修复",
      failureSignalLabel: "复核阻塞",
      nextAction: "先补齐复核意见后再继续发布。",
      operatingAction: "优先准备周会复盘包，再决定是否继续放大。",
      destinationsLabel: "周会复盘",
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
        scorecardAggregate: {
          status: "watch",
          statusLabel: "先补复盘材料",
          summary: "这轮结果已经可复盘，但材料还没完全齐。",
          nextAction: "先补齐结构化复盘材料，再继续进入生成工作台。",
          actionLabel: "建议继续优化",
          topFailureSignalLabel: "复核阻塞",
          metricKeys: [],
          failureSignals: [],
          observedFailureSignals: [],
          destinations: [
            {
              key: "task-center",
              label: "生成 / 看板",
              description: "把结构化材料继续带回生成工作台。",
            },
          ],
        },
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
      bannerMessage: "已切到“复盘这个账号/项目”这条下一步，并带着当前结果继续生成。",
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

  it("切到下游结果模板时，仍应继续带上 sceneapp 的当前结果基线", () => {
    const action = buildSceneAppExecutionCuratedTaskFollowUpAction({
      taskId: "viral-content-breakdown",
      referenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为后续拆解基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘", "项目结果"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results:
                "这轮运行已产出项目结果 当前卡点：复核阻塞 建议下一步：先补齐复核意见后再继续发布。 当前判断：先补复核与修复 经营动作：优先准备周会复盘包，再决定是否继续放大。 更适合去向：周会复盘",
            },
          },
        },
      ],
    });

    expect(action).not.toBeNull();
    expect(action).toMatchObject({
      bannerMessage: "已切到“拆解一条爆款内容”这条下一步，并带着当前结果继续生成。",
      capabilityRoute: {
        kind: "curated_task",
        taskId: "viral-content-breakdown",
        taskTitle: "拆解一条爆款内容",
        referenceEntries: [
          expect.objectContaining({
            sourceKind: "sceneapp_execution_summary",
            title: "AI 内容周报",
          }),
        ],
      },
    });
    expect(action?.prompt).toContain("请帮我拆解这条爆款内容");
    expect(action?.capabilityRoute.launchInputValues).toBeUndefined();
    expect(action?.prompt).toContain("继续沿这轮项目结果基线推进");
    expect(action?.prompt).toContain("当前结果基线：AI 内容周报");
    expect(action?.prompt).toContain("当前判断：先补复核与修复");
    expect(action?.prompt).toContain("更适合去向：周会复盘");
  });
});
