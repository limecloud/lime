import { describe, expect, it } from "vitest";
import {
  buildSceneAppAutomationWorkspaceCardViewModel,
  buildSceneAppDetailViewModel,
  buildSceneAppGovernancePanelViewModel,
  buildSceneAppOperatingSummaryViewModel,
  buildSceneAppRunDetailViewModel,
  buildSceneAppScorecardViewModel,
  buildSceneAppWorkbenchStatItems,
} from "./product";
import type {
  SceneAppDescriptor,
  SceneAppRunSummary,
  SceneAppScorecard,
} from "./types";

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
    capabilityRefs: ["cloud_scene"],
    infraProfile: [
      "composition_blueprint",
      "project_pack",
      "workspace_storage",
      "cloud_runtime",
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
          bindingProfileRef: "story-video-cloud-binding",
          bindingFamily: "cloud_scene",
        },
        {
          id: "video_draft",
          order: 5,
          bindingProfileRef: "story-video-cloud-binding",
          bindingFamily: "cloud_scene",
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
        bindingFamily: "cloud_scene",
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
    cloudSceneRuntimeRef: null,
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
        actionLabel: "开始组合",
      },
      launchSeed: {
        userInput: "生成一个 30 秒短视频方案",
        sourceLabel: "将基于当前输入启动",
        sourcePreview: "生成一个 30 秒短视频方案",
      },
    });

    expect(detailView).toEqual(
      expect.objectContaining({
        title: "短视频编排",
        businessLabel: "多模态组合",
        executionChainLabel: "云端 Scene · Agent 工作区",
        launchActionLabel: "开始组合",
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
          bindingLabel: "云端 Scene",
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
  });

  it("应把 descriptor 与 scorecard 装配成统一评分模型", () => {
    const scorecardView = buildSceneAppScorecardViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
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
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun(),
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

  it("应把运行、证据和 scorecard 装配成页面级治理看板", () => {
    const governanceView = buildSceneAppGovernancePanelViewModel({
      descriptor: createDescriptor(),
      scorecard: createScorecard(),
      run: createRun(),
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
    expect(governanceView.destinations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "weekly-review", label: "周会复盘" }),
        expect.objectContaining({ key: "task-center", label: "任务中心 / 看板" }),
        expect.objectContaining({
          key: "automation-job",
          label: "自动化任务中心",
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

  it("没有运行样本时治理看板应回到首轮试跑提示", () => {
    const governanceView = buildSceneAppGovernancePanelViewModel({
      descriptor: createDescriptor(),
      scorecard: null,
      run: null,
    });

    expect(governanceView).toEqual(
      expect.objectContaining({
        status: "idle",
        statusLabel: "等待首轮运行",
        latestRunLabel: "最近运行：尚未开始",
      }),
    );
    expect(governanceView.summary).toContain("首轮治理样本");
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
        expect.objectContaining({ label: "任务中心 / 看板" }),
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
    expect(detailView.requestTelemetryLabel).toContain("尚未接入会话级请求遥测");
    expect(detailView.artifactValidatorLabel).toContain("尚未接入 Artifact 校验事实");
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

  it("云端 Scene 运行引用存在时应优先恢复云端 Scene 上下文", () => {
    const detailView = buildSceneAppRunDetailViewModel({
      descriptor: createDescriptor(),
      run: createRun({
        source: "chat",
        sessionId: "session-story-video-1",
        cloudSceneRuntimeRef: {
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
        kind: "open_cloud_scene_session",
        sessionId: "session-story-video-1",
        cloudSceneRuntimeRef: expect.objectContaining({
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
