import { describe, expect, it } from "vitest";
import {
  backfillSceneAppExecutionSummaryViewModel,
  buildSceneAppAutomationWorkspaceCardViewModel,
  buildSceneAppCatalogCardViewModel,
  buildSceneAppDetailViewModel,
  buildSceneAppExecutionSummaryViewModel,
  buildSceneAppGovernancePanelViewModel,
  buildSceneAppOperatingSummaryViewModel,
  buildSceneAppRunDetailViewModel,
  buildSceneAppScorecardAggregateViewModel,
  buildSceneAppScorecardViewModel,
  buildSceneAppWorkbenchStatItems,
} from "./product";
import type {
  SceneAppDescriptor,
  SceneAppPlanResult,
  SceneAppRunSummary,
  SceneAppScorecard,
} from "./types";

type SceneAppPlanResultOverrides = {
  descriptor?: Partial<SceneAppDescriptor>;
  readiness?: Partial<SceneAppPlanResult["readiness"]>;
  contextOverlay?: Partial<NonNullable<SceneAppPlanResult["contextOverlay"]>>;
  projectPackPlan?: Partial<NonNullable<SceneAppPlanResult["projectPackPlan"]>>;
  plan?: Partial<Omit<SceneAppPlanResult["plan"], "adapterPlan">> & {
    adapterPlan?: Partial<SceneAppPlanResult["plan"]["adapterPlan"]>;
  };
};

function createDescriptor(
  overrides: Partial<SceneAppDescriptor> = {},
): SceneAppDescriptor {
  return {
    id: "story-video-suite",
    title: "短视频编排",
    summary: "把文本、线框图、配乐和短视频草稿收口成结果链。",
    category: "Scene Apps",
    sceneappType: "hybrid",
    patternPrimary: "pipeline",
    patternStack: ["pipeline", "generator", "inversion"],
    capabilityRefs: ["agent_turn"],
    infraProfile: [
      "composition_blueprint",
      "project_pack",
      "workspace_storage",
    ],
    deliveryContract: "project_pack",
    outputHint: "短视频项目包",
    deliveryProfile: {
      artifactProfileRef: "story-video-artifacts",
      viewerKind: "artifact_bundle",
      requiredParts: [
        "brief",
        "storyboard",
        "script",
        "music_refs",
        "video_draft",
        "review_note",
      ],
      primaryPart: "brief",
    },
    compositionProfile: {
      blueprintRef: "story-video-blueprint",
      stepCount: 6,
      steps: [
        {
          id: "brief",
          order: 1,
          bindingProfileRef: "story-video-native-binding",
          bindingFamily: "native_skill",
        },
        {
          id: "storyboard",
          order: 2,
          bindingProfileRef: "story-video-native-binding",
          bindingFamily: "native_skill",
        },
        {
          id: "script",
          order: 3,
          bindingProfileRef: "story-video-native-binding",
          bindingFamily: "native_skill",
        },
        {
          id: "music_refs",
          order: 4,
          bindingProfileRef: "story-video-agent-binding",
          bindingFamily: "agent_turn",
        },
        {
          id: "video_draft",
          order: 5,
          bindingProfileRef: "story-video-agent-binding",
          bindingFamily: "agent_turn",
        },
        {
          id: "review_note",
          order: 6,
          bindingProfileRef: "story-video-native-binding",
          bindingFamily: "native_skill",
        },
      ],
    },
    scorecardProfile: {
      profileRef: "story-video-scorecard",
      metricKeys: [
        "complete_pack_rate",
        "review_pass_rate",
        "publish_conversion_rate",
      ],
      failureSignals: ["pack_incomplete", "review_blocked", "publish_stalled"],
    },
    entryBindings: [
      {
        kind: "service_skill",
        bindingFamily: "agent_turn",
      },
      {
        kind: "workspace_card",
        bindingFamily: "agent_turn",
      },
    ],
    launchRequirements: [
      {
        kind: "project",
        message: "需要项目目录承接结果。",
      },
    ],
    sourcePackageId: "lime-core-sceneapps",
    sourcePackageVersion: "2026-04-15",
    ...overrides,
  };
}

function createRun(
  overrides: Partial<SceneAppRunSummary> = {},
): SceneAppRunSummary {
  return {
    runId: "run-1",
    sceneappId: "story-video-suite",
    status: "success",
    source: "automation",
    sourceRef: "automation-job-story-video-1",
    sessionId: "session-story-video-1",
    browserRuntimeRef: null,
    serviceSceneRuntimeRef: null,
    nativeSkillRuntimeRef: null,
    startedAt: "2026-04-15T00:00:00.000Z",
    finishedAt: "2026-04-15T00:02:05.000Z",
    artifactCount: 3,
    deliveryArtifactRefs: [
      {
        relativePath: "exports/story-video-suite/latest/brief.md",
        absolutePath: "/workspace/exports/story-video-suite/latest/brief.md",
        partKey: "brief",
        projectId: "project-story-video",
        workspaceId: "workspace-story-video",
        source: "runtime_evidence",
      },
      {
        relativePath: "exports/story-video-suite/latest/video_draft.mp4",
        absolutePath:
          "/workspace/exports/story-video-suite/latest/video_draft.mp4",
        partKey: "video_draft",
        projectId: "project-story-video",
        workspaceId: "workspace-story-video",
        source: "runtime_evidence",
      },
    ],
    governanceArtifactRefs: [
      {
        kind: "evidence_summary",
        label: "证据摘要",
        relativePath:
          ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
        absolutePath:
          "/workspace/.lime/harness/sessions/session-story-video-1/evidence/summary.md",
        projectId: "project-story-video",
        workspaceId: "workspace-story-video",
        source: "session_governance",
      },
      {
        kind: "review_decision_markdown",
        label: "人工复核记录",
        relativePath:
          ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
        absolutePath:
          "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.md",
        projectId: "project-story-video",
        workspaceId: "workspace-story-video",
        source: "session_governance",
      },
      {
        kind: "review_decision_json",
        label: "复核 JSON",
        relativePath:
          ".lime/harness/sessions/session-story-video-1/review/review-decision.json",
        absolutePath:
          "/workspace/.lime/harness/sessions/session-story-video-1/review/review-decision.json",
        projectId: "project-story-video",
        workspaceId: "workspace-story-video",
        source: "session_governance",
      },
    ],
    deliveryRequiredParts: [
      "brief",
      "storyboard",
      "script",
      "music_refs",
      "video_draft",
      "review_note",
    ],
    deliveryCompletedParts: [
      "brief",
      "storyboard",
      "script",
      "music_refs",
      "video_draft",
    ],
    deliveryMissingParts: ["review_note"],
    deliveryCompletionRate: 83.3,
    deliveryPartCoverageKnown: true,
    failureSignal: "review_blocked",
    runtimeEvidenceUsed: true,
    evidenceKnownGaps: [],
    verificationFailureOutcomes: [],
    requestTelemetryAvailable: true,
    requestTelemetryMatchedCount: 2,
    artifactValidatorApplicable: true,
    artifactValidatorIssueCount: 1,
    artifactValidatorRecoveredCount: 0,
    ...overrides,
  };
}

function createPlanResult(
  overrides: SceneAppPlanResultOverrides = {},
): SceneAppPlanResult {
  const planOverrides = overrides.plan ?? {};
  const adapterPlanOverrides = planOverrides.adapterPlan ?? {};

  return {
    descriptor: createDescriptor(overrides.descriptor ?? {}),
    readiness: {
      ready: true,
      unmetRequirements: [],
      ...(overrides.readiness ?? {}),
    },
    contextOverlay: {
      compilerPlan: {
        activeLayers: ["skill", "memory", "taste", "tool"],
        memoryRefs: ["workspace:project-story-video"],
        toolRefs: ["agent_turn", "workspace_storage"],
        referenceCount: 2,
        notes: ["已装配 2 条参考素材和 1 条 memory 引用。"],
        ...(overrides.contextOverlay?.compilerPlan ?? {}),
      },
      snapshot: {
        workspaceId: "project-story-video",
        projectId: "project-story-video",
        skillRefs: ["sceneapp-service-story-video"],
        memoryRefs: ["workspace:project-story-video"],
        toolRefs: ["agent_turn", "workspace_storage"],
        referenceItems: [
          {
            id: "ref-1",
            label: "竞品视频 1",
            sourceKind: "user_input",
            contentType: "video",
            selected: true,
            usageCount: 3,
            lastUsedAt: "2026-04-15T00:02:05.000Z",
            lastFeedbackLabel: "复核阻塞",
          },
          {
            id: "ref-2",
            label: "脚本参考 1",
            sourceKind: "reference_library",
            contentType: "text",
            selected: true,
            usageCount: 2,
            lastUsedAt: "2026-04-14T09:00:00.000Z",
            lastFeedbackLabel: "继续保留",
          },
        ],
        tasteProfile: {
          profileId: "taste-story-video",
          summary: "偏好快节奏、科技感强、开头三秒直接给出结论。",
          keywords: ["快节奏", "科技感", "直接结论"],
          avoidKeywords: ["冗长铺垫"],
          derivedFromReferenceIds: ["ref-1", "ref-2"],
          confidence: 0.76,
          feedbackSummary:
            "最近一次运行已交付 5/6 个必含部件，当前主要卡点是复核阻塞，经营上建议优先优化。",
          feedbackSignals: ["review_blocked", "artifact_validation_issue"],
          lastFeedbackAt: "2026-04-15T00:03:00.000Z",
        },
        ...(overrides.contextOverlay?.snapshot ?? {}),
      },
      ...(overrides.contextOverlay ?? {}),
    },
    projectPackPlan: {
      packKind: "project_pack",
      primaryPart: "brief",
      requiredParts: [
        "brief",
        "storyboard",
        "script",
        "music_refs",
        "video_draft",
        "review_note",
      ],
      viewerKind: "artifact_bundle",
      completionStrategy: "required_parts_complete",
      notes: [
        "当前做法以结果包作为默认交付单位。",
        "完整度将按 6 个必含部件判断。",
      ],
      ...(overrides.projectPackPlan ?? {}),
    },
    plan: {
      sceneappId: planOverrides.sceneappId ?? "story-video-suite",
      executorKind: planOverrides.executorKind ?? "agent_turn",
      bindingFamily: planOverrides.bindingFamily ?? "agent_turn",
      stepPlan: planOverrides.stepPlan ?? [],
      adapterPlan: {
        adapterKind: adapterPlanOverrides.adapterKind ?? "agent_turn",
        runtimeAction:
          adapterPlanOverrides.runtimeAction ?? "open_service_scene_session",
        targetRef:
          adapterPlanOverrides.targetRef ?? "sceneapp-service-story-video",
        targetLabel: adapterPlanOverrides.targetLabel ?? "短视频编排",
        requestMetadata: adapterPlanOverrides.requestMetadata ?? {},
        launchPayload: adapterPlanOverrides.launchPayload ?? {},
        notes: adapterPlanOverrides.notes ?? [],
        linkedServiceSkillId: adapterPlanOverrides.linkedServiceSkillId,
        linkedSceneKey: adapterPlanOverrides.linkedSceneKey,
        preferredProfileKey: adapterPlanOverrides.preferredProfileKey,
      },
      storageStrategy: planOverrides.storageStrategy ?? "workspace_bundle",
      artifactContract: planOverrides.artifactContract ?? "project_pack",
      governanceHooks: planOverrides.governanceHooks ?? [
        "evidence_pack",
        "scorecard",
      ],
      warnings: planOverrides.warnings ?? [],
    },
  };
}

function createScorecard(
  overrides: Partial<SceneAppScorecard> = {},
): SceneAppScorecard {
  return {
    sceneappId: "story-video-suite",
    updatedAt: "2026-04-15T00:03:00.000Z",
    summary: "适合继续优化的多模态组合场景。",
    metrics: [
      {
        key: "complete_pack_rate",
        label: "整包交付率",
        value: 82,
        status: "good",
      },
    ],
    recommendedAction: "optimize",
    observedFailureSignals: ["review_blocked"],
    topFailureSignal: "review_blocked",
    ...overrides,
  };
}

describe("sceneapp product", () => {
  it("应输出统一的目录统计卡片", () => {
    const stats = buildSceneAppWorkbenchStatItems([
      createDescriptor(),
      createDescriptor({
        id: "daily-trend-briefing",
        sceneappType: "local_durable",
        infraProfile: ["automation_schedule", "db_store", "json_snapshot"],
      }),
    ]);

    expect(stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "catalog-count",
          value: 2,
        }),
        expect.objectContaining({
          key: "type-count",
          value: 2,
        }),
        expect.objectContaining({
          key: "durable-count",
          value: 1,
        }),
      ]),
    );
  });

  it("应把 descriptor 装配成详情视图模型", () => {
    const detailView = buildSceneAppDetailViewModel({
      descriptor: createDescriptor(),
      entryCard: {
        id: "story-video-suite",
        title: "短视频编排",
        summary: "把文本、线框图、配乐和短视频草稿收口成结果链。",
        businessLabel: "多模态组合",
        valueStatement: "从一句主题串起脚本、线框图、配乐方向和短视频草稿。",
        deliveryLabel: "短视频结果包",
        executionLabel: "当前会话继续",
        executionTone: "sky",
        patternSummary: "步骤链 · 结果生成",
        infraSummary: "组合蓝图 · 项目沉淀",
        sourceLabel: "将基于当前输入启动",
        sourcePreview: "生成一个 30 秒短视频方案",
        actionLabel: "进入生成",
      },
      launchSeed: {
        userInput: "生成一个 30 秒短视频方案",
        sourceLabel: "将基于当前输入启动",
        sourcePreview: "生成一个 30 秒短视频方案",
      },
      planResult: createPlanResult(),
    });

    expect(detailView).toEqual(
      expect.objectContaining({
        title: "短视频编排",
        businessLabel: "多模态组合",
        executionChainLabel: "Agent 工作区",
        launchActionLabel: "进入生成",
        launchRequirements: ["需要项目目录承接结果。"],
        artifactProfileRef: "story-video-artifacts",
        deliveryViewerLabel: "结果包查看",
        compositionBlueprintRef: "story-video-blueprint",
        compositionStepCount: 6,
        scorecardProfileRef: "story-video-scorecard",
        deliveryPrimaryPart: "任务简报",
      }),
    );
    expect(detailView.deliveryRequiredParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "brief", label: "任务简报" }),
        expect.objectContaining({ key: "video_draft", label: "短视频草稿" }),
      ]),
    );
    expect(detailView.compositionSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "brief",
          bindingLabel: "本机技能",
        }),
        expect.objectContaining({
          id: "video_draft",
          bindingLabel: "Agent 工作区",
        }),
      ]),
    );
    expect(detailView.scorecardMetricKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "complete_pack_rate",
          label: "整包交付率",
        }),
      ]),
    );
    expect(detailView.scorecardFailureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pack_incomplete",
          label: "整包不完整",
        }),
      ]),
    );
    expect(detailView.deliveryNarrative).toContain("项目资料包");
    expect(detailView.scorecardNarrative).toContain("整包");
    expect(detailView.planning.statusLabel).toBe("已就绪");
    expect(detailView.contextPlan?.scopeLabel).toBe("项目 project-story-video");
    expect(detailView.contextPlan?.referenceCount).toBe(2);
    expect(detailView.contextPlan?.referenceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ref-1",
          label: "竞品视频 1",
          sourceLabel: "用户输入",
          contentTypeLabel: "视频",
          selected: true,
        }),
        expect.objectContaining({
          key: "ref-2",
          label: "脚本参考 1",
          sourceLabel: "参考库",
          contentTypeLabel: "文本",
          selected: true,
        }),
      ]),
    );
    expect(detailView.contextPlan?.tasteSummary).toContain("快节奏");
    expect(detailView.contextPlan?.feedbackSummary).toContain("复核阻塞");
    expect(detailView.contextPlan?.feedbackSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "review_blocked", label: "复核阻塞" }),
      ]),
    );
    expect(detailView.contextPlan?.tasteKeywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "快节奏", label: "快节奏" }),
        expect.objectContaining({ key: "科技感", label: "科技感" }),
      ]),
    );
    expect(detailView.contextPlan?.avoidKeywords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "冗长铺垫", label: "冗长铺垫" }),
      ]),
    );
    expect(detailView.projectPackPlan?.completionStrategyLabel).toContain(
      "整包完成度",
    );
  });

  it("应把运行态回流补进生成页执行摘要", () => {
    const planResult = createPlanResult();
    const summary = buildSceneAppExecutionSummaryViewModel({
      descriptor: planResult.descriptor,
      planResult,
    });

    const runtimeBackfilledSummary = backfillSceneAppExecutionSummaryViewModel({
      summary,
      run: createRun(),
      scorecard: createScorecard(),
    });

    expect(runtimeBackfilledSummary.runtimeBackflow).toEqual(
      expect.objectContaining({
        runId: "run-1",
        statusLabel: "成功",
        statusTone: "risk",
        sourceLabel: "自动化调度",
        deliveryCompletionLabel: "已交付 5/6 个部件",
        evidenceSourceLabel: "当前已接入会话证据",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(
      runtimeBackfilledSummary.runtimeBackflow?.observedFailureSignals,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_blocked",
          label: "复核阻塞",
        }),
      ]),
    );
    expect(runtimeBackfilledSummary.scorecardAggregate).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        actionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(runtimeBackfilledSummary.scorecardAggregate?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review", label: "周会复盘" }),
        expect.objectContaining({ key: "task-center", label: "生成 / 看板" }),
      ]),
    );
  });

  it("应把 descriptor 与 scorecard 装配成统一评分模型", () => {
    const planResult = createPlanResult({
      projectPackPlan: {
        completionStrategy: "workspace_artifact_writeback",
        notes: ["运行完成后需要回写工作区结果。"],
      },
    });
    const scorecardView = buildSceneAppScorecardViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
      planResult,
    });

    expect(scorecardView).toEqual(
      expect.objectContaining({
        hasRuntimeScorecard: true,
        profileRef: "story-video-scorecard",
        deliveryContractLabel: "项目资料包",
        viewerLabel: "结果包查看",
        actionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(scorecardView?.metricKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "complete_pack_rate",
          label: "整包交付率",
        }),
      ]),
    );
    expect(scorecardView?.failureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "pack_incomplete",
          label: "整包不完整",
        }),
      ]),
    );
    expect(scorecardView?.deliveryRequiredParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_note",
          label: "复核意见",
        }),
      ]),
    );
    expect(scorecardView?.completionStrategyLabel).toContain("工作区结果回写");
    expect(scorecardView?.packPlanNotes).toContain(
      "运行完成后需要回写工作区结果。",
    );
    expect(scorecardView?.contextBaseline).toEqual(
      expect.objectContaining({
        scopeLabel: "项目 project-story-video",
        referenceCount: 2,
        tasteSummary: expect.stringContaining("快节奏"),
        feedbackSummary: expect.stringContaining("复核阻塞"),
      }),
    );
    expect(scorecardView?.contextBaseline?.referenceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ref-1",
          label: "竞品视频 1",
          usageLabel: "已用 3 次",
          feedbackLabel: "复核阻塞",
        }),
      ]),
    );
    expect(scorecardView?.contextBaseline?.feedbackSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_blocked",
          label: "复核阻塞",
        }),
      ]),
    );
    expect(scorecardView?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "complete_pack_rate",
          value: 82,
        }),
      ]),
    );
    expect(scorecardView?.observedFailureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_blocked",
          label: "复核阻塞",
        }),
      ]),
    );
    expect(scorecardView?.aggregate).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        actionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
  });

  it("应在没有真实评分时保留基础设置包里的评分口径", () => {
    const scorecardView = buildSceneAppScorecardViewModel({
      descriptor: createDescriptor(),
      scorecard: null,
    });

    expect(scorecardView).toEqual(
      expect.objectContaining({
        hasRuntimeScorecard: false,
        profileRef: "story-video-scorecard",
        deliveryContractLabel: "项目资料包",
      }),
    );
    expect(scorecardView?.metricKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "publish_conversion_rate",
          label: "发布转化率",
        }),
      ]),
    );
    expect(scorecardView?.summary).toContain("等待首批真实运行样本回流");
    expect(scorecardView?.metrics).toEqual([]);
  });

  it("应把运行记录装配成业务向详情模型", () => {
    const planResult = createPlanResult();
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun(),
      planResult,
    });

    expect(detailView).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "success",
        statusLabel: "成功",
        stageLabel: "已交付",
        sourceLabel: "自动化调度",
        durationLabel: "2 分 5 秒",
        deliveryCompletionLabel: "已交付 5/6 个部件",
        failureSignalLabel: "复核阻塞",
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel:
          "已关联 2 条会话级请求遥测，可继续核对成本与模型调用。",
        artifactValidatorLabel:
          "Artifact 校验仍有 1 条未恢复问题，当前不建议直接进入发布。",
        entryAction: expect.objectContaining({
          kind: "open_automation_job",
          jobId: "automation-job-story-video-1",
          label: "打开自动化任务",
        }),
      }),
    );
    expect(detailView.summary).toContain("还缺 复核意见");
    expect(detailView.deliveryMissingParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_note",
          label: "复核意见",
        }),
      ]),
    );
    expect(detailView.deliveryViewerLabel).toBe("结果包查看");
    expect(detailView.packCompletionStrategyLabel).toContain("整包完成度");
    expect(detailView.plannedDeliveryRequiredParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_note",
          label: "复核意见",
        }),
      ]),
    );
    expect(detailView.packPlanNotes).toContain("完整度将按 6 个必含部件判断。");
    expect(detailView.contextBaseline).toEqual(
      expect.objectContaining({
        scopeLabel: "项目 project-story-video",
        referenceCount: 2,
        tasteSummary: expect.stringContaining("快节奏"),
        feedbackSummary: expect.stringContaining("复核阻塞"),
      }),
    );
    expect(detailView.contextBaseline?.referenceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ref-1",
          label: "竞品视频 1",
          usageLabel: "已用 3 次",
          feedbackLabel: "复核阻塞",
        }),
      ]),
    );
    expect(detailView.contextBaseline?.feedbackSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "artifact_validation_issue",
          label: "结果结构校验问题",
        }),
      ]),
    );
    expect(detailView.deliveryArtifactEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "主稿 · 任务简报",
          isPrimary: true,
          pathLabel: "exports/story-video-suite/latest/brief.md",
          artifactRef: expect.objectContaining({
            partKey: "brief",
            projectId: "project-story-video",
          }),
        }),
        expect.objectContaining({
          label: "短视频草稿",
          isPrimary: false,
          pathLabel: "exports/story-video-suite/latest/video_draft.mp4",
        }),
      ]),
    );
    expect(detailView.governanceArtifactEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "证据摘要",
          pathLabel:
            ".lime/harness/sessions/session-story-video-1/evidence/summary.md",
        }),
        expect.objectContaining({
          label: "人工复核记录",
          pathLabel:
            ".lime/harness/sessions/session-story-video-1/review/review-decision.md",
        }),
      ]),
    );
    expect(detailView.governanceActionEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weekly-review-pack",
          label: "准备周会复盘包",
          primaryArtifactKind: "review_decision_markdown",
          artifactKinds: ["evidence_summary", "review_decision_markdown"],
        }),
        expect.objectContaining({
          key: "structured-governance-pack",
          label: "准备结构化治理包",
          primaryArtifactKind: "review_decision_json",
          artifactKinds: [
            "evidence_summary",
            "review_decision_markdown",
            "review_decision_json",
          ],
        }),
      ]),
    );
  });

  it("运行回流缺少部件覆盖率时也应保留规划结果包基线", () => {
    const planResult = createPlanResult({
      projectPackPlan: {
        requiredParts: ["brief", "video_draft", "review_note"],
        completionStrategy: "artifact_writeback",
        notes: ["当前按结果文件回流判断整包交付。"],
      },
    });
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: false,
      }),
      planResult,
    });

    expect(detailView.deliveryRequiredParts).toEqual([]);
    expect(detailView.deliveryPartCoverageKnown).toBe(false);
    expect(detailView.packCompletionStrategyLabel).toContain("结果文件回流");
    expect(detailView.plannedDeliveryRequiredParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "brief", label: "任务简报" }),
        expect.objectContaining({ key: "review_note", label: "复核意见" }),
      ]),
    );
    expect(detailView.packPlanNotes).toContain(
      "当前按结果文件回流判断整包交付。",
    );
    expect(detailView.contextBaseline?.referenceCount).toBe(2);
  });

  it("应把运行、证据和 scorecard 装配成页面级治理看板", () => {
    const planResult = createPlanResult();
    const governanceView = buildSceneAppGovernancePanelViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
      planResult,
    });

    expect(governanceView).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(governanceView.summary).toContain("复核阻塞");
    expect(governanceView.nextAction).toContain("准备周会复盘包");
    expect(governanceView.contextBaseline).toEqual(
      expect.objectContaining({
        scopeLabel: "项目 project-story-video",
        referenceCount: 2,
        tasteSummary: expect.stringContaining("快节奏"),
        feedbackSummary: expect.stringContaining("复核阻塞"),
      }),
    );
    expect(governanceView.contextBaseline?.referenceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "ref-2",
          label: "脚本参考 1",
          usageLabel: "已用 2 次",
        }),
      ]),
    );
    expect(governanceView.contextBaseline?.feedbackSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_blocked",
          label: "复核阻塞",
        }),
      ]),
    );
    expect(governanceView.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review", label: "周会复盘" }),
        expect.objectContaining({
          key: "task-center",
          label: "生成 / 看板",
        }),
        expect.objectContaining({
          key: "automation-job",
          label: "持续流程 / 自动化",
        }),
      ]),
    );
    expect(governanceView.statusItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weekly-pack",
          value: "已齐",
          tone: "good",
        }),
        expect.objectContaining({
          key: "artifact-check",
          value: "仍有 1 条问题",
          tone: "risk",
        }),
      ]),
    );
    expect(governanceView.governanceActionEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review-pack" }),
      ]),
    );
    expect(governanceView.entryAction).toEqual(
      expect.objectContaining({
        kind: "open_automation_job",
      }),
    );
  });

  it("应把人工复核反馈信号翻译成前台标签", () => {
    const planResult = createPlanResult({
      contextOverlay: {
        snapshot: {
          skillRefs: ["sceneapp-service-story-video"],
          memoryRefs: ["workspace:project-story-video"],
          toolRefs: ["agent_turn", "workspace_storage"],
          referenceItems: [
            {
              id: "ref-1",
              label: "竞品视频 1",
              sourceKind: "user_input",
              contentType: "video",
              selected: true,
            },
          ],
          tasteProfile: {
            profileId: "taste-story-video-suite",
            summary: "偏好快节奏、强结论。",
            keywords: ["快节奏"],
            avoidKeywords: ["铺垫过长"],
            derivedFromReferenceIds: ["ref-1"],
            confidence: 0.68,
            feedbackSummary: "人工复核已接受，但仍需做小流量验证。",
            feedbackSignals: ["review_decision_accepted", "review_risk_high"],
            lastFeedbackAt: "2026-04-15T00:06:00.000Z",
          },
        },
      },
    });
    const governanceView = buildSceneAppGovernancePanelViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
      planResult,
    });

    expect(governanceView.contextBaseline?.feedbackSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "review_decision_accepted",
          label: "人工接受",
        }),
        expect.objectContaining({
          key: "review_risk_high",
          label: "人工高风险",
        }),
      ]),
    );
  });

  it("没有运行样本时治理看板应回到首轮试跑提示", () => {
    const planResult = createPlanResult();
    const governanceView = buildSceneAppGovernancePanelViewModel({
      descriptor: createDescriptor(),
      scorecard: null,
      run: null,
      planResult,
    });

    expect(governanceView).toEqual(
      expect.objectContaining({
        status: "idle",
        statusLabel: "等待首轮运行",
        latestRunLabel: "最近运行：尚未开始",
      }),
    );
    expect(governanceView.summary).toContain("首轮复盘样本");
    expect(governanceView.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "first-run",
          label: "首轮试跑",
        }),
      ]),
    );
    expect(governanceView.statusItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "weekly-pack",
          value: "待首轮样本",
          tone: "idle",
        }),
      ]),
    );
    expect(governanceView.governanceActionEntries).toEqual([]);
    expect(governanceView.entryAction).toBeNull();
    expect(governanceView.contextBaseline?.referenceCount).toBe(2);
  });

  it("应把 SceneApp 运营状态抽成可跨页面复用的摘要", () => {
    const summary = buildSceneAppOperatingSummaryViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
    });

    expect(summary).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(summary.summary).toContain("复核阻塞");
    expect(summary.nextAction).toContain("周会复盘包");
    expect(summary.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "周会复盘" }),
        expect.objectContaining({ label: "生成 / 看板" }),
      ]),
    );
  });

  it("应把 SceneScorecard 聚合成可跨入口复用的经营摘要对象", () => {
    const aggregate = buildSceneAppScorecardAggregateViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
      planResult: createPlanResult(),
    });

    expect(aggregate).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        actionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
        profileRef: "story-video-scorecard",
      }),
    );
    expect(aggregate?.metricKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "complete_pack_rate" }),
      ]),
    );
    expect(aggregate?.failureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "review_blocked" }),
      ]),
    );
    expect(aggregate?.observedFailureSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "artifact_validation_issue" }),
      ]),
    );
    expect(aggregate?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review" }),
        expect.objectContaining({ key: "task-center" }),
      ]),
    );
  });

  it("应把 SceneApp 自动化卡片翻译成业务向自动化摘要", () => {
    const card = buildSceneAppAutomationWorkspaceCardViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard({
        recommendedAction: "keep",
      }),
      run: createRun({
        failureSignal: null,
        artifactValidatorIssueCount: 0,
        verificationFailureOutcomes: [],
        deliveryMissingParts: [],
        deliveryCompletedParts: [
          "brief",
          "storyboard",
          "script",
          "music_refs",
          "video_draft",
          "review_note",
        ],
      }),
      jobCount: 2,
      enabledJobCount: 1,
      riskyJobCount: 0,
      latestJobName: "短视频编排｜定时投放",
      latestJobStatusLabel: "成功",
    });

    expect(card.sceneappId).toBe("story-video-suite");
    expect(card.businessLabel).toBe("多模态组合");
    expect(card.status).toBe("good");
    expect(card.automationSummary).toBe(
      "2 条自动化任务 · 1 条启用中 · 当前无风险提醒",
    );
    expect(card.latestAutomationLabel).toBe(
      "最近投放任务：短视频编排｜定时投放 · 成功",
    );
    expect(card.patternSummary).toContain("步骤链");
    expect(card.scorecardAggregate).toEqual(
      expect.objectContaining({
        status: "good",
        actionLabel: "建议维持现状",
      }),
    );
  });

  it("应把目录卡片也对齐到统一经营摘要对象", () => {
    const card = buildSceneAppCatalogCardViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
    });

    expect(card).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
      }),
    );
    expect(card.scorecardAggregate).toEqual(
      expect.objectContaining({
        status: "risk",
        statusLabel: "先补复核与修复",
        actionLabel: "建议继续优化",
      }),
    );
    expect(card.scorecardAggregate?.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review", label: "周会复盘" }),
        expect.objectContaining({ key: "task-center", label: "生成 / 看板" }),
      ]),
    );
  });

  it("没有 runtime evidence 时应明确说明当前仍在 metadata 回退", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        runtimeEvidenceUsed: false,
        evidenceKnownGaps: [],
        requestTelemetryAvailable: null,
        requestTelemetryMatchedCount: null,
        artifactValidatorApplicable: null,
        artifactValidatorIssueCount: null,
        artifactValidatorRecoveredCount: null,
      }),
    });

    expect(detailView.evidenceSourceLabel).toBe("当前仍使用运行摘要回退");
    expect(detailView.requestTelemetryLabel).toContain(
      "尚未接入会话级请求遥测",
    );
    expect(detailView.artifactValidatorLabel).toContain(
      "尚未接入 Artifact 校验事实",
    );
    expect(detailView.evidenceKnownGaps).toEqual([
      "当前还没有拿到关联 session 的会话证据，运行判断暂时回退到 tracker metadata。",
    ]);
  });

  it("聊天或技能来源的运行应支持回到对应会话", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        source: "chat",
        sourceRef: "agent-runtime-submit-turn",
        sessionId: "session-story-video-1",
      }),
    });

    expect(detailView.entryAction).toEqual(
      expect.objectContaining({
        kind: "open_agent_session",
        sessionId: "session-story-video-1",
        label: "回到对应会话",
      }),
    );
  });

  it("浏览器运行引用存在时应优先打开 browser runtime", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        source: "chat",
        sessionId: "agent-session-1",
        browserRuntimeRef: {
          profileKey: "general_browser_assist",
          sessionId: "browser-session-1",
          targetId: "target-1",
        },
      }),
    });

    expect(detailView.entryAction).toEqual(
      expect.objectContaining({
        kind: "open_browser_runtime",
        browserRuntimeRef: {
          profileKey: "general_browser_assist",
          sessionId: "browser-session-1",
          targetId: "target-1",
        },
      }),
    );
  });

  it("场景运行引用存在时应优先恢复生成上下文", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        source: "chat",
        sessionId: "session-story-video-1",
        serviceSceneRuntimeRef: {
          sceneKey: "story-video-suite",
          skillId: "sceneapp-service-story-video",
          projectId: "project-video",
          contentId: "content-video-1",
          workspaceId: "workspace-video",
          entrySource: "sceneapp_plan",
          userInput: "生成一版产品短视频",
          slots: {
            duration: "30 秒",
          },
        },
      }),
    });

    expect(detailView.entryAction).toEqual(
      expect.objectContaining({
        kind: "open_service_scene_session",
        label: "回到生成会话",
        helperText: "继续把「短视频编排」最近一次运行保留的启动信息带回生成。",
        sessionId: "session-story-video-1",
        serviceSceneRuntimeRef: expect.objectContaining({
          sceneKey: "story-video-suite",
          skillId: "sceneapp-service-story-video",
        }),
      }),
    );
  });

  it("本机技能运行引用存在时应恢复服务技能入口", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor({
        title: "项目分析 Copilot",
      }),
      run: createRun({
        sceneappId: "project-analysis-copilot",
        source: "skill",
        sessionId: null,
        nativeSkillRuntimeRef: {
          skillId: "sceneapp-service-analysis",
          skillKey: "project-analysis",
          projectId: "project-analysis",
          workspaceId: "workspace-analysis",
          userInput: "请分析当前项目结构",
          slots: {
            focus: "架构",
            depth: "高",
          },
        },
      }),
    });

    expect(detailView.entryAction).toEqual(
      expect.objectContaining({
        kind: "open_native_skill_session",
        nativeSkillRuntimeRef: expect.objectContaining({
          skillId: "sceneapp-service-analysis",
          projectId: "project-analysis",
        }),
      }),
    );
  });

  it("没有可恢复引用时不应伪造运行详情动作", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        source: "chat",
        sourceRef: null,
        sessionId: null,
      }),
    });

    expect(detailView.entryAction).toBeNull();
  });
});
