import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findCuratedTaskTemplateById,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  resolveCuratedTaskFollowUpActionTarget,
  subscribeCuratedTaskTemplateUsageChanged,
} from "./curatedTaskTemplates";
import { buildCuratedTaskReferenceEntries } from "./curatedTaskReferenceSelection";

describe("curatedTaskTemplates", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("复盘模板的下游动作应能路由到正确的结果模板", () => {
    const resolved = resolveCuratedTaskFollowUpActionTarget({
      taskId: "account-project-review",
      action: "生成下一轮内容方案",
    });

    expect(resolved).toEqual({
      task: findCuratedTaskTemplateById("social-post-starter"),
      promptHint: "请承接这轮判断结论，直接生成下一轮最值得执行的内容方案。",
    });
  });

  it("没有显式路由的动作应继续返回空结果", () => {
    expect(
      resolveCuratedTaskFollowUpActionTarget({
        taskId: "daily-trend-briefing",
        action: "继续展开其中一个选题",
      }),
    ).toBeNull();
  });

  it("记录 recent usage 时应发出统一 changed 事件", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeCuratedTaskTemplateUsageChanged(callback);

    recordCuratedTaskTemplateUsage({
      templateId: "daily-trend-briefing",
      launchInputValues: {
        theme_target: "AI 内容创作",
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("成果参考对象应为下游模板生成更明确的续接理由", () => {
    const referenceEntries = buildCuratedTaskReferenceEntries([
      {
        id: "memory-experience-1",
        session_id: "session-1",
        memory_type: "conversation",
        category: "experience",
        title: "短视频编排 · 复核阻塞",
        summary: "当前结果包已完整回流，可继续进入下一轮。",
        content: [
          "场景：短视频编排",
          "结果摘要：这轮内容已经产出一版完整结果包。",
          "当前交付：已交付 3/4 个部件",
          "建议下一步：先完成复核，再决定下一轮放量",
          "当前信号：复核阻塞",
        ].join("\n"),
        updated_at: 1_712_345_779_000,
        created_at: 1_712_345_700_000,
        tags: ["短视频", "复核阻塞"],
        archived: false,
        metadata: {
          confidence: 1,
          importance: 8,
          access_count: 0,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
      },
    ]);

    const featured = listFeaturedHomeCuratedTaskTemplates(undefined, {
      referenceEntries,
      limit: 3,
    });

    expect(featured.map((item) => item.template.id)).toEqual([
      "account-project-review",
      "daily-trend-briefing",
      "social-post-starter",
    ]);
    expect(featured[0]).toEqual(
      expect.objectContaining({
        reasonLabel: "围绕当前成果",
        reasonSummary:
          "先对齐「短视频编排 · 复核阻塞」这轮结果基线，再决定下一轮动作",
      }),
    );
    expect(featured[1]).toEqual(
      expect.objectContaining({
        reasonLabel: "承接当前结果",
        reasonSummary: "围绕「短视频编排 · 复核阻塞」这轮结果继续找趋势窗口",
      }),
    );
    expect(featured[2]).toEqual(
      expect.objectContaining({
        reasonLabel: "承接当前结果",
        reasonSummary: "把「短视频编排 · 复核阻塞」这轮结果直接带成下一版主稿",
      }),
    );
  });
});
