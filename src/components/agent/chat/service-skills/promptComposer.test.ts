import { describe, expect, it } from "vitest";
import {
  composeServiceSkillAutomationPrompt,
  composeServiceSkillPrompt,
  createDefaultServiceSkillSlotValues,
  formatServiceSkillPromptPreview,
  validateServiceSkillSlotValues,
} from "./promptComposer";
import type { ServiceSkillItem } from "./types";

const MOCK_SKILL: ServiceSkillItem = {
  id: "daily-trend-briefing",
  title: "每日趋势摘要",
  summary: "围绕指定平台与关键词输出趋势摘要。",
  category: "内容运营",
  outputHint: "趋势摘要 + 调度建议",
  source: "cloud_catalog",
  runnerType: "scheduled",
  defaultExecutorBinding: "automation_job",
  executionLocation: "client_default",
  promptTemplateKey: "trend_briefing",
  version: "seed-v1",
  slotSchema: [
    {
      key: "platform",
      label: "监测平台",
      type: "platform",
      required: true,
      placeholder: "选择平台",
      defaultValue: "x",
      options: [{ value: "x", label: "X / Twitter" }],
    },
    {
      key: "industry_keywords",
      label: "行业关键词",
      type: "textarea",
      required: true,
      placeholder: "输入关键词",
    },
  ],
};

describe("service skill prompt composer", () => {
  it("应创建默认槽位值并校验缺失字段", () => {
    const defaults = createDefaultServiceSkillSlotValues(MOCK_SKILL);

    expect(defaults).toEqual({
      platform: "x",
      industry_keywords: "",
    });

    const validation = validateServiceSkillSlotValues(MOCK_SKILL, defaults);

    expect(validation.valid).toBe(false);
    expect(validation.missing.map((slot) => slot.key)).toEqual([
      "industry_keywords",
    ]);
  });

  it("应生成预览与结构化 prompt", () => {
    const slotValues = {
      platform: "x",
      industry_keywords: "AI Agent，创作者工具",
    };

    expect(formatServiceSkillPromptPreview(MOCK_SKILL, slotValues)).toContain(
      "每日趋势摘要",
    );

    const prompt = composeServiceSkillPrompt({
      skill: MOCK_SKILL,
      slotValues,
      userInput: "重点关注过去 24 小时的新增热点。",
    });

    expect(prompt).toContain("[技能任务] 每日趋势摘要");
    expect(prompt).toContain("[执行位置] 客户端执行");
    expect(prompt).not.toContain("兼容旧目录标记");
    expect(prompt).toContain("- 行业关键词: AI Agent，创作者工具");
    expect(prompt).toContain("[补充要求] 重点关注过去 24 小时的新增热点。");
    expect(prompt).toContain("现在什么最热");
    expect(prompt).toContain("当前为客户端起步版");
    expect(prompt).toContain("单轮最多追问 1 个最关键问题");
    expect(prompt).toContain("不要一次性索要全部缺失参数");
  });

  it("应为 automation 生成独立执行要求", () => {
    const prompt = composeServiceSkillAutomationPrompt({
      skill: MOCK_SKILL,
      slotValues: {
        platform: "x",
        industry_keywords: "AI Agent，创作者工具",
      },
    });

    expect(prompt).toContain("[自动化执行要求]");
    expect(prompt).toContain("对比上轮变化");
    expect(prompt).not.toContain("当前为客户端起步版");
    expect(prompt).toContain("单轮最多追问 1 个最关键问题");
  });

  it("远端目录缺少 promptTemplateKey 时应回退到 skillKey 推断模板", () => {
    const prompt = composeServiceSkillPrompt({
      skill: {
        ...MOCK_SKILL,
        id: "service-skill-0005",
        skillKey: "daily-trend-briefing",
        promptTemplateKey: undefined,
      },
      slotValues: {
        platform: "x",
        industry_keywords: "AI Agent，创作者工具",
      },
    });

    expect(prompt).toContain("现在什么最热");
  });
});
