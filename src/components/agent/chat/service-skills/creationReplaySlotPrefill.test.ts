import { describe, expect, it } from "vitest";
import { buildCreationReplaySlotPrefill } from "./creationReplaySlotPrefill";
import type { ServiceSkillHomeItem } from "./types";

const BASE_SKILL: ServiceSkillHomeItem = {
  id: "prefill-target-skill",
  skillType: "service",
  title: "测试技能",
  summary: "测试 creation replay 预填。",
  category: "内容创作",
  outputHint: "测试输出",
  source: "cloud_catalog",
  runnerType: "instant",
  defaultExecutorBinding: "agent_turn",
  executionLocation: "client_default",
  version: "seed-v1",
  slotSchema: [],
  badge: "云目录",
  recentUsedAt: null,
  isRecent: false,
  runnerLabel: "本地即时执行",
  runnerTone: "sky",
  runnerDescription: "测试描述",
  actionLabel: "对话内补参",
  automationStatus: null,
};

describe("buildCreationReplaySlotPrefill", () => {
  it("应把灵感条目映射成服务技能参数预填", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "platform",
            label: "发布平台",
            type: "platform",
            required: true,
            defaultValue: "general",
            placeholder: "选择平台",
            options: [
              { value: "xiaohongshu", label: "小红书" },
              { value: "general", label: "通用平台" },
            ],
          },
          {
            key: "voice_style",
            label: "旁白风格",
            type: "text",
            required: false,
            placeholder: "输入风格",
          },
          {
            key: "industry_keywords",
            label: "行业关键词",
            type: "textarea",
            required: false,
            placeholder: "输入关键词",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
          entry_id: "memory-1",
        },
        data: {
          category: "identity",
          title: "AI Agent 小红书口播",
          summary: "整体语气更轻快、像真实创作者分享。",
          tags: ["小红书", "AI Agent", "口播"],
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        platform: "xiaohongshu",
        voice_style: "AI Agent 小红书口播、整体语气更轻快、像真实创作者分享。",
        industry_keywords: "小红书、AI Agent、口播、AI Agent 小红书口播",
      },
      fieldLabels: ["发布平台", "旁白风格", "行业关键词"],
      hint: "已根据当前灵感条目自动预填 发布平台、旁白风格、行业关键词，可继续修改后执行。",
    });
  });

  it("预填提示允许调用方注入本地化 copy", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "platform",
            label: "Platform",
            type: "platform",
            required: true,
            defaultValue: "general",
            placeholder: "Choose platform",
            options: [
              { value: "xiaohongshu", label: "Rednote" },
              { value: "general", label: "General" },
            ],
          },
          {
            key: "voice_style",
            label: "Voice",
            type: "text",
            required: false,
            placeholder: "Voice",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
          entry_id: "memory-1",
        },
        data: {
          category: "identity",
          title: "AI Agent 小红书口播",
          summary: "整体语气更轻快、像真实创作者分享。",
          tags: ["小红书", "AI Agent", "口播"],
        },
      },
      {
        sourceLabels: {
          memoryEntry: "the current idea",
        },
        formatFieldSummary: (visibleLabels) => visibleLabels.join(", "),
        formatHint: (sourceLabel, fieldSummary) =>
          `Prefilled ${fieldSummary} from ${sourceLabel}. Review before running.`,
      },
    );

    expect(result?.hint).toBe(
      "Prefilled Platform, Voice from the current idea. Review before running.",
    );
  });

  it("应把趋势和调度线索映射到更完整的运营类参数", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "platform",
            label: "监测平台",
            type: "platform",
            required: true,
            defaultValue: "general",
            placeholder: "选择平台",
            options: [
              { value: "x", label: "X / Twitter" },
              { value: "general", label: "通用平台" },
            ],
          },
          {
            key: "industry_keywords",
            label: "行业关键词",
            type: "textarea",
            required: true,
            placeholder: "输入关键词",
          },
          {
            key: "time_window",
            label: "时间范围",
            type: "text",
            required: true,
            defaultValue: "过去 24 小时",
            placeholder: "输入时间范围",
          },
          {
            key: "region",
            label: "地区",
            type: "text",
            required: false,
            defaultValue: "全球",
            placeholder: "输入地区",
          },
          {
            key: "schedule_time",
            label: "推送时间",
            type: "schedule_time",
            required: false,
            defaultValue: "每天 09:00",
            placeholder: "输入推送时间",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
          entry_id: "memory-trend-1",
        },
        data: {
          category: "preference",
          title: "北美 AI Agent X 趋势巡检",
          summary: "过去 7 天，每天 08:30 关注 X 上 AI Agent 热点。",
          tags: ["北美", "AI Agent", "X / Twitter"],
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        platform: "x",
        industry_keywords:
          "北美、AI Agent、X / Twitter、北美 AI Agent X 趋势巡检",
        time_window: "过去 7 天",
        region: "北美",
        schedule_time: "每天 08:30",
      },
      fieldLabels: ["监测平台", "行业关键词", "时间范围", "地区", "推送时间"],
      hint: "已根据当前灵感条目自动预填 监测平台、行业关键词、时间范围 等参数，可继续修改后执行。",
    });
  });

  it("应从账号和阈值线索里补入增长类参数", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "account_list",
            label: "参考账号 / 目标账号",
            type: "account_list",
            required: true,
            placeholder: "输入账号",
          },
          {
            key: "report_cadence",
            label: "回报频率",
            type: "schedule_time",
            required: false,
            defaultValue: "每天 10:00",
            placeholder: "输入频率",
          },
          {
            key: "alert_threshold",
            label: "告警阈值",
            type: "text",
            required: false,
            placeholder: "输入阈值",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
          entry_id: "memory-growth-1",
        },
        data: {
          category: "experience",
          title: "账号增长观察",
          summary:
            "每天 10:30 跟踪 @limeai 和 @agent_daily，互动率下降 20% 就提醒我。",
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        account_list: "@limeai\n@agent_daily",
        report_cadence: "每天 10:30",
        alert_threshold: "互动率下降 20% 就提醒我",
      },
      fieldLabels: ["参考账号 / 目标账号", "回报频率", "告警阈值"],
      hint: "已根据当前灵感条目自动预填 参考账号 / 目标账号、回报频率、告警阈值，可继续修改后执行。",
    });
  });

  it("应把文章线索映射到文章类技能和站点链接参数", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "article_source",
            label: "文章链接/正文",
            type: "textarea",
            required: true,
            placeholder: "输入文章链接、正文，或文章摘要",
          },
          {
            key: "article_url",
            label: "文章原文链接",
            type: "url",
            required: false,
            placeholder: "输入文章链接",
          },
          {
            key: "target_duration",
            label: "目标时长",
            type: "text",
            required: false,
            placeholder: "输入时长",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
          entry_id: "memory-article-1",
        },
        data: {
          category: "context",
          title: "AI Agent 行业报告",
          summary: "参考 https://example.com/report 做一版 90 秒总结。",
          content_excerpt: "重点保留融资趋势、代表工具和团队协作变化。",
          tags: ["AI Agent", "行业报告"],
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        article_source:
          "摘要：参考 https://example.com/report 做一版 90 秒总结。\n补充线索：重点保留融资趋势、代表工具和团队协作变化。\n主题：AI Agent 行业报告",
        article_url: "https://example.com/report",
        target_duration: "90 秒",
      },
      fieldLabels: ["文章链接/正文", "文章原文链接", "目标时长"],
      hint: "已根据当前灵感条目自动预填 文章链接/正文、文章原文链接、目标时长，可继续修改后执行。",
    });
  });

  it("如果只有默认值或不支持的槽位则不应生成预填", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "platform",
            label: "发布平台",
            type: "platform",
            required: true,
            defaultValue: "xiaohongshu",
            placeholder: "选择平台",
            options: [{ value: "xiaohongshu", label: "小红书" }],
          },
          {
            key: "reference_video",
            label: "参考视频",
            type: "url",
            required: true,
            placeholder: "输入链接",
          },
        ],
      },
      {
        version: 1,
        kind: "memory_entry",
        source: {
          page: "memory_store",
        },
        data: {
          category: "experience",
          title: "小红书视频结构",
          summary: "保留前三秒反差。",
        },
      },
    );

    expect(result).toBeNull();
  });
});
