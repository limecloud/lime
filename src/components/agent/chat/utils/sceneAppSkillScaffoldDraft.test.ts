import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import { buildSkillsPageParamsFromSceneAppExecution } from "./sceneAppSkillScaffoldDraft";

function createSummary(): SceneAppExecutionSummaryViewModel {
  return {
    sceneappId: "story-video-suite",
    title: "短视频编排",
    summary: "把线框图、脚本、配乐和短视频草稿压成同一条结果链。",
    businessLabel: "内容闭环",
    typeLabel: "多模态组合",
    executionChainLabel: "创作场景 -> 生成 -> Project Pack",
    deliveryContractLabel: "Project Pack",
    planningStatusLabel: "已就绪",
    planningSummary: "当前已经带入 2 条参考与 1 条风格偏好，可直接进入生成。",
    activeLayers: [
      { key: "skill", label: "Skill" },
      { key: "memory", label: "Memory" },
      { key: "taste", label: "Taste" },
    ],
    referenceCount: 2,
    referenceItems: [],
    tasteSummary: "偏好克制的科技蓝与留白型构图。",
    feedbackSummary: "最近两次复盘都提示封面信息过密。",
    projectPackPlan: {
      packKindLabel: "短视频项目包",
      completionStrategyLabel: "按必含部件判断整包完成度",
      viewerLabel: "结果包查看器",
      primaryPart: "任务简报",
      requiredParts: [
        { key: "brief", label: "任务简报" },
        { key: "storyboard", label: "分镜 / 线框图" },
      ],
      notes: [],
    },
    scorecardProfileRef: "story-video-scorecard",
    scorecardMetricKeys: [
      { key: "delivery_readiness", label: "交付就绪度" },
    ],
    scorecardFailureSignals: [
      { key: "publish_stalled", label: "发布卡点" },
    ],
    notes: [],
    descriptorSnapshot: {
      deliveryContract: "project_pack",
      deliveryProfile: {
        viewerKind: "artifact_bundle",
        requiredParts: ["brief", "storyboard"],
        primaryPart: "brief",
      },
    },
    runtimeBackflow: null,
  };
}

function createDetailView(): SceneAppRunDetailViewModel {
  return {
    runId: "run-fallback-42",
    status: "success",
    statusLabel: "成功",
    stageLabel: "结果已交付",
    summary: "最近一轮样本已经回流了可继续消费的结果文件。",
    nextAction: "继续进入编辑或发布。",
    sourceLabel: "人工试跑",
    artifactCount: 2,
    deliveryCompletionLabel: "整包已交齐 2/2 个部件",
    deliverySummary: "当前结果包已完整回流。",
    deliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "storyboard", label: "分镜 / 线框图" },
    ],
    deliveryCompletedParts: [
      { key: "brief", label: "任务简报" },
    ],
    deliveryMissingParts: [
      { key: "review_note", label: "复核意见" },
    ],
    deliveryPartCoverageKnown: true,
    deliveryViewerLabel: "结果包查看",
    packCompletionStrategyLabel: "按必含部件判断整包完成度",
    packViewerLabel: "结果包查看",
    plannedDeliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "storyboard", label: "分镜 / 线框图" },
    ],
    packPlanNotes: ["继续沿当前样本复用。"],
    contextBaseline: {
      referenceCount: 2,
      referenceItems: [],
      tasteKeywords: [],
      avoidKeywords: [],
      feedbackSignals: [],
      feedbackSummary: "封面信息仍然偏密，需要再克制一些。",
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildSkillsPageParamsFromSceneAppExecution", () => {
  it("应把场景结果和最近复盘信号编译成技能草稿", () => {
    vi.spyOn(Date, "now").mockReturnValue(11223344);

    const result = buildSkillsPageParamsFromSceneAppExecution(
      createSummary(),
      createDetailView(),
      {
        projectId: "project-1",
        reviewSignal: {
          source: "review_feedback",
          category: "experience",
          title: "短视频编排 · 可继续复用",
          summary: "封面已经稳定，下一步继续生成渠道预览稿并整理上传稿。",
          tags: ["复盘", "可继续复用", "低风险"],
          preferredTaskIds: ["daily-trend-briefing"],
          createdAt: 123456,
          projectId: "project-1",
          sessionId: "session-1",
        },
      },
    );

    expect(result).toMatchObject({
      creationProjectId: "project-1",
      initialScaffoldRequestKey: 11223344,
      initialScaffoldDraft: {
        target: "project",
        name: "短视频编排复用做法",
        sourceMessageId: "sceneapp-run-run-fallback-42",
      },
    });
    expect(result?.initialScaffoldDraft?.description).toContain(
      "沉淀自「短视频编排」这轮已经进入结果消费与复盘闭环的做法。",
    );
    expect(result?.initialScaffoldDraft?.description).toContain(
      "最近人工复盘：短视频编排 · 可继续复用",
    );
    expect(result?.initialScaffoldDraft?.whenToUse).toEqual(
      expect.arrayContaining([
        "当你需要继续产出“短视频编排”这类内容闭环结果时使用。",
      ]),
    );
    expect(result?.initialScaffoldDraft?.inputs).toEqual(
      expect.arrayContaining([
        "执行骨架：创作场景 -> 生成 -> Project Pack",
        "人工复盘：封面已经稳定，下一步继续生成渠道预览稿并整理上传稿。",
      ]),
    );
    expect(result?.initialScaffoldDraft?.fallbackStrategy).toEqual(
      expect.arrayContaining([
        "如果仍缺少复核意见，先补齐缺失部件，再把整套做法沉淀下来。",
        "如果再次出现复核阻塞，先回看证据与治理材料，不要直接放大复用。",
      ]),
    );
  });

  it("缺少结果明细时不应生成技能草稿", () => {
    const result = buildSkillsPageParamsFromSceneAppExecution(
      createSummary(),
      null,
    );

    expect(result).toBeNull();
  });
});
