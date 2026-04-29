import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPETITOR_FOCUS,
  DEFAULT_COMPETITOR_OUTPUT_FORMAT,
  parseCompetitorWorkbenchCommand,
} from "./competitorWorkbenchCommand";

describe("parseCompetitorWorkbenchCommand", () => {
  it("应解析自然语句竞品命令，并补齐默认 focus 与输出格式", () => {
    const result = parseCompetitorWorkbenchCommand(
      "@竞品 Claude 与 Gemini 在中国开发者市场的差异",
    );

    expect(result).toMatchObject({
      trigger: "@竞品",
      query: "Claude 与 Gemini 在中国开发者市场的差异",
      prompt: "Claude 与 Gemini 在中国开发者市场的差异",
      focus: DEFAULT_COMPETITOR_FOCUS,
      outputFormat: DEFAULT_COMPETITOR_OUTPUT_FORMAT,
    });
  });

  it("应兼容显式字段输入", () => {
    const result = parseCompetitorWorkbenchCommand(
      "@竞品 关键词:AI Coding 产品 站点:GitHub 时间:2026 重点:开发体验与定价 输出:对比矩阵",
    );

    expect(result).toMatchObject({
      trigger: "@竞品",
      query: "AI Coding 产品",
      site: "GitHub",
      timeRange: "2026",
      focus: "开发体验与定价",
      outputFormat: "对比矩阵",
    });
  });

  it("应兼容英文触发词", () => {
    const result = parseCompetitorWorkbenchCommand(
      "@competitor query: ai browser products focus: retention moat output: board memo",
    );

    expect(result).toMatchObject({
      trigger: "@competitor",
      query: "ai browser products",
      focus: "retention moat",
      outputFormat: "board memo",
    });
  });

  it("应兼容 @Product Search，并继续走产品研究主链", () => {
    const result = parseCompetitorWorkbenchCommand(
      "@Product Search OpenAI Operator 与 Manus 的产品定位差异",
    );

    expect(result).toMatchObject({
      trigger: "@Product Search",
      query: "OpenAI Operator 与 Manus 的产品定位差异",
      prompt: "OpenAI Operator 与 Manus 的产品定位差异",
      focus: DEFAULT_COMPETITOR_FOCUS,
      outputFormat: DEFAULT_COMPETITOR_OUTPUT_FORMAT,
    });
  });

  it("非竞品命令应返回空", () => {
    expect(
      parseCompetitorWorkbenchCommand("@研报 AI Agent 竞争格局"),
    ).toBeNull();
  });
});
