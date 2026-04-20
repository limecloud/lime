import { describe, expect, it } from "vitest";
import {
  buildRuntimeInitialInputCapabilityFromFollowUpAction,
  resolveEffectiveInitialInputCapability,
} from "./inputCapabilityBootstrap";

describe("inputCapabilityBootstrap", () => {
  it("应优先选择 requestKey 更新的 runtime capability", () => {
    expect(
      resolveEffectiveInitialInputCapability({
        bootstrap: {
          capabilityRoute: {
            kind: "curated_task",
            taskId: "daily-trend-briefing",
            taskTitle: "每日趋势摘要",
            prompt: "旧 prompt",
          },
          requestKey: 10,
        },
        runtime: {
          capabilityRoute: {
            kind: "curated_task",
            taskId: "daily-trend-briefing",
            taskTitle: "每日趋势摘要",
            prompt: "新 prompt",
          },
          requestKey: 20,
        },
      }),
    ).toEqual({
      capabilityRoute: {
        kind: "curated_task",
        taskId: "daily-trend-briefing",
        taskTitle: "每日趋势摘要",
        prompt: "新 prompt",
      },
      requestKey: 20,
    });
  });

  it("应把 follow-up prompt 同步回 runtime curated_task route", () => {
    expect(
      buildRuntimeInitialInputCapabilityFromFollowUpAction({
        payload: {
          prompt: "  请基于当前结果继续：生成首条内容主稿  ",
          capabilityRoute: {
            kind: "curated_task",
            taskId: "daily-trend-briefing",
            taskTitle: "每日趋势摘要",
            prompt: "旧 prompt",
            launchInputValues: {
              theme_target: "AI 内容创作",
            },
            referenceMemoryIds: ["memory-1"],
            referenceEntries: [
              {
                id: "memory-1",
                title: "品牌风格样本",
                summary: "保留轻盈但专业的表达。",
                category: "context",
                categoryLabel: "参考",
                tags: ["品牌"],
              },
            ],
          },
        },
        requestKey: 30,
      }),
    ).toEqual({
      capabilityRoute: {
        kind: "curated_task",
        taskId: "daily-trend-briefing",
        taskTitle: "每日趋势摘要",
        prompt: "请基于当前结果继续：生成首条内容主稿",
        launchInputValues: {
          theme_target: "AI 内容创作",
        },
        referenceMemoryIds: ["memory-1"],
        referenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌"],
          },
        ],
      },
      requestKey: 30,
    });
  });
});
