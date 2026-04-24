import { describe, expect, it } from "vitest";
import {
  buildCuratedTaskLaunchInputPrefillFromReferenceEntries,
  buildCuratedTaskLaunchRequestMetadata,
  buildCuratedTaskReferenceEntries,
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

  it("应把成果类灵感条目编译成可直接复盘的 launcher 预填", () => {
    const [entry] = buildCuratedTaskReferenceEntries([
      {
        id: "memory-review-1",
        session_id: "session-1",
        memory_type: "conversation",
        category: "experience",
        title: "短视频编排 · 复核阻塞",
        summary: "当前结果包已完整回流，可继续进入下一轮。",
        content: [
          "场景：短视频编排",
          "平台：X + TikTok",
          "地区：北美",
          "目标受众：正在复盘短视频增长的品牌运营",
          "结果摘要：这轮内容已经产出一版完整结果包。",
          "当前交付：已交付 3/4 个部件",
          "建议下一步：先完成复核，再决定下一轮放量",
          "当前信号：复核阻塞",
        ].join("\n"),
        tags: ["短视频", "复核阻塞"],
        metadata: {
          confidence: 0.9,
          importance: 8,
          access_count: 0,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_600_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
    ]);

    expect(entry?.taskPrefillByTaskId?.["account-project-review"]).toEqual({
      project_goal: "短视频编排",
      existing_results: expect.stringContaining(
        "当前结果包已完整回流，可继续进入下一轮。",
      ),
    });
    expect(
      entry?.taskPrefillByTaskId?.["account-project-review"]?.existing_results,
    ).toContain("当前交付：已交付 3/4 个部件");
    expect(
      entry?.taskPrefillByTaskId?.["account-project-review"]?.existing_results,
    ).toContain("建议下一步：先完成复核，再决定下一轮放量");
    expect(entry?.taskPrefillByTaskId?.["daily-trend-briefing"]).toEqual({
      theme_target: "短视频编排",
      platform_region: "X + TikTok（北美）",
    });
    expect(entry?.taskPrefillByTaskId?.["social-post-starter"]).toEqual({
      subject_or_product: expect.stringContaining("当前主题：短视频编排"),
      target_audience: "正在复盘短视频增长的品牌运营",
    });
    expect(
      buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
        taskId: "account-project-review",
        referenceEntries: entry ? [entry] : [],
      }),
    ).toEqual({
      project_goal: "短视频编排",
      existing_results: expect.stringContaining("当前结果包已完整回流"),
    });
    expect(
      buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
        taskId: "daily-trend-briefing",
        referenceEntries: entry ? [entry] : [],
      }),
    ).toEqual({
      theme_target: "短视频编排",
      platform_region: "X + TikTok（北美）",
    });
    expect(
      buildCuratedTaskLaunchInputPrefillFromReferenceEntries({
        taskId: "social-post-starter",
        referenceEntries: entry ? [entry] : [],
      }),
    ).toEqual({
      subject_or_product: expect.stringContaining("当前结果基线："),
      target_audience: "正在复盘短视频增长的品牌运营",
    });
  });
});
