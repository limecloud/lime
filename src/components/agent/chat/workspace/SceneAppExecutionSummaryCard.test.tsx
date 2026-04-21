import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SceneAppExecutionSummaryCard } from "./SceneAppExecutionSummaryCard";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
type SceneAppExecutionDetailView = NonNullable<
  React.ComponentProps<
    typeof SceneAppExecutionSummaryCard
  >["latestPackResultDetailView"]
>;

function createLatestPackResultDetailView(
  overrides: Partial<SceneAppExecutionDetailView> = {},
): SceneAppExecutionDetailView {
  return {
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
    deliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "storyboard", label: "分镜 / 线框图" },
    ],
    deliveryCompletedParts: [
      { key: "brief", label: "任务简报" },
      { key: "storyboard", label: "分镜 / 线框图" },
    ],
    deliveryMissingParts: [],
    deliveryPartCoverageKnown: true,
    deliveryViewerLabel: "结果包查看",
    packCompletionStrategyLabel: "按必含部件判断整包完成度",
    packViewerLabel: "结果包查看",
    plannedDeliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "storyboard", label: "分镜 / 线框图" },
    ],
    packPlanNotes: ["继续沿当前样本复用。"],
    contextBaseline: null,
    deliveryArtifactEntries: [
      {
        key: "brief-0",
        label: "主稿 · 任务简报",
        pathLabel: "packs/run-fallback/brief.md",
        helperText: "直接打开这次运行已回流的结果文件。",
        isPrimary: true,
        artifactRef: {
          partKey: "brief",
          relativePath: "packs/run-fallback/brief.md",
          absolutePath: "/tmp/packs/run-fallback/brief.md",
          projectId: "project-1",
          source: "runtime_evidence",
        },
      },
    ],
    governanceActionEntries: [
      {
        key: "weekly-review-pack",
        label: "准备周会复盘包",
        helperText: "把证据摘要和人工复核记录一起带去业务复盘。",
        primaryArtifactKind: "review_decision_markdown",
        primaryArtifactLabel: "人工复核记录",
        artifactKinds: ["evidence_summary", "review_decision_markdown"],
      },
    ],
    governanceArtifactEntries: [
      {
        key: "evidence_summary:.lime/harness/sessions/session-1/evidence/summary.md",
        label: "证据摘要",
        pathLabel: ".lime/harness/sessions/session-1/evidence/summary.md",
        helperText: "查看当前运行对应的证据摘要。",
        artifactRef: {
          kind: "evidence_summary",
          label: "证据摘要",
          relativePath: ".lime/harness/sessions/session-1/evidence/summary.md",
          absolutePath: "/tmp/summary.md",
          projectId: "project-1",
          workspaceId: "project-1",
          source: "session_governance",
        },
      },
    ],
    failureSignalLabel: undefined,
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
    ...overrides,
  };
}

function renderCard(
  props: Partial<React.ComponentProps<typeof SceneAppExecutionSummaryCard>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <SceneAppExecutionSummaryCard
        summary={{
          sceneappId: "story-video-suite",
          title: "短视频编排",
          summary: "把线框图、脚本、配乐和短视频草稿压成同一条结果链。",
          businessLabel: "内容闭环",
          typeLabel: "多模态组合",
          executionChainLabel: "做法 -> 生成 -> Project Pack",
          deliveryContractLabel: "Project Pack",
          planningStatusLabel: "已就绪",
          planningSummary: "当前已经带入 2 条参考与 1 条风格偏好，可直接进入生成。",
          activeLayers: [
            { key: "skill", label: "Skill" },
            { key: "memory", label: "Memory" },
            { key: "taste", label: "Taste" },
          ],
          referenceCount: 2,
          referenceItems: [
            {
              key: "ref-1",
              label: "品牌 KV",
              sourceLabel: "灵感库",
              contentTypeLabel: "图片",
              usageLabel: "主视觉",
              selected: true,
            },
            {
              key: "ref-2",
              label: "评论反馈",
              sourceLabel: "复盘",
              contentTypeLabel: "文本",
              feedbackLabel: "封面需更克制",
              selected: true,
            },
          ],
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
            notes: ["完整度将按 2 个必含部件判断。"],
          },
          scorecardProfileRef: "story-video-scorecard",
          scorecardMetricKeys: [
            { key: "delivery_readiness", label: "交付就绪度" },
          ],
          scorecardFailureSignals: [
            { key: "publish_stalled", label: "发布卡点" },
          ],
          notes: ["已装配 2 条参考素材和 1 条 memory 引用。"],
          descriptorSnapshot: {
            deliveryContract: "project_pack",
            deliveryProfile: {
              viewerKind: "artifact_bundle",
              requiredParts: ["brief", "storyboard"],
              primaryPart: "brief",
            },
          },
          runtimeBackflow: {
            runId: "run-1",
            statusLabel: "已完成",
            statusTone: "watch",
            summary: "「短视频编排」本次运行成功，但结果包还缺少最终复核部件。",
            nextAction: "优先补齐复核意见，再决定是否进入发布动作。",
            sourceLabel: "对话执行",
            deliveryCompletionLabel: "已交付 1/2 个部件",
            evidenceSourceLabel: "当前已接入会话证据",
            startedAtLabel: "2026-04-17 12:00",
            finishedAtLabel: "2026-04-17 12:03",
            scorecardActionLabel: "优先优化",
            topFailureSignalLabel: "复核阻塞",
            deliveryCompletedParts: [{ key: "brief", label: "任务简报" }],
            deliveryMissingParts: [
              { key: "review_note", label: "复核意见" },
            ],
            observedFailureSignals: [
              { key: "review_blocked", label: "复核阻塞" },
            ],
            governanceArtifacts: [
              { key: "evidence_summary", label: "证据摘要" },
            ],
          },
        }}
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

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
});

describe("SceneAppExecutionSummaryCard", () => {
  it("应展示做法执行摘要的核心合同信息", () => {
    const container = renderCard();

    expect(container.textContent).toContain("做法执行摘要");
    expect(container.textContent).toContain("短视频编排");
    expect(container.textContent).toContain("做法 -> 生成 -> Project Pack");
    expect(container.textContent).toContain("当前已经带入 2 条参考与 1 条风格偏好");
    expect(container.textContent).toContain("当前带入对象");
    expect(container.textContent).toContain("结果去向与交付");
    expect(container.textContent).toContain("这轮怎么判断");
    expect(container.textContent).toContain("当前带入：2 条参考对象");
    expect(
      container.querySelector('[data-testid="sceneapp-execution-summary-project-pack"]')
        ?.textContent,
    ).toContain("短视频项目包");
    expect(
      container.querySelector('[data-testid="sceneapp-execution-summary-scorecard"]')
        ?.textContent,
    ).toContain("story-video-scorecard");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-runtime-backflow"]',
      )?.textContent,
    ).toContain("当前已接入会话证据");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-active-layers"]',
      )?.textContent,
    ).toContain("Taste");
  });

  it("应在生成主执行面展示最近可消费结果并支持打开文件", () => {
    const onDeliveryArtifactAction = vi.fn();
    const onReviewCurrentProject = vi.fn();
    const onSaveAsSkill = vi.fn();
    const onOpenSceneAppDetail = vi.fn();
    const onOpenSceneAppGovernance = vi.fn();
    const onOpenHumanReview = vi.fn();
    const onApplyQuickReview = vi.fn();
    const onGovernanceAction = vi.fn();
    const onGovernanceArtifactAction = vi.fn();
    const onEntryAction = vi.fn();
    const onContentPostAction = vi.fn();
    const onPromptAction = vi.fn();
    const container = renderCard({
      latestPackResultDetailView: createLatestPackResultDetailView(),
      latestPackResultUsesFallback: true,
      onReviewCurrentProject,
      onSaveAsSkill,
      onOpenSceneAppDetail,
      onOpenSceneAppGovernance,
      humanReviewAvailable: true,
      onOpenHumanReview,
      onApplyQuickReview,
      quickReviewActions: [
        {
          key: "accepted",
          label: "可继续复用",
          helperText: "这轮结果可以继续沿当前基线放量。",
          tone: "positive",
        },
      ],
      onDeliveryArtifactAction,
      onGovernanceAction,
      onGovernanceArtifactAction,
      onEntryAction,
      contentPostEntries: [
        {
          key: "publish",
          label: "发布稿",
          helperText: "直接复核标题、摘要、封面文案和发布备注。",
          pathLabel: "content-posts/final-publish.md",
          readinessLabel: "可继续发布",
          readinessTone: "success",
          companionEntries: [
            {
              key: "cover_meta",
              label: "封面信息",
              pathLabel: "content-posts/final-publish.cover.json",
            },
            {
              key: "publish_pack",
              label: "发布包",
              pathLabel: "content-posts/final-publish.publish-pack.json",
            },
          ],
          updatedAt: 1,
          source: {
            kind: "session_file",
            file: {
              name: "content-posts/final-publish.md",
              fileType: "document",
              size: 128,
              createdAt: 1,
              updatedAt: 1,
              metadata: {
                contentPostIntent: "publish",
                contentPostLabel: "发布稿",
              },
            },
          },
        },
        {
          key: "preview",
          label: "渠道预览稿",
          helperText: "直接复核首屏摘要、排版层级和封面建议。",
          pathLabel: "content-posts/preview.md",
          platformLabel: "小红书",
          readinessLabel: "优先渠道预览",
          readinessTone: "success",
          companionEntries: [],
          updatedAt: 2,
          source: {
            kind: "session_file",
            file: {
              name: "content-posts/preview.md",
              fileType: "document",
              size: 96,
              createdAt: 2,
              updatedAt: 2,
              metadata: {
                contentPostIntent: "preview",
                contentPostLabel: "渠道预览稿",
              },
            },
          },
        },
      ],
      onContentPostAction,
      onPromptAction,
    });

    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-runtime-pack"]',
      )?.textContent,
    ).toContain("最近可消费结果");
    expect(container.textContent).toContain("最近一轮已交付样本");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-followup-actions"]',
      )?.textContent,
    ).toContain("继续动作");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-orchestration"]',
      )?.textContent,
    ).toContain("生成后动作编排");
    expect(container.textContent).toContain("周会复盘");
    expect(container.textContent).toContain("同聊推进");
    expect(
      container.querySelector(
        '[data-testid="sceneapp-execution-summary-content-posts"]',
      )?.textContent,
    ).toContain("最近发布产物");
    expect(container.textContent).toContain("发布稿");
    expect(container.textContent).toContain("渠道预览稿");
    expect(container.textContent).toContain("可继续发布");
    expect(container.textContent).toContain("优先渠道预览");
    expect(container.textContent).toContain("封面信息");
    expect(container.textContent).toContain("发布包");

    const button = container.querySelector(
      '[data-testid="sceneapp-execution-summary-artifact-entry-brief-0"]',
    );
    const detailButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-open-detail"]',
    );
    const reviewCurrentProjectButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-review-current-project"]',
    );
    const saveAsSkillButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-save-as-skill"]',
    );
    const governanceButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-open-governance"]',
    );
    const humanReviewButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-open-human-review"]',
    );
    const quickReviewButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-quick-review-accepted"]',
    );
    const governanceActionButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-governance-action-weekly-review-pack"]',
    );
    const governanceArtifactButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-governance-artifact-evidence_summary:.lime/harness/sessions/session-1/evidence/summary.md"]',
    );
    const entryActionButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-entry-action"]',
    );
    const publishArtifactButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-content-post-publish"]',
    );
    const previewArtifactButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-content-post-preview"]',
    );
    const publishCheckButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-publish_check"]',
    );
    const publishPrepareButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-publish_prepare"]',
    );
    const channelPreviewButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-channel_preview"]',
    );
    const uploadPrepareButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-upload_prepare"]',
    );
    expect(button).not.toBeNull();
    expect(reviewCurrentProjectButton).not.toBeNull();
    expect(saveAsSkillButton).not.toBeNull();
    expect(detailButton).not.toBeNull();
    expect(governanceButton).not.toBeNull();
    expect(humanReviewButton).not.toBeNull();
    expect(quickReviewButton).not.toBeNull();
    expect(governanceActionButton).not.toBeNull();
    expect(governanceArtifactButton).not.toBeNull();
    expect(entryActionButton).not.toBeNull();
    expect(publishArtifactButton).not.toBeNull();
    expect(previewArtifactButton).not.toBeNull();
    expect(publishCheckButton).not.toBeNull();
    expect(publishPrepareButton).not.toBeNull();
    expect(channelPreviewButton).not.toBeNull();
    expect(uploadPrepareButton).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      reviewCurrentProjectButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      saveAsSkillButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      detailButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      governanceButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      humanReviewButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      quickReviewButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      governanceActionButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      governanceArtifactButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      entryActionButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      publishArtifactButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      previewArtifactButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      publishCheckButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      publishPrepareButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      channelPreviewButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      uploadPrepareButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onDeliveryArtifactAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "brief-0",
      }),
    );
    expect(onReviewCurrentProject).toHaveBeenCalledTimes(1);
    expect(onSaveAsSkill).toHaveBeenCalledTimes(1);
    expect(onOpenSceneAppDetail).toHaveBeenCalledTimes(1);
    expect(onOpenSceneAppGovernance).toHaveBeenCalledTimes(1);
    expect(onOpenHumanReview).toHaveBeenCalledTimes(1);
    expect(onApplyQuickReview).toHaveBeenCalledWith("accepted");
    expect(onGovernanceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "weekly-review-pack",
      }),
    );
    expect(onGovernanceArtifactAction).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "证据摘要",
      }),
    );
    expect(onEntryAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "open_agent_session",
      }),
    );
    expect(onContentPostAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: "publish",
      }),
    );
    expect(onContentPostAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: "preview",
      }),
    );
    expect(onPromptAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: "publish_check",
      }),
    );
    expect(onPromptAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: "publish_prepare",
      }),
    );
    expect(onPromptAction).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        key: "channel_preview",
      }),
    );
    expect(onPromptAction).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        key: "upload_prepare",
      }),
    );
  });

  it("缺件时应在同聊推进里禁用进入发布整理并提示阻塞原因", () => {
    const onPromptAction = vi.fn();
    const container = renderCard({
      latestPackResultDetailView: createLatestPackResultDetailView({
        deliveryMissingParts: [{ key: "cover", label: "封面图" }],
        deliveryCompletedParts: [{ key: "brief", label: "任务简报" }],
        deliveryCompletionLabel: "整包已交付 1/2 个部件",
        deliverySummary: "当前结果包还缺封面图。",
      }),
      onPromptAction,
    });

    const fillMissingPartsButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-fill_missing_parts"]',
    ) as HTMLButtonElement | null;
    const publishPrepareButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-publish_prepare"]',
    ) as HTMLButtonElement | null;
    const channelPreviewButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-channel_preview"]',
    ) as HTMLButtonElement | null;
    const uploadPrepareButton = container.querySelector(
      '[data-testid="sceneapp-execution-summary-prompt-action-upload_prepare"]',
    ) as HTMLButtonElement | null;

    expect(fillMissingPartsButton).not.toBeNull();
    expect(fillMissingPartsButton?.disabled).toBe(false);
    expect(publishPrepareButton).not.toBeNull();
    expect(publishPrepareButton?.disabled).toBe(true);
    expect(channelPreviewButton).not.toBeNull();
    expect(channelPreviewButton?.disabled).toBe(true);
    expect(uploadPrepareButton).not.toBeNull();
    expect(uploadPrepareButton?.disabled).toBe(true);
    expect(container.textContent).toContain("当前阻塞：当前还缺 封面图");

    act(() => {
      fillMissingPartsButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onPromptAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "fill_missing_parts",
      }),
    );
  });

  it("没有摘要时不应渲染卡片", () => {
    const container = renderCard({
      summary: null,
    });

    expect(
      container.querySelector('[data-testid="sceneapp-execution-summary-card"]'),
    ).toBeNull();
  });
});
