import { describe, expect, it } from "vitest";

import {
  buildGeneralAgentSystemPrompt,
  isGeneralResearchTheme,
  resolveAgentChatMode,
} from "./generalAgentPrompt";

describe("generalAgentPrompt", () => {
  it("应识别通用对话主题", () => {
    expect(isGeneralResearchTheme("general")).toBe(true);
    expect(isGeneralResearchTheme(" custom-theme ")).toBe(false);
    expect(isGeneralResearchTheme(undefined)).toBe(false);
  });

  it("工作台模式应优先返回 workbench", () => {
    expect(resolveAgentChatMode("general", true)).toBe("workbench");
    expect(resolveAgentChatMode("general", false)).toBe("general");
    expect(resolveAgentChatMode("custom-theme", false)).toBe("agent");
  });

  it("通用主题 Prompt 应避免编程和落盘默认倾向", () => {
    const prompt = buildGeneralAgentSystemPrompt("general", {
      now: new Date("2026-03-12T12:00:00+08:00"),
      toolPreferences: {
        webSearch: false,
        thinking: false,
        task: true,
        subagent: true,
      },
    });

    expect(prompt).toContain("不要把自己限制为编程助手");
    expect(prompt).toContain("不主动落盘");
    expect(prompt).toContain("需求澄清");
    expect(prompt).toContain("当前能力开关");
    expect(prompt).toContain("执行车道");
    expect(prompt).toContain("计划执行：已开启");
    expect(prompt).toContain("多代理：已开启");
    expect(prompt).toContain("统一使用 WebSearch");
    expect(prompt).toContain("不要混用 search/search_query/ToolSearch");
    expect(prompt).toContain("1 个当前最关键的问题");
    expect(prompt).toContain("合理假设补齐");
    expect(prompt).toContain("每轮最多只保留 1 个最关键问题");
  });

  it("通用主题 Prompt 应回落到统一的主题说明", () => {
    const prompt = buildGeneralAgentSystemPrompt("general");

    expect(prompt).toContain("当前主题：通用对话");
    expect(prompt).toContain("优先处理需求澄清");
    expect(prompt).toContain("不要一上来就走重链路");
    expect(prompt).toContain("3-4 组 WebSearch 扩搜");
  });

  it("通用主题 Prompt 仍应强调执行升级与团队协作边界", () => {
    const prompt = buildGeneralAgentSystemPrompt("general");

    expect(prompt).toContain("计划执行");
    expect(prompt).toContain("多代理");
    expect(prompt).toContain("如果进入计划执行或 Team 协作");
    expect(prompt).toContain("主对话负责解释分工");
  });

  it("工作区编排场景应注入 harness 上下文，并兼容旧 general workbench alias", () => {
    const prompt = buildGeneralAgentSystemPrompt("general", {
      harness: {
        sessionMode: "theme_workbench",
        gateKey: "research_mode",
        runTitle: "行业分析",
        contentId: "content-1",
      },
    });

    expect(prompt).toContain("工作区编排场景");
    expect(prompt).toContain("当前 gate：research_mode");
    expect(prompt).toContain("当前任务标题：行业分析");
    expect(prompt).toContain("当前内容 ID：content-1");
    expect(prompt).toContain("<proposed_plan>");
  });

  it("启用 Browser Assist 时应强制网页任务走 Lime 浏览器会话", () => {
    const prompt = buildGeneralAgentSystemPrompt("general", {
      harness: {
        browserAssistEnabled: true,
        browserAssistProfileKey: "general_browser_assist",
      },
    });

    expect(prompt).toContain("当前通用对话已启用 Browser Assist");
    expect(prompt).toContain("general_browser_assist");
    expect(prompt).toContain("Playwright code");
    expect(prompt).toContain("浏览器工作台");
    expect(prompt).toContain("browser session");
    expect(prompt).toContain("显式给出 URL");
    expect(prompt).toContain("不得先退化成 WebSearch");
    expect(prompt).toContain("一旦给了 URL，先打开页面");
    expect(prompt).toContain("service_skill_launch");
    expect(prompt).toContain("对话内 A2UI");
    expect(prompt).toContain("站点技能启动上下文");
    expect(prompt).toContain("lime_site_run");
    expect(prompt).toContain("mcp__lime-browser__browser_navigate");
    expect(prompt).toContain("严格 JSON 对象");
    expect(prompt).toContain("attached_session_required");
  });
});
