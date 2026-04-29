import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
} from "./curatedTaskTemplates";
import {
  CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
  recordCuratedTaskRecommendationSignalFromMemory,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "./curatedTaskRecommendationSignals";

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
        summary:
          "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
        content:
          "最近两次反馈都提示封面信息过密，需要继续复盘增长数据并优化结构。",
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
    expect(reviewTemplate?.reasonSummary).toBe("成果：账号复盘结论");
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
    expect(socialPostTemplate?.reasonSummary).toBe("参考：品牌风格样本");
  });

  it("当前带入风格参考时应显式标记为围绕当前风格", () => {
    const featured = listFeaturedHomeCuratedTaskTemplates(
      listCuratedTaskTemplates(),
      {
        referenceEntries: [
          {
            id: "memory-identity-1",
            title: "品牌风格样本",
            summary: "偏好克制的科技蓝与留白型构图。",
            category: "identity",
            categoryLabel: "风格",
            tags: ["科技蓝", "留白"],
          },
        ],
      },
    );

    const socialPostTemplate = featured.find(
      (item) => item.template.id === "social-post-starter",
    );

    expect(socialPostTemplate?.badgeLabel).toBe("围绕当前风格");
    expect(socialPostTemplate?.reasonSummary).toBe("风格：品牌风格样本");
  });

  it("最近判断反馈应把补证据链路抬进 featured 推荐", () => {
    recordCuratedTaskRecommendationSignalFromReviewDecision(
      {
        session_id: "session-review-2",
        decision_status: "needs_more_evidence",
        decision_summary:
          "这轮结果还缺证据，需要回到账号表现和爆款样本继续补证据。",
        chosen_fix_strategy: "先补账号数据复盘，再拆一轮高表现内容做对照。",
        risk_level: "medium",
        risk_tags: ["证据不足", "需要复盘"],
        followup_actions: ["补账号数据复盘", "拆解一条高表现内容"],
      },
      {
        projectId: "project-review-needs-evidence",
        sceneTitle: "短视频编排",
      },
    );

    const featured = listFeaturedHomeCuratedTaskTemplates(
      listCuratedTaskTemplates(),
      {
        projectId: "project-review-needs-evidence",
      },
    );

    expect(featured[0]?.template.id).toBe("account-project-review");
    expect(featured[1]?.template.id).toBe("viral-content-breakdown");
    expect(featured[0]?.badgeLabel).toBe("围绕最近判断");
    expect(featured[0]?.reasonSummary).toContain("短视频编排");
    expect(
      featured
        .map((item) => item.template.id)
        .indexOf("account-project-review"),
    ).toBeLessThan(
      featured.map((item) => item.template.id).indexOf("daily-trend-briefing"),
    );
  });

  it("统一订阅入口应同时响应自定义事件与 storage 变更", () => {
    const callback = vi.fn();
    const unsubscribe =
      subscribeCuratedTaskRecommendationSignalsChanged(callback);

    window.dispatchEvent(
      new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "lime:curated-task-recommendation-signals:v1",
      }),
    );

    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();

    window.dispatchEvent(
      new CustomEvent(CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT),
    );

    expect(callback).toHaveBeenCalledTimes(2);
  });
});
