import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_REVIEW_EXPERTS } from "./contentReviewExperts";

describe("DEFAULT_CONTENT_REVIEW_EXPERTS", () => {
  it("应使用新的评审专家名单", () => {
    expect(DEFAULT_CONTENT_REVIEW_EXPERTS.map((expert) => expert.name)).toEqual([
      "林岑·叙事总编",
      "许衡·事实核验官",
      "周映·传播策略师",
      "沈既白·语气润色官",
      "顾澄·风险把关人",
      "贺知南·读者洞察师",
    ]);

    expect(DEFAULT_CONTENT_REVIEW_EXPERTS.map((expert) => expert.name)).not.toContain(
      "赵宣·资深编辑",
    );
    expect(DEFAULT_CONTENT_REVIEW_EXPERTS.map((expert) => expert.name)).not.toContain(
      "罗辑·逻辑结构师",
    );
  });
});
