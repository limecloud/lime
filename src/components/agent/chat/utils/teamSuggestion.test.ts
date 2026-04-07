import { describe, expect, it } from "vitest";
import { TEAM_SUGGESTION_THRESHOLD, getTeamSuggestion } from "./teamSuggestion";

describe("teamSuggestion", () => {
  it("显式要求 team runtime 时应给出高分建议", () => {
    const result = getTeamSuggestion({
      activeTheme: "general",
      input:
        "请按 team runtime 方式把这个任务拆成 explorer 和 executor 两个子代理并行处理，最后回到主线程汇总验证结果。",
    });

    expect(result.shouldSuggest).toBe(true);
    expect(result.score).toBeGreaterThan(0.75);
    expect(result.suggestedRoles).toEqual(["explorer", "executor", "verifier"]);
    expect(result.suggestedPresetId).toBe("code-triage-team");
    expect(result.suggestedPresetLabel).toBe("代码排障团队");
  });

  it("多阶段实现任务应建议启用 Team", () => {
    const result = getTeamSuggestion({
      activeTheme: "general",
      input:
        "请帮我分析这个前端问题，给出实现方案，完成修复，补测试并最终汇总结论。",
    });

    expect(result.shouldSuggest).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(TEAM_SUGGESTION_THRESHOLD);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.suggestedPresetId).toBe("code-triage-team");
  });

  it("简单单步任务不应建议 Team", () => {
    const result = getTeamSuggestion({
      activeTheme: "general",
      input: "请把这段文案润色一下",
    });

    expect(result.shouldSuggest).toBe(false);
    expect(result.score).toBeLessThan(TEAM_SUGGESTION_THRESHOLD);
  });

  it("已经开启多代理偏好时不应重复建议", () => {
    const result = getTeamSuggestion({
      activeTheme: "general",
      input: "请拆分任务并行分析、实现、验证，再汇总结论。",
      subagentEnabled: true,
    });

    expect(result.shouldSuggest).toBe(false);
    expect(result.score).toBe(0);
  });
});
