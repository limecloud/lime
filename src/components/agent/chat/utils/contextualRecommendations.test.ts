import { describe, expect, it } from "vitest";

import {
  buildRecommendationPrompt,
  getContextualRecommendations,
  isTeamRuntimeRecommendation,
} from "./contextualRecommendations";

describe("getContextualRecommendations", () => {
  it("空白引导场景应返回结构类推荐", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "",
      creationMode: "guided",
      hasCanvasContent: false,
      hasContentId: true,
      selectedText: "",
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.[0]).toContain("先搭结构");
  });

  it("已有正文时应优先返回改写类推荐", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "",
      creationMode: "hybrid",
      hasCanvasContent: true,
      hasContentId: true,
      selectedText: "",
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.[0]).toContain("润色");
  });

  it("有输入主题时应返回输入相关推荐", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "春季敏感肌修护",
      creationMode: "fast",
      hasCanvasContent: false,
      hasContentId: false,
      selectedText: "",
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.[1]).toContain("春季敏感肌修护");
  });

  it("通用主题应返回通用对话推荐", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "",
      creationMode: "guided",
      hasCanvasContent: false,
      hasContentId: false,
      selectedText: "",
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(
      recommendations.some(
        ([label]) => label.includes("任务拆分") || label.includes("父子线程"),
      ),
    ).toBe(true);
  });

  it("开启多代理偏好后应优先返回 team runtime 测试提示词", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "实现 team workspace UI 和实时订阅",
      creationMode: "guided",
      hasCanvasContent: false,
      hasContentId: false,
      selectedText: "",
      subagentEnabled: true,
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(
      recommendations.some(
        ([label, prompt]) =>
          label.includes("任务拆分") && prompt.includes("任务拆分方式"),
      ),
    ).toBe(true);
  });

  it("未开启多代理偏好时也应给出 team 测试入口，并提示先开启开关", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "",
      creationMode: "guided",
      hasCanvasContent: false,
      hasContentId: false,
      selectedText: "",
      subagentEnabled: false,
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(
      recommendations.some(
        ([label, prompt]) =>
          label.includes("任务拆分") && prompt.includes("任务拆分偏好"),
      ),
    ).toBe(true);
  });

  it("有选中文本时应优先返回选区改写推荐", () => {
    const recommendations = getContextualRecommendations({
      activeTheme: "general",
      input: "",
      creationMode: "guided",
      hasCanvasContent: true,
      hasContentId: true,
      selectedText: "这是一段待优化的原文内容。",
    });

    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0]?.[0]).toContain("选中");
  });

  it("构建推荐提示词时应注入选中文本上下文", () => {
    const prompt = buildRecommendationPrompt("请帮我改写内容。", "这是原文。");
    expect(prompt).toContain("请帮我改写内容。");
    expect(prompt).toContain("[参考选中内容]");
    expect(prompt).toContain("这是原文。");
  });

  it("无选中文本时应保持原始提示词", () => {
    const prompt = buildRecommendationPrompt("请帮我润色。", "");
    expect(prompt).toBe("请帮我润色。");
  });

  it("选中文本过长时应截断注入", () => {
    const longSelectedText = "a".repeat(380);
    const prompt = buildRecommendationPrompt("请总结。", longSelectedText);
    expect(prompt).toContain("[参考选中内容]");
    expect(prompt).toContain("…");
  });

  it("关闭附带选区开关时应忽略选中文本", () => {
    const prompt = buildRecommendationPrompt(
      "请润色文稿。",
      "这是一段选中的文稿内容。",
      false,
    );
    expect(prompt).toBe("请润色文稿。");
  });

  it("应识别 team runtime 类推荐", () => {
    expect(
      isTeamRuntimeRecommendation(
        "任务拆分冒烟测试",
        "请按任务拆分方式做一次冒烟测试：创建 explorer 与 executor 两个子任务并行处理。",
      ),
    ).toBe(true);
  });

  it("普通推荐不应被识别为 team runtime", () => {
    expect(
      isTeamRuntimeRecommendation(
        "需求澄清助手",
        "请先帮我澄清当前问题：目标是什么、已知条件是什么、缺失信息是什么。",
      ),
    ).toBe(false);
  });

  it("应识别 current 的生成工作台口径", () => {
    expect(
      isTeamRuntimeRecommendation(
        "父子线程联调",
        "请围绕当前主题做一次父子线程联调，并输出生成工作台视角的总结。",
      ),
    ).toBe(true);
  });
});
