import { describe, expect, it } from "vitest";
import { buildSceneAppExecutionPromptActionPayload } from "./sceneAppExecutionPromptContinuation";

describe("sceneAppExecutionPromptContinuation", () => {
  it("发布类动作应切回对应的 builtin command capability", () => {
    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "publish_check",
          label: "发布前检查",
          helperText: "检查当前发布风险。",
          prompt: "@发布合规 请基于当前结果做发布前检查。",
          tone: "neutral",
        },
      }),
    ).toEqual({
      prompt: "@发布合规 请基于当前结果做发布前检查。",
      bannerMessage: "已切到“发布前检查”这条下一步，可继续改写后发送。",
      capabilityRoute: {
        kind: "builtin_command",
        commandKey: "publish_compliance",
        commandPrefix: "@发布合规",
      },
    });

    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "publish_prepare",
          label: "进入发布整理",
          helperText: "整理最终发布稿。",
          prompt: "@发布 请基于当前结果整理最终发布稿。",
          tone: "positive",
        },
      }),
    ).toEqual({
      prompt: "@发布 请基于当前结果整理最终发布稿。",
      bannerMessage: "已切到“进入发布整理”这条下一步，可继续改写后发送。",
      capabilityRoute: {
        kind: "builtin_command",
        commandKey: "publish_runtime",
        commandPrefix: "@发布",
      },
    });

    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "channel_preview",
          label: "生成渠道预览稿",
          helperText: "预览首屏和封面。",
          prompt: "@渠道预览 请基于当前结果生成渠道预览稿。",
          tone: "neutral",
        },
      }),
    ).toEqual({
      prompt: "@渠道预览 请基于当前结果生成渠道预览稿。",
      bannerMessage: "已切到“生成渠道预览稿”这条下一步，可继续改写后发送。",
      capabilityRoute: {
        kind: "builtin_command",
        commandKey: "channel_preview_runtime",
        commandPrefix: "@渠道预览",
      },
    });

    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "upload_prepare",
          label: "整理上传稿",
          helperText: "整理上传前素材。",
          prompt: "@上传 请基于当前结果整理上传稿。",
          tone: "positive",
        },
      }),
    ).toEqual({
      prompt: "@上传 请基于当前结果整理上传稿。",
      bannerMessage: "已切到“整理上传稿”这条下一步，可继续改写后发送。",
      capabilityRoute: {
        kind: "builtin_command",
        commandKey: "upload_runtime",
        commandPrefix: "@上传",
      },
    });
  });

  it("补齐缺失部件在有 linked scene key 时应切回 runtime scene capability", () => {
    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "fill_missing_parts",
          label: "补齐缺失部件",
          helperText: "继续补齐缺件。",
          prompt: "请基于当前结果继续补齐缺失部件。",
          tone: "warning",
        },
        summary: {
          sceneappId: "story-video-suite",
          title: "短视频编排",
          summary: "当前结果已进入补件阶段。",
          businessLabel: "内容闭环",
          typeLabel: "多模态组合",
          executionChainLabel: "做法 -> 生成 -> Project Pack",
          deliveryContractLabel: "Project Pack",
          planningStatusLabel: "已就绪",
          planningSummary: "已装配上下文。",
          activeLayers: [],
          referenceCount: 0,
          referenceItems: [],
          projectPackPlan: null,
          scorecardMetricKeys: [],
          scorecardFailureSignals: [],
          notes: [],
          descriptorSnapshot: {
            deliveryContract: "project_pack",
            linkedSceneKey: "story-video-suite",
          },
          runtimeBackflow: null,
        },
      }),
    ).toEqual({
      prompt: "请基于当前结果继续补齐缺失部件。",
      bannerMessage: "已切到“补齐缺失部件”这条下一步，可继续改写后发送。",
      capabilityRoute: {
        kind: "runtime_scene",
        sceneKey: "story-video-suite",
        commandPrefix: "/story-video-suite",
      },
    });
  });

  it("补齐缺失部件在缺少 scene key 时应继续回退到 prompt-only", () => {
    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "fill_missing_parts",
          label: "补齐缺失部件",
          helperText: "继续补齐缺件。",
          prompt: "请基于当前结果继续补齐缺失部件。",
          tone: "warning",
        },
      }),
    ).toEqual({
      prompt: "请基于当前结果继续补齐缺失部件。",
      bannerMessage: "已切到“补齐缺失部件”这条下一步，可继续改写后发送。",
    });
  });

  it("空 prompt 应返回空结果", () => {
    expect(
      buildSceneAppExecutionPromptActionPayload({
        action: {
          key: "publish_check",
          label: "发布前检查",
          helperText: "检查当前发布风险。",
          prompt: "   ",
          tone: "neutral",
        },
      }),
    ).toBeNull();
  });
});
