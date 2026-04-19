import { describe, expect, it } from "vitest";
import {
  buildCuratedTaskLaunchRequestMetadata,
  buildCuratedTaskReferencePromptBlock,
} from "./curatedTaskReferenceSelection";

describe("buildCuratedTaskReferencePromptBlock", () => {
  it("应把灵感引用编译成首轮 prompt 可读块", () => {
    expect(
      buildCuratedTaskReferencePromptBlock([
        {
          id: "memory-1",
          title: "品牌风格样本",
          summary: "保留轻盈但专业的表达。",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "语气"],
        },
      ]),
    ).toContain("[参考] 品牌风格样本");
  });
});

describe("buildCuratedTaskLaunchRequestMetadata", () => {
  it("应把结果模板启动信息和灵感引用写进统一 metadata", () => {
    const result = buildCuratedTaskLaunchRequestMetadata({
      taskId: "daily-trend-briefing",
      taskTitle: "每日趋势摘要",
      inputValues: {
        theme_target: "AI 内容创作",
        platform_region: "X 与 TikTok 北美区",
      },
      referenceMemoryIds: ["memory-1"],
      referenceEntries: [
        {
          id: "memory-1",
          title: "品牌风格样本",
          summary: "保留轻盈但专业的表达。",
          category: "context",
          categoryLabel: "参考",
          tags: ["品牌", "语气"],
        },
      ],
    });

    expect(result).toMatchObject({
      harness: {
        creation_replay: expect.objectContaining({
          kind: "memory_entry",
          data: expect.objectContaining({
            title: "品牌风格样本",
            category: "context",
          }),
        }),
        curated_task: {
          task_id: "daily-trend-briefing",
          task_title: "每日趋势摘要",
          launch_input_values: {
            theme_target: "AI 内容创作",
            platform_region: "X 与 TikTok 北美区",
          },
          reference_memory_ids: ["memory-1"],
          reference_memory_entries: [
            expect.objectContaining({
              id: "memory-1",
              title: "品牌风格样本",
            }),
          ],
        },
      },
    });
  });
});
