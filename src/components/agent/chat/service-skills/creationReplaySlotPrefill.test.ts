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
          page: "memory",
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

  it("应把技能草稿回放映射到保留信息与重点调整点", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "must_keep",
            label: "必须保留的信息",
            type: "textarea",
            required: false,
            placeholder: "输入需要保留的信息",
          },
          {
            key: "focus_changes",
            label: "重点调整点",
            type: "textarea",
            required: false,
            placeholder: "输入调整点",
          },
        ],
      },
      {
        version: 1,
        kind: "skill_scaffold",
        source: {
          page: "skills",
          source_message_id: "message-1",
        },
        data: {
          name: "短视频复刻流程",
          description: "保留原节奏，但语气更克制。",
          source_excerpt: "先拆前三秒钩子，再补 CTA。",
          outputs: ["脚本结构", "镜头节奏"],
          steps: ["先拆结构", "再写脚本"],
          fallback_strategy: ["信息不足时先补问平台和受众"],
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        must_keep:
          "延续原结果重点：先拆前三秒钩子，再补 CTA。\n保留交付骨架：脚本结构；镜头节奏",
        focus_changes:
          "继续沿用步骤：先拆结构；再写脚本\n需要注意回退：信息不足时先补问平台和受众\n本次意图重点：保留原节奏，但语气更克制。",
      },
      fieldLabels: ["必须保留的信息", "重点调整点"],
      hint: "已根据当前技能草稿自动预填 必须保留的信息、重点调整点，可继续修改后执行。",
    });
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
          page: "memory",
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

  it("应把语言和来源线索映射到视频类技能参数", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "reference_video",
            label: "参考视频链接/素材",
            type: "url",
            required: true,
            placeholder: "输入视频链接",
          },
          {
            key: "target_language",
            label: "目标语言",
            type: "text",
            required: true,
            defaultValue: "中文",
            placeholder: "输入目标语言",
          },
          {
            key: "subtitle_preference",
            label: "字幕要求",
            type: "enum",
            required: false,
            defaultValue: "keep_original",
            placeholder: "选择字幕要求",
            options: [
              { value: "keep_original", label: "保留原字幕" },
              { value: "bilingual", label: "中英双语字幕" },
              { value: "dub_only", label: "只做配音稿" },
            ],
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
        kind: "skill_scaffold",
        source: {
          page: "skills",
          source_message_id: "message-video-1",
        },
        data: {
          name: "日文配音短视频",
          description:
            "参考 https://example.com/video-demo 并整理成 60-90 秒版本。",
          source_excerpt:
            "请输出日文配音稿，保留中英双语字幕，整体更像科技感讲解。",
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        reference_video: "https://example.com/video-demo",
        target_language: "日文",
        subtitle_preference: "bilingual",
        target_duration: "60-90 秒",
      },
      fieldLabels: ["参考视频链接/素材", "目标语言", "字幕要求", "目标时长"],
      hint: "已根据当前技能草稿自动预填 参考视频链接/素材、目标语言、字幕要求 等参数，可继续修改后执行。",
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
          page: "memory",
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

  it("应把技能草稿映射到参考素材和复刻模式参数", () => {
    const result = buildCreationReplaySlotPrefill(
      {
        ...BASE_SKILL,
        slotSchema: [
          {
            key: "reference_post",
            label: "参考帖子",
            type: "textarea",
            required: true,
            placeholder: "输入参考帖子",
          },
          {
            key: "delivery_mode",
            label: "执行方式",
            type: "enum",
            required: true,
            defaultValue: "one_to_one",
            placeholder: "选择执行方式",
            options: [
              { value: "one_to_one", label: "1:1 复刻" },
              { value: "expand", label: "同风格扩写" },
            ],
          },
          {
            key: "script_mode",
            label: "脚本模式",
            type: "enum",
            required: true,
            defaultValue: "replicate",
            placeholder: "选择脚本模式",
            options: [
              { value: "replicate", label: "贴近原结构" },
              { value: "expand", label: "同风格扩展" },
            ],
          },
        ],
      },
      {
        version: 1,
        kind: "skill_scaffold",
        source: {
          page: "skills",
          source_message_id: "message-replication-1",
        },
        data: {
          name: "小红书轮播改写",
          description: "按这个结构同风格扩写一版，但语气更像真实用户分享。",
          source_excerpt: "保留开头钩子、利益点排序和结尾 CTA。",
          inputs: ["平台：小红书", "品牌名：Lime"],
        },
      },
    );

    expect(result).toEqual({
      slotValues: {
        reference_post:
          "参考线索：保留开头钩子、利益点排序和结尾 CTA。\n改写目标：按这个结构同风格扩写一版，但语气更像真实用户分享。\n输入约束：平台：小红书；品牌名：Lime",
        delivery_mode: "expand",
        script_mode: "expand",
      },
      fieldLabels: ["参考帖子", "执行方式", "脚本模式"],
      hint: "已根据当前技能草稿自动预填 参考帖子、执行方式、脚本模式，可继续修改后执行。",
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
          page: "memory",
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
          page: "memory",
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
