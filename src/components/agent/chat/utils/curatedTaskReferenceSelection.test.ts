import { describe, expect, it } from "vitest";
import {
  buildCuratedTaskLaunchInputPrefillFromReferenceEntries,
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
          reference_entries: [
            expect.objectContaining({
              id: "memory-1",
              title: "品牌风格样本",
            }),
          ],
        },
      },
    });
  });

  it("应只把 memory reference 写入 reference_memory_ids", () => {
    const result = buildCuratedTaskLaunchRequestMetadata({
      taskId: "account-project-review",
      taskTitle: "复盘这个账号/项目",
      referenceEntries: [
        {
          id: "sceneapp:content-pack:run:1",
          sourceKind: "sceneapp_execution_summary",
          title: "AI 内容周报",
          summary: "当前已有一轮运行结果，可直接作为复盘基线。",
          category: "experience",
          categoryLabel: "成果",
          tags: ["复盘"],
          taskPrefillByTaskId: {
            "account-project-review": {
              project_goal: "AI 内容周报",
              existing_results: "当前已有一轮运行结果。",
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      harness: {
        curated_task: {
          task_id: "account-project-review",
          reference_entries: [
            expect.objectContaining({
              id: "sceneapp:content-pack:run:1",
              source_kind: "sceneapp_execution_summary",
            }),
          ],
        },
      },
    });
    expect(
      (result.harness as { curated_task: { reference_memory_ids?: string[] } })
        .curated_task.reference_memory_ids,
    ).toBeUndefined();
    expect(
      (result.harness as { creation_replay?: unknown }).creation_replay,
    ).toBeUndefined();
  });
});

describe("buildCuratedTaskLaunchInputPrefillFromReferenceEntries", () => {
  it("应把 sceneapp reference 的 task prefill 回填到 launcher 输入", () => {
    expect(
      buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
        taskId: "account-project-review",
        referenceEntries: [
          {
            id: "sceneapp:content-pack:run:1",
            sourceKind: "sceneapp_execution_summary",
            title: "AI 内容周报",
            summary: "当前已有一轮运行结果，可直接作为复盘基线。",
            category: "experience",
            categoryLabel: "成果",
            tags: ["复盘"],
            taskPrefillByTaskId: {
              "account-project-review": {
                project_goal: "AI 内容周报",
                existing_results: "当前已有一轮运行结果。",
              },
            },
          },
        ],
      }),
    ).toEqual({
      project_goal: "AI 内容周报",
      existing_results: "当前已有一轮运行结果。",
    });
  });
});
