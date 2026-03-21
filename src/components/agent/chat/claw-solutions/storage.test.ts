import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getClawSolutionUsageMap,
  listClawSolutionUsage,
  recordClawSolutionUsage,
} from "./storage";

describe("claw solution storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("应按最近时间记录方案使用", () => {
    recordClawSolutionUsage({
      solutionId: "web-research-brief",
      usedAt: 100,
      actionType: "fill_input",
    });
    recordClawSolutionUsage({
      solutionId: "team-breakdown",
      usedAt: 300,
      actionType: "enable_team_mode",
    });
    recordClawSolutionUsage({
      solutionId: "web-research-brief",
      usedAt: 500,
      actionType: "fill_input",
      themeTarget: "general",
    });

    expect(listClawSolutionUsage()).toEqual([
      {
        solutionId: "web-research-brief",
        usedAt: 500,
        actionType: "fill_input",
        themeTarget: "general",
      },
      {
        solutionId: "team-breakdown",
        usedAt: 300,
        actionType: "enable_team_mode",
        themeTarget: null,
      },
    ]);
  });

  it("应提供按方案 ID 查询的映射", () => {
    recordClawSolutionUsage({
      solutionId: "social-post-starter",
      usedAt: 200,
      actionType: "navigate_theme",
      themeTarget: "social-media",
    });

    const usageMap = getClawSolutionUsageMap();
    expect(usageMap.get("social-post-starter")).toEqual({
      solutionId: "social-post-starter",
      usedAt: 200,
      actionType: "navigate_theme",
      themeTarget: "social-media",
    });
  });
});
