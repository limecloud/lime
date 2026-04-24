import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationJobDetailsDialog } from "./AutomationJobDetailsDialog";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

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
  vi.clearAllMocks();
});

async function renderDialog(
  props: Partial<ComponentProps<typeof AutomationJobDetailsDialog>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <AutomationJobDetailsDialog
        open
        onOpenChange={vi.fn()}
        job={
          {
            id: "job-browser-1",
            name: "浏览器巡检",
            description: "启动浏览器并等待人工检查",
            enabled: true,
            workspace_id: "workspace-default",
            execution_mode: "intelligent",
            schedule: { kind: "every", every_secs: 900 },
            payload: {
              kind: "browser_session",
              profile_id: "profile-1",
              profile_key: "shop_us",
              url: "https://seller.example.com/dashboard",
              environment_preset_id: "preset-1",
              target_id: null,
              open_window: false,
              stream_mode: "events",
            },
            delivery: {
              mode: "announce",
              channel: "local_file",
              target: "/tmp/lime/browser-output.json",
              best_effort: false,
              output_schema: "json",
              output_format: "json",
            },
            timeout_secs: 120,
            max_retries: 2,
            next_run_at: "2026-03-16T00:15:00Z",
            last_status: "waiting_for_human",
            last_error: null,
            last_run_at: "2026-03-16T00:00:00Z",
            last_finished_at: null,
            running_started_at: "2026-03-16T00:00:00Z",
            consecutive_failures: 0,
            last_retry_count: 0,
            auto_disabled_until: null,
            last_delivery: {
              success: false,
              message: "写入本地文件失败: permission denied",
              channel: "local_file",
              target: "/tmp/lime/browser-output.json",
              output_kind: "json",
              output_schema: "json",
              output_format: "json",
              output_preview:
                '{\n  "session_id": "mock-cdp-session-shop_us"\n}',
              delivery_attempt_id: "dlv-run-browser-1",
              run_id: "run-browser-1",
              execution_retry_count: 0,
              delivery_attempts: 2,
              attempted_at: "2026-03-16T00:00:08Z",
            },
            created_at: "2026-03-16T00:00:00Z",
            updated_at: "2026-03-16T00:00:00Z",
          } as any
        }
        workspaceName="默认工作区"
        serviceSkillContext={null}
        jobRuns={
          [
            {
              id: "run-browser-1",
              source: "automation",
              source_ref: "job-browser-1",
              session_id: "mock-cdp-session-shop_us",
              status: "running",
              started_at: "2026-03-16T00:00:00Z",
              finished_at: null,
              duration_ms: null,
              error_code: null,
              error_message: null,
              metadata: "{}",
              created_at: "2026-03-16T00:00:00Z",
              updated_at: "2026-03-16T00:00:10Z",
            },
          ] as any
        }
        historyLoading={false}
        onRefreshHistory={vi.fn()}
        {...props}
      />,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  return container;
}

function getBodyText() {
  return document.body.textContent ?? "";
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("AutomationJobDetailsDialog", () => {
  it("做法闭环应复用统一这轮判断摘要", async () => {
    await renderDialog({
      sceneAppSummaryCard: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        patternSummary: "步骤链",
        status: "risk",
        statusLabel: "先补复核与修复",
        summary: "这套做法最近一轮还没形成可直接放大的复盘闭环。",
        nextAction: "优先准备周会复盘包，再决定是否继续放大。",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
        destinations: [
          {
            key: "weekly-review",
            label: "周会复盘",
            description: "带着证据摘要和人工复核记录一起讨论。",
          },
          {
            key: "task-center",
            label: "生成 / 看板",
            description: "把结构化材料带回生成工作台或看板。",
          },
        ],
        scorecardAggregate: {
          status: "risk",
          statusLabel: "先补复核与修复",
          summary: "这套做法最近一轮还没形成可直接放大的复盘闭环。",
          nextAction: "优先准备周会复盘包，再决定是否继续放大。",
          actionLabel: "建议继续优化",
          topFailureSignalLabel: "复核阻塞",
          profileRef: "story-video-scorecard",
          metricKeys: [
            { key: "complete_pack_rate", label: "整包交付率" },
          ],
          failureSignals: [
            { key: "review_blocked", label: "复核阻塞" },
          ],
          observedFailureSignals: [
            { key: "artifact_validation_issue", label: "结果结构校验问题" },
          ],
          destinations: [
            {
              key: "weekly-review",
              label: "周会复盘",
              description: "带着证据摘要和人工复核记录一起讨论。",
            },
            {
              key: "task-center",
              label: "生成 / 看板",
              description: "把结构化材料带回生成工作台或看板。",
            },
          ],
        },
        automationSummary: "1 条自动化任务 · 1 条启用中 · 1 条带风险提醒",
        latestAutomationLabel: "最近投放任务：浏览器巡检 · 等待人工接管",
      },
    });

    expect(getBodyText()).toContain("这轮判断");
    expect(getBodyText()).toContain("先补复核与修复");
    expect(getBodyText()).toContain("建议继续优化");
    expect(getBodyText()).toContain("复核阻塞");
  });

  it("做法闭环里的业务去向应支持直接执行", async () => {
    const onReviewCurrentProject = vi.fn();
    const onSceneAppDeliveryArtifactAction = vi.fn();
    const onSceneAppGovernanceAction = vi.fn();

    await renderDialog({
      sceneAppSummaryCard: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        patternSummary: "步骤链",
        status: "risk",
        statusLabel: "先补复核与修复",
        summary: "这套做法最近一轮还没形成可直接放大的复盘闭环。",
        nextAction: "优先准备周会复盘包，再决定是否继续放大。",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
        destinations: [],
        scorecardAggregate: {
          status: "risk",
          statusLabel: "先补复核与修复",
          summary: "这套做法最近一轮还没形成可直接放大的复盘闭环。",
          nextAction: "优先准备周会复盘包，再决定是否继续放大。",
          actionLabel: "建议继续优化",
          topFailureSignalLabel: "复核阻塞",
          profileRef: "story-video-scorecard",
          metricKeys: [],
          failureSignals: [],
          observedFailureSignals: [],
          destinations: [
            {
              key: "weekly-review",
              label: "周会复盘",
              description: "带着证据摘要和人工复核记录一起讨论。",
            },
            {
              key: "task-center",
              label: "生成 / 看板",
              description: "把结构化材料带回生成工作台或看板。",
            },
          ],
        },
        automationSummary: "1 条自动化任务 · 1 条启用中 · 1 条带风险提醒",
        latestAutomationLabel: "最近投放任务：浏览器巡检 · 等待人工接管",
      },
      sceneAppRunDetailView: {
        runId: "run-sceneapp-1",
        status: "success",
        statusLabel: "成功",
        stageLabel: "结果已回流",
        summary: "最近一轮结果已经回到做法主链。",
        nextAction: "继续复盘或打开主结果。",
        sourceLabel: "自动化调度",
        artifactCount: 1,
        deliveryCompletionLabel: "已生成 1 份主结果",
        deliverySummary: "结果包已经可消费。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        contextBaseline: null,
        deliveryArtifactEntries: [
          {
            key: "brief-0",
            label: "主结果",
            helperText: "打开 brief",
            isPrimary: true,
            artifactRef: {
              partKey: "brief",
              relativePath: "artifacts/brief.md",
              absolutePath: "/tmp/lime/artifacts/brief.md",
              projectId: "workspace-default",
            },
          },
        ],
        governanceActionEntries: [
          {
            key: "weekly-review-pack",
            label: "周会复盘包",
            helperText: "准备证据摘要与人工复核记录。",
            primaryArtifactKind: "review_decision_markdown",
            primaryArtifactLabel: "人工复核记录",
            artifactKinds: ["evidence_summary", "review_decision_markdown"],
          },
          {
            key: "structured-governance-pack",
            label: "结构化复盘包",
            helperText: "准备 JSON 复盘材料。",
            primaryArtifactKind: "review_decision_json",
            primaryArtifactLabel: "复盘 JSON",
            artifactKinds: ["review_decision_json"],
          },
        ],
        governanceArtifactEntries: [],
        failureSignalLabel: undefined,
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "1 条请求遥测",
        artifactValidatorLabel: "已完成结果校验",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-03-16 09:00",
        finishedAtLabel: "2026-03-16 09:10",
        durationLabel: "10 分钟",
        entryAction: null,
      } as any,
      onReviewCurrentProject,
      onSceneAppDeliveryArtifactAction,
      onSceneAppGovernanceAction,
    });

    const reviewButton = document.body.querySelector(
      "[data-testid='automation-sceneapp-destination-action-task-center']",
    ) as HTMLButtonElement | null;
    const deliveryButton = document.body.querySelector(
      "[data-testid='automation-sceneapp-destination-action-delivery-editing']",
    ) as HTMLButtonElement | null;
    const weeklyReviewButton = document.body.querySelector(
      "[data-testid='automation-sceneapp-destination-action-weekly-review']",
    ) as HTMLButtonElement | null;

    await act(async () => {
      reviewButton?.click();
      deliveryButton?.click();
      weeklyReviewButton?.click();
      await Promise.resolve();
    });

    expect(onReviewCurrentProject).toHaveBeenCalledTimes(1);
    expect(onSceneAppDeliveryArtifactAction).toHaveBeenCalledTimes(1);
    expect(onSceneAppGovernanceAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "weekly-review-pack",
      }),
    );
  });

  it("应把头部长说明收进 tip 并展示轻量摘要", async () => {
    await renderDialog();

    expect(getBodyText()).toContain("任务详情与历史");
    expect(getBodyText()).toContain("查看任务状态、输出投递和最近运行历史。");
    expect(getBodyText()).toContain("工作区：默认工作区");
    expect(getBodyText()).not.toContain(
      "查看任务状态、输出投递和最近运行历史；需要迁移旧浏览器任务时，也在这里确认遗留配置和风险提示。",
    );

    const headerTip = await hoverTip("任务详情说明");
    expect(getBodyText()).toContain(
      "查看任务状态、输出投递和最近运行历史；需要迁移旧浏览器任务时，也在这里确认遗留配置和风险提示。",
    );
    await leaveTip(headerTip);
  });

  it("点击刷新应调用历史刷新方法", async () => {
    const onRefreshHistory = vi.fn();
    await renderDialog({ onRefreshHistory });

    const refreshButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("刷新"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      refreshButton?.click();
      await Promise.resolve();
    });

    expect(onRefreshHistory).toHaveBeenCalledWith("job-browser-1");
  });

  it("做法结果详情应支持直接保存到灵感库", async () => {
    const onSaveSceneAppAsInspiration = vi.fn();

    await renderDialog({
      sceneAppSummaryCard: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        patternSummary: "步骤链",
        status: "risk",
        statusLabel: "先补复核与修复",
        summary: "这套做法最近一轮还没形成可直接放大的复盘闭环。",
        nextAction: "优先准备周会复盘包，再决定是否继续放大。",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "复核阻塞",
        destinations: [],
        scorecardAggregate: null,
        automationSummary: "1 条自动化任务 · 1 条启用中 · 1 条带风险提醒",
        latestAutomationLabel: "最近投放任务：浏览器巡检 · 等待人工接管",
      } as any,
      sceneAppRunDetailView: {
        runId: "sceneapp-run-1",
        status: "success",
        statusLabel: "成功",
        stageLabel: "结果已交付",
        summary: "最近一轮样本已经回流了可继续消费的结果文件。",
        nextAction: "继续进入编辑或发布。",
        sourceLabel: "自动化执行",
        artifactCount: 2,
        deliveryCompletionLabel: "整包已交齐 2/2 个部件",
        deliverySummary: "当前结果包已完整回流。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        failureSignalLabel: null,
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-03-16 00:00",
        finishedAtLabel: "2026-03-16 00:03",
        durationLabel: "3 分钟",
        entryAction: null,
      } as any,
      onSaveSceneAppAsInspiration,
    });

    const saveButton = document.querySelector(
      '[data-testid="sceneapp-run-detail-save-as-inspiration"]',
    ) as HTMLButtonElement | null;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.click();
      await Promise.resolve();
    });

    expect(onSaveSceneAppAsInspiration).toHaveBeenCalledTimes(1);
  });

  it("做法结果已沉淀到灵感库时应展示已保存提示", async () => {
    const onOpenInspirationLibrary = vi.fn();
    await renderDialog({
      sceneAppSummaryCard: {
        sceneappId: "story-video-suite",
        title: "短视频编排",
        businessLabel: "内容闭环",
        typeLabel: "多模态组合",
        patternSummary: "步骤链",
        status: "healthy",
        statusLabel: "可以继续",
        summary: "这套做法最近一轮已经产出可继续消费的结果包。",
        nextAction: "把这轮结果带回下一步继续放大。",
        scorecardActionLabel: "继续放大",
        topFailureSignalLabel: null,
        destinations: [],
        scorecardAggregate: null,
        automationSummary: "1 条自动化任务 · 1 条启用中",
        latestAutomationLabel: "最近投放任务：浏览器巡检",
      } as any,
      sceneAppRunDetailView: {
        runId: "sceneapp-run-1",
        status: "success",
        statusLabel: "成功",
        stageLabel: "结果已交付",
        summary: "最近一轮样本已经回流了可继续消费的结果文件。",
        nextAction: "继续进入编辑或发布。",
        sourceLabel: "自动化执行",
        artifactCount: 2,
        deliveryCompletionLabel: "整包已交齐 2/2 个部件",
        deliverySummary: "当前结果包已完整回流。",
        deliveryRequiredParts: [],
        deliveryCompletedParts: [],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        plannedDeliveryRequiredParts: [],
        packPlanNotes: [],
        deliveryArtifactEntries: [],
        governanceActionEntries: [],
        governanceArtifactEntries: [],
        failureSignalLabel: null,
        evidenceSourceLabel: "当前已接入会话证据",
        requestTelemetryLabel: "已关联请求遥测。",
        artifactValidatorLabel: "Artifact 校验没有发现阻塞问题。",
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        startedAtLabel: "2026-03-16 00:00",
        finishedAtLabel: "2026-03-16 00:03",
        durationLabel: "3 分钟",
        entryAction: null,
      } as any,
      sceneAppSavedAsInspiration: true,
      onSaveSceneAppAsInspiration: vi.fn(),
      onOpenInspirationLibrary,
    });

    const savedButton = document.querySelector(
      '[data-testid="sceneapp-run-detail-save-as-inspiration"]',
    ) as HTMLButtonElement | null;
    expect(savedButton?.textContent).toContain("已收进灵感库");
    expect(savedButton?.disabled).toBe(true);
    expect(getBodyText()).toContain(
      "这轮结果已进入灵感库，下一轮推荐会继续带上它。",
    );

    const openButton = document.querySelector(
      '[data-testid="sceneapp-run-detail-open-inspiration-library"]',
    ) as HTMLButtonElement | null;
    expect(openButton?.textContent).toContain("去灵感库继续");

    await act(async () => {
      openButton?.click();
      await Promise.resolve();
    });

    expect(onOpenInspirationLibrary).toHaveBeenCalledTimes(1);
  });

  it("agent_turn 任务详情应展示解析后的权限模式", async () => {
    await renderDialog({
      job: {
        id: "job-agent-1",
        name: "每日摘要",
        description: "生成一份摘要",
        enabled: true,
        workspace_id: "workspace-default",
        execution_mode: "intelligent",
        schedule: { kind: "every", every_secs: 900 },
        payload: {
          kind: "agent_turn",
          prompt: "请生成摘要",
          system_prompt: null,
          web_search: false,
          content_id: null,
          approval_policy: "never",
          sandbox_policy: "danger-full-access",
          request_metadata: {
            harness: {
              access_mode: "read-only",
            },
          },
        },
        delivery: {
          mode: "none",
          channel: null,
          target: null,
          best_effort: true,
          output_schema: "text",
          output_format: "text",
        },
        timeout_secs: null,
        max_retries: 1,
        next_run_at: null,
        last_status: "success",
        last_error: null,
        last_run_at: null,
        last_finished_at: null,
        running_started_at: null,
        consecutive_failures: 0,
        last_retry_count: 0,
        auto_disabled_until: null,
        last_delivery: null,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      } as any,
    });

    expect(getBodyText()).toContain("权限模式: 完全访问");
  });
});
