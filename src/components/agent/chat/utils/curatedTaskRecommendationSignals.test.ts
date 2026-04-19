import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCuratedTaskTemplates, listFeaturedHomeCuratedTaskTemplates } from "./curatedTaskTemplates";
import { recordCuratedTaskRecommendationSignalFromMemory } from "./curatedTaskRecommendationSignals";

describe("curatedTaskRecommendationSignals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T03:15:00.000Z"));
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("保存到灵感库后的成果信号应把复盘模板抬进 featured 推荐", () => {
    recordCuratedTaskRecommendationSignalFromMemory(
      {
        id: "memory-review-1",
        session_id: "session-review-1",
        memory_type: "project",
        category: "experience",
        title: "账号复盘结论",
        summary: "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
        content: "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
        tags: ["复盘", "反馈", "增长"],
        metadata: {
          confidence: 0.92,
          importance: 8,
          access_count: 2,
          last_accessed_at: null,
          source: "manual",
          embedding: null,
        },
        created_at: 1_712_345_670_000,
        updated_at: 1_712_345_678_000,
        archived: false,
      },
      {
        projectId: "project-review",
      },
    );

    const featured = listFeaturedHomeCuratedTaskTemplates(
      listCuratedTaskTemplates(),
      {
        projectId: "project-review",
      },
    );

    const reviewTemplate = featured.find(
      (item) => item.template.id === "account-project-review",
    );

    expect(featured.map((item) => item.template.id)).toContain(
      "account-project-review",
    );
    expect(reviewTemplate?.badgeLabel).toBe("围绕最近成果");
    expect(reviewTemplate?.reasonSummary).toContain("账号复盘结论");
  });

  it("当前带入的参考灵感应给 featured 推荐打上当前参考标记", () => {
    const featured = listFeaturedHomeCuratedTaskTemplates(
      listCuratedTaskTemplates(),
      {
        referenceEntries: [
          {
            id: "memory-context-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的品牌语气参考。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      },
    );

    const socialPostTemplate = featured.find(
      (item) => item.template.id === "social-post-starter",
    );

    expect(socialPostTemplate?.badgeLabel).toBe("围绕当前参考");
    expect(socialPostTemplate?.reasonSummary).toContain("品牌风格样本");
  });
});
