import { describe, expect, it } from "vitest";
import {
  buildSceneAppExecutionPromptActions,
  type SceneAppRunDetailViewModel,
} from "./index";

function createRunDetailView(
  overrides: Partial<SceneAppRunDetailViewModel> = {},
): SceneAppRunDetailViewModel {
  return {
    runId: "run-1",
    status: "success",
    statusLabel: "成功",
    stageLabel: "结果已交付",
    summary: "当前结果包已经回流。",
    nextAction: "继续复核或发布。",
    sourceLabel: "对话执行",
    artifactCount: 1,
    deliveryCompletionLabel: "整包已交齐 2/2 个部件",
    deliverySummary: "当前结果包已完整回流。",
    deliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "cover", label: "封面图" },
    ],
    deliveryCompletedParts: [
      { key: "brief", label: "任务简报" },
      { key: "cover", label: "封面图" },
    ],
    deliveryMissingParts: [],
    deliveryPartCoverageKnown: true,
    deliveryViewerLabel: "结果包查看",
    packCompletionStrategyLabel: "按必含部件判断整包完成度",
    packViewerLabel: "结果包查看",
    plannedDeliveryRequiredParts: [
      { key: "brief", label: "任务简报" },
      { key: "cover", label: "封面图" },
    ],
    packPlanNotes: [],
    contextBaseline: null,
    deliveryArtifactEntries: [
      {
        key: "brief-0",
        label: "主稿 · 任务简报",
        pathLabel: "packs/run-1/brief.md",
        helperText: "直接打开结果文件。",
        isPrimary: true,
        artifactRef: {
          partKey: "brief",
          relativePath: "packs/run-1/brief.md",
          absolutePath: "/tmp/packs/run-1/brief.md",
          projectId: "project-1",
          source: "runtime_evidence",
        },
      },
    ],
    governanceActionEntries: [],
    governanceArtifactEntries: [],
    failureSignalLabel: undefined,
    evidenceSourceLabel: "当前已接入会话证据",
    requestTelemetryLabel: "已关联请求遥测",
    artifactValidatorLabel: "Artifact 校验通过",
    evidenceKnownGaps: [],
    verificationFailureOutcomes: [],
    startedAtLabel: "2026-04-18 10:00",
    finishedAtLabel: "2026-04-18 10:03",
    durationLabel: "3 分钟",
    entryAction: null,
    ...overrides,
  };
}

describe("buildSceneAppExecutionPromptActions", () => {
  it("缺件时应生成补件、发布前检查与受阻的发布整理动作", () => {
    const actions = buildSceneAppExecutionPromptActions(
      createRunDetailView({
        deliveryCompletedParts: [{ key: "brief", label: "任务简报" }],
        deliveryMissingParts: [{ key: "cover", label: "封面图" }],
        deliveryCompletionLabel: "整包已交付 1/2 个部件",
        deliverySummary: "当前结果包还缺封面图。",
      }),
    );

    expect(actions.map((action) => action.key)).toEqual([
      "fill_missing_parts",
      "publish_check",
      "publish_prepare",
      "channel_preview",
      "upload_prepare",
    ]);
    expect(actions[0]?.prompt).toContain("补齐缺失部件：封面图");
    expect(actions[1]?.prompt).toContain("@发布合规");
    expect(actions[1]?.prompt).toContain("当前仍缺的封面图");
    expect(actions[2]?.prompt).toContain("@发布");
    expect(actions[2]?.disabledReason).toBe("当前还缺 封面图");
    expect(actions[3]?.prompt).toContain("@渠道预览");
    expect(actions[3]?.disabledReason).toBe("当前还缺 封面图");
    expect(actions[4]?.prompt).toContain("@上传");
    expect(actions[4]?.disabledReason).toBe("当前还缺 封面图");
  });

  it("没有缺件但存在失败信号时应阻止直接进入发布整理", () => {
    const actions = buildSceneAppExecutionPromptActions(
      createRunDetailView({
        failureSignalLabel: "发布卡点",
      }),
    );

    expect(actions.map((action) => action.key)).toEqual([
      "publish_check",
      "publish_prepare",
      "channel_preview",
      "upload_prepare",
    ]);
    expect(actions[0]?.disabledReason).toBeUndefined();
    expect(actions[1]?.disabledReason).toBe("当前还有发布卡点");
    expect(actions[2]?.disabledReason).toBe("当前还有发布卡点");
    expect(actions[3]?.disabledReason).toBe("当前还有发布卡点");
  });

  it("发布就绪时应继续给出渠道预览与上传稿动作", () => {
    const actions = buildSceneAppExecutionPromptActions(createRunDetailView());

    expect(actions.map((action) => action.key)).toEqual([
      "publish_check",
      "publish_prepare",
      "channel_preview",
      "upload_prepare",
    ]);
    expect(actions[2]).toMatchObject({
      key: "channel_preview",
      disabledReason: undefined,
    });
    expect(actions[3]).toMatchObject({
      key: "upload_prepare",
      disabledReason: undefined,
    });
  });
});
