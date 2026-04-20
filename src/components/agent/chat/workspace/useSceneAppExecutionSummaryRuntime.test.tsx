import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useSceneAppExecutionSummaryRuntime,
} from "./useSceneAppExecutionSummaryRuntime";
import type { SceneAppExecutionSummaryViewModel } from "@/lib/sceneapp/product";

const listSceneAppRunsMock = vi.fn();
const getSceneAppScorecardMock = vi.fn();

vi.mock("@/lib/api/sceneapp", () => ({
  listSceneAppRuns: (...args: unknown[]) => listSceneAppRunsMock(...args),
  getSceneAppScorecard: (...args: unknown[]) => getSceneAppScorecardMock(...args),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createInitialSummary(): SceneAppExecutionSummaryViewModel {
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

interface HookProbeProps {
  initialSummary?: SceneAppExecutionSummaryViewModel | null;
  sessionId?: string | null;
  isSending: boolean;
}

function renderHook(props: HookProbeProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue:
    | ReturnType<typeof useSceneAppExecutionSummaryRuntime>
    | undefined = undefined;

  function Probe(currentProps: HookProbeProps) {
    latestValue = useSceneAppExecutionSummaryRuntime(currentProps);
    return null;
  }

  act(() => {
    root.render(<Probe {...props} />);
  });

  mountedRoots.push({ root, container });
  return {
    getValue: () => latestValue,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  listSceneAppRunsMock.mockReset();
  getSceneAppScorecardMock.mockReset();
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

describe("useSceneAppExecutionSummaryRuntime", () => {
  it("应把当前 session 对应的运行回流补进执行摘要", async () => {
    listSceneAppRunsMock.mockResolvedValue([
      {
        runId: "run-1",
        sceneappId: "story-video-suite",
        status: "success",
        source: "chat",
        sourceRef: "source-1",
        sessionId: "session-1",
        startedAt: "2026-04-17T12:00:00.000Z",
        finishedAt: "2026-04-17T12:03:00.000Z",
        artifactCount: 2,
        deliveryRequiredParts: ["brief", "storyboard"],
        deliveryCompletedParts: ["brief"],
        deliveryMissingParts: ["storyboard"],
        deliveryPartCoverageKnown: true,
        failureSignal: "pack_incomplete",
        runtimeEvidenceUsed: true,
        evidenceKnownGaps: [],
        verificationFailureOutcomes: [],
        requestTelemetryAvailable: true,
        requestTelemetryMatchedCount: 1,
        artifactValidatorApplicable: true,
        artifactValidatorIssueCount: 0,
        artifactValidatorRecoveredCount: 0,
        governanceArtifactRefs: [
          {
            kind: "evidence_summary",
            label: "证据摘要",
            relativePath: ".lime/harness/sessions/session-1/evidence/summary.md",
            absolutePath: "/tmp/summary.md",
            projectId: "project-1",
            workspaceId: "project-1",
            source: "session_governance",
          },
        ],
        deliveryArtifactRefs: [
          {
            partKey: "brief",
            relativePath: "packs/run-1/brief.md",
            absolutePath: "/tmp/packs/run-1/brief.md",
            projectId: "project-1",
            source: "runtime_evidence",
          },
        ],
      },
    ]);
    getSceneAppScorecardMock.mockResolvedValue({
      sceneappId: "story-video-suite",
      updatedAt: "2026-04-17T12:04:00.000Z",
      summary: "当前建议继续优化缺失部件后再放量。",
      metrics: [],
      recommendedAction: "optimize",
      observedFailureSignals: ["pack_incomplete"],
      topFailureSignal: "pack_incomplete",
    });

    const summary = createInitialSummary();
    const { getValue } = renderHook({
      initialSummary: summary,
      sessionId: "session-1",
      isSending: false,
    });

    await flushEffects();

    expect(listSceneAppRunsMock).toHaveBeenCalledWith("story-video-suite");
    expect(getSceneAppScorecardMock).toHaveBeenCalledWith("story-video-suite");
    expect(getValue()?.summary?.runtimeBackflow).toEqual(
      expect.objectContaining({
        runId: "run-1",
        statusLabel: "成功",
        statusTone: "watch",
        deliveryCompletionLabel: "已交付 1/2 个部件",
        evidenceSourceLabel: "当前已接入会话证据",
        sourceLabel: "人工试跑",
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "整包不完整",
      }),
    );
    expect(getValue()?.latestPackResultDetailView).toEqual(
      expect.objectContaining({
        runId: "run-1",
        deliveryCompletionLabel: "已交付 1/2 个部件",
      }),
    );
    expect(getValue()?.latestPackResultUsesFallback).toBe(false);
    expect(getValue()?.reviewTargetRunSummary).toEqual(
      expect.objectContaining({
        runId: "run-1",
        sessionId: "session-1",
      }),
    );
  });

  it("找不到当前 session 对应运行时应保留启动摘要", async () => {
    listSceneAppRunsMock.mockResolvedValue([
      {
        runId: "run-other",
        sceneappId: "story-video-suite",
        status: "success",
        source: "chat",
        sourceRef: "source-other",
        sessionId: "other-session",
        startedAt: "2026-04-17T12:00:00.000Z",
        finishedAt: "2026-04-17T12:03:00.000Z",
        artifactCount: 1,
        runtimeEvidenceUsed: false,
      },
    ]);
    getSceneAppScorecardMock.mockResolvedValue({
      sceneappId: "story-video-suite",
      updatedAt: "2026-04-17T12:04:00.000Z",
      summary: "当前还没有足够样本。",
      metrics: [],
      recommendedAction: "launch",
      observedFailureSignals: [],
      topFailureSignal: null,
    });

    const summary = createInitialSummary();
    const { getValue } = renderHook({
      initialSummary: summary,
      sessionId: "session-1",
      isSending: false,
    });

    await flushEffects();

    expect(getValue()?.summary?.runtimeBackflow).toBeNull();
    expect(getValue()?.summary?.planningSummary).toBe(summary.planningSummary);
    expect(getValue()?.latestPackResultDetailView).toBeNull();
    expect(getValue()?.reviewTargetRunSummary).toBeNull();
  });

  it("当前 session 结果还没回流文件时应回退到最近可消费样本", async () => {
    listSceneAppRunsMock.mockResolvedValue([
      {
        runId: "run-current",
        sceneappId: "story-video-suite",
        status: "running",
        source: "chat",
        sourceRef: "source-current",
        sessionId: "session-1",
        startedAt: "2026-04-17T12:10:00.000Z",
        finishedAt: null,
        artifactCount: 0,
        deliveryRequiredParts: ["brief", "storyboard"],
        deliveryCompletedParts: [],
        deliveryMissingParts: ["brief", "storyboard"],
        deliveryPartCoverageKnown: true,
        runtimeEvidenceUsed: true,
        deliveryArtifactRefs: [],
      },
      {
        runId: "run-fallback",
        sceneappId: "story-video-suite",
        status: "success",
        source: "chat",
        sourceRef: "source-fallback",
        sessionId: "older-session",
        startedAt: "2026-04-16T12:00:00.000Z",
        finishedAt: "2026-04-16T12:03:00.000Z",
        artifactCount: 2,
        deliveryRequiredParts: ["brief", "storyboard"],
        deliveryCompletedParts: ["brief", "storyboard"],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        runtimeEvidenceUsed: true,
        deliveryArtifactRefs: [
          {
            partKey: "brief",
            relativePath: "packs/run-fallback/brief.md",
            absolutePath: "/tmp/packs/run-fallback/brief.md",
            projectId: "project-1",
            source: "runtime_evidence",
          },
        ],
      },
    ]);
    getSceneAppScorecardMock.mockResolvedValue({
      sceneappId: "story-video-suite",
      updatedAt: "2026-04-17T12:04:00.000Z",
      summary: "当前还在等待主运行写回结果。",
      metrics: [],
      recommendedAction: "keep",
      observedFailureSignals: [],
      topFailureSignal: null,
    });

    const { getValue } = renderHook({
      initialSummary: createInitialSummary(),
      sessionId: "session-1",
      isSending: true,
    });

    await flushEffects();

    expect(getValue()?.summary?.runtimeBackflow).toEqual(
      expect.objectContaining({
        runId: "run-current",
        statusLabel: "执行中",
      }),
    );
    expect(getValue()?.latestPackResultDetailView).toEqual(
      expect.objectContaining({
        runId: "run-fallback",
        deliveryArtifactEntries: [
          expect.objectContaining({
            label: "主稿 · 任务简报",
            pathLabel: "packs/run-fallback/brief.md",
          }),
        ],
      }),
    );
    expect(getValue()?.latestPackResultUsesFallback).toBe(true);
    expect(getValue()?.reviewTargetRunSummary).toEqual(
      expect.objectContaining({
        runId: "run-fallback",
        sessionId: "older-session",
      }),
    );
  });

  it("请求刷新时应重新拉取最新运行摘要与 scorecard", async () => {
    listSceneAppRunsMock.mockResolvedValue([
      {
        runId: "run-1",
        sceneappId: "story-video-suite",
        status: "success",
        source: "chat",
        sourceRef: "source-1",
        sessionId: "session-1",
        startedAt: "2026-04-17T12:00:00.000Z",
        finishedAt: "2026-04-17T12:03:00.000Z",
        artifactCount: 2,
        deliveryRequiredParts: ["brief", "storyboard"],
        deliveryCompletedParts: ["brief", "storyboard"],
        deliveryMissingParts: [],
        deliveryPartCoverageKnown: true,
        runtimeEvidenceUsed: true,
        deliveryArtifactRefs: [
          {
            partKey: "brief",
            relativePath: "packs/run-1/brief.md",
            absolutePath: "/tmp/packs/run-1/brief.md",
            projectId: "project-1",
            source: "runtime_evidence",
          },
        ],
      },
    ]);
    getSceneAppScorecardMock.mockResolvedValueOnce({
      sceneappId: "story-video-suite",
      updatedAt: "2026-04-17T12:04:00.000Z",
      summary: "当前建议继续保留，先观察下一轮样本。",
      metrics: [],
      recommendedAction: "keep",
      observedFailureSignals: [],
      topFailureSignal: null,
    });

    const { getValue } = renderHook({
      initialSummary: createInitialSummary(),
      sessionId: "session-1",
      isSending: false,
    });

    await flushEffects();

    expect(getValue()?.summary?.runtimeBackflow).toEqual(
      expect.objectContaining({
        scorecardActionLabel: "建议维持现状",
      }),
    );

    getSceneAppScorecardMock.mockResolvedValueOnce({
      sceneappId: "story-video-suite",
      updatedAt: "2026-04-17T12:08:00.000Z",
      summary: "当前建议继续优化后再放量。",
      metrics: [],
      recommendedAction: "optimize",
      observedFailureSignals: ["artifact_validation_issue"],
      topFailureSignal: "artifact_validation_issue",
    });

    await act(async () => {
      getValue()?.requestRefresh();
    });
    await flushEffects();

    expect(listSceneAppRunsMock).toHaveBeenCalledTimes(2);
    expect(getSceneAppScorecardMock).toHaveBeenCalledTimes(2);
    expect(getValue()?.summary?.runtimeBackflow).toEqual(
      expect.objectContaining({
        scorecardActionLabel: "建议继续优化",
        topFailureSignalLabel: "结果结构校验问题",
      }),
    );
  });
});
