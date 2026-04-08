import { describe, expect, it } from "vitest";
import { parseAnalysisWorkbenchCommand } from "./analysisWorkbenchCommand";
import { parseBroadcastWorkbenchCommand } from "./broadcastWorkbenchCommand";
import { parseBrowserWorkbenchCommand } from "./browserWorkbenchCommand";
import { parseChannelPreviewWorkbenchCommand } from "./channelPreviewWorkbenchCommand";
import { parseCodeWorkbenchCommand } from "./codeWorkbenchCommand";
import { parseComplianceWorkbenchCommand } from "./complianceWorkbenchCommand";
import { parseCompetitorWorkbenchCommand } from "./competitorWorkbenchCommand";
import { parseCoverWorkbenchCommand } from "./coverWorkbenchCommand";
import { parseDeepSearchWorkbenchCommand } from "./deepSearchWorkbenchCommand";
import { parseFormWorkbenchCommand } from "./formWorkbenchCommand";
import { parseImageWorkbenchCommand } from "./imageWorkbenchCommand";
import { buildMentionCommandReplayText } from "./mentionCommandReplayText";
import { parsePdfWorkbenchCommand } from "./pdfWorkbenchCommand";
import { parsePosterWorkbenchCommand } from "./posterWorkbenchCommand";
import { parsePresentationWorkbenchCommand } from "./presentationWorkbenchCommand";
import { parsePublishWorkbenchCommand } from "./publishWorkbenchCommand";
import { parseReportWorkbenchCommand } from "./reportWorkbenchCommand";
import { parseResourceSearchWorkbenchCommand } from "./resourceSearchWorkbenchCommand";
import { parseSearchWorkbenchCommand } from "./searchWorkbenchCommand";
import { parseSiteSearchWorkbenchCommand } from "./siteSearchWorkbenchCommand";
import { parseSummaryWorkbenchCommand } from "./summaryWorkbenchCommand";
import { parseTranscriptionWorkbenchCommand } from "./transcriptionWorkbenchCommand";
import { parseTranslationWorkbenchCommand } from "./translationWorkbenchCommand";
import { parseTypesettingWorkbenchCommand } from "./typesettingWorkbenchCommand";
import { parseUploadWorkbenchCommand } from "./uploadWorkbenchCommand";
import { parseUrlParseWorkbenchCommand } from "./urlParseWorkbenchCommand";
import { parseVideoWorkbenchCommand } from "./videoWorkbenchCommand";
import { parseVoiceWorkbenchCommand } from "./voiceWorkbenchCommand";
import { parseWebpageWorkbenchCommand } from "./webpageWorkbenchCommand";

describe("buildMentionCommandReplayText", () => {
  it("应把自然语句的 @搜索 回放整理成字段骨架", () => {
    const parsedCommand = parseSearchWorkbenchCommand(
      "@搜索 GitHub 最近一周 openai agents sdk issue 讨论",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "research",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("关键词:openai agents sdk issue 讨论 站点:GitHub 时间:最近一周 深度:标准");
  });

  it("应把 @深搜 回放固定成深度字段骨架", () => {
    const parsedCommand = parseDeepSearchWorkbenchCommand(
      "@深搜 GitHub 最近一周 openai agents sdk issue 讨论",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "deep_search",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("关键词:openai agents sdk issue 讨论 站点:GitHub 时间:最近一周 深度:深度");
  });

  it("应把 @配图 回放整理成可再次解析的参数顺序", () => {
    const parsedCommand = parseImageWorkbenchCommand(
      "@配图 生成 一张春日咖啡馆插画，16:9，出 2 张",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "image_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("16:9 一张春日咖啡馆插画 出 2 张");
  });

  it("应把 @修图 回放保留成可再次编辑的目标骨架", () => {
    const parsedCommand = parseImageWorkbenchCommand(
      "@修图 #img-2 去掉角标，保留主体",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "image_edit",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("#img-2 去掉角标，保留主体");
  });

  it("应把 @海报 回放整理成平台与风格骨架", () => {
    const parsedCommand = parsePosterWorkbenchCommand(
      "@海报 小红书 风格: 清新拼贴 春日咖啡市集活动海报",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "poster_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("平台:小红书 风格:清新拼贴 春日咖啡市集活动海报");
  });

  it("应把 @封面 回放整理成封面字段骨架", () => {
    const parsedCommand = parseCoverWorkbenchCommand(
      "@封面 小红书 标题: 春日咖啡快闪 风格: 清新插画, 1:1 春日咖啡市集封面",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "cover_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("平台:小红书 标题:春日咖啡快闪 风格:清新插画 1:1 春日咖啡市集封面");
  });

  it("应把 @视频 回放整理成视频参数骨架", () => {
    const parsedCommand = parseVideoWorkbenchCommand(
      "@视频 15秒 新品发布短视频，16:9，720p",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "video_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("15秒 16:9 720p 新品发布短视频");
  });

  it("应把 @播报 回放整理成播报字段骨架", () => {
    const parsedCommand = parseBroadcastWorkbenchCommand(
      "@播报 标题: 创始人周报 听众: AI 创业者 语气: 口语化 时长: 5分钟 把下面文章整理成播报文本",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "broadcast_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "标题:创始人周报 听众:AI 创业者 语气:口语化 时长:5分钟 把下面文章整理成播报文本",
    );
  });

  it("应把 @素材 回放整理成素材检索字段骨架", () => {
    const parsedCommand = parseResourceSearchWorkbenchCommand(
      "@素材 类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "modal_resource_search",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("类型:图片 关键词:咖啡馆木桌背景 用途:公众号头图 数量:8");
  });

  it("应把 @转写 回放整理成转写参数骨架", () => {
    const parsedCommand = parseTranscriptionWorkbenchCommand(
      "@转写 https://example.com/interview.mp4 生成逐字稿 导出 srt 带时间戳 区分说话人",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "transcription_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("https://example.com/interview.mp4 格式:srt 区分说话人 带时间戳 逐字稿");
  });

  it("应把 @配音 回放整理成运行时参数骨架", () => {
    const parsedCommand = parseVoiceWorkbenchCommand(
      "@配音 目标语言: 英文 风格: 科技感 给这个新品视频做一版发布配音稿",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "voice_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("目标语言:英文 风格:科技感 给这个新品视频做一版发布配音稿");
  });

  it("应把 @浏览器 回放整理成浏览目标骨架", () => {
    const parsedCommand = parseBrowserWorkbenchCommand(
      "@浏览器 打开 https://news.baidu.com 并提炼页面主要内容",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "browser_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("https://news.baidu.com 并提炼页面主要内容");
  });

  it("应把带字段的 @研报 回放整理成固定顺序", () => {
    const parsedCommand = parseReportWorkbenchCommand(
      "@研报 关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "research_report",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "关键词:AI Agent 融资 站点:36Kr 时间:近30天 重点:融资额与代表产品 输出:投资人研报",
    );
  });

  it("应把自然语句的 @竞品 回放提升成参数骨架", () => {
    const parsedCommand = parseCompetitorWorkbenchCommand(
      "@竞品 Claude 与 Gemini 在中国开发者市场的差异",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "competitor_research",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "关键词:Claude 与 Gemini 在中国开发者市场的差异 重点:产品定位、目标用户、核心功能、定价模式、渠道策略、差异化优劣势 输出:竞品分析",
    );
  });

  it("应把 @站点搜索 回放整理成站点字段骨架", () => {
    const parsedCommand = parseSiteSearchWorkbenchCommand(
      "@站点搜索 站点:GitHub 关键词:openai agents sdk issue 数量:8",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "site_search",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("站点:GitHub 关键词:openai agents sdk issue 数量:8");
  });

  it("应把 @读PDF 回放整理成来源与要求骨架", () => {
    const parsedCommand = parsePdfWorkbenchCommand(
      '@读PDF "/tmp/agent-report.pdf" 提炼三点结论 输出:投资人摘要',
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "read_pdf",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("文件:/tmp/agent-report.pdf 输出:投资人摘要 要求:提炼三点结论");
  });

  it("应把 @排版 回放整理成平台字段骨架", () => {
    const parsedCommand = parseTypesettingWorkbenchCommand(
      "@排版 平台:小红书 帮我把下面文案整理成短句节奏",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "typesetting",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("平台:小红书 要求:帮我把下面文案整理成短句节奏");
  });

  it("应把 @PPT 回放整理成演示稿字段骨架", () => {
    const parsedCommand = parsePresentationWorkbenchCommand(
      "@PPT 类型:路演PPT 风格:极简科技 受众:投资人 页数:10 帮我做一个 AI 助手创业项目融资演示稿",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "presentation_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "类型:路演PPT 风格:极简科技 受众:投资人 页数:10 要求:帮我做一个 AI 助手创业项目融资演示稿",
    );
  });

  it("应把 @表单 回放整理成表单字段骨架", () => {
    const parsedCommand = parseFormWorkbenchCommand(
      "@表单 类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 帮我做一个 AI Workshop 报名表",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "form_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "类型:报名表单 风格:简洁专业 受众:活动嘉宾 字段数:8 要求:帮我做一个 AI Workshop 报名表",
    );
  });

  it("应把 @网页 回放整理成页面字段骨架", () => {
    const parsedCommand = parseWebpageWorkbenchCommand(
      "@网页 类型:落地页 风格:未来感 技术:原生 HTML 帮我做一个 AI 代码助手官网",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "webpage_generate",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("类型:落地页 风格:未来感 技术:原生 HTML 要求:帮我做一个 AI 代码助手官网");
  });

  it("应把带字段的 @总结 回放整理成固定顺序", () => {
    const parsedCommand = parseSummaryWorkbenchCommand(
      "@总结 风格:投资人简报 输出:三点要点 长度:简短 内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "summary",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "内容:这是一篇关于 AI Agent 融资的长文 重点:融资额与发布时间 长度:简短 风格:投资人简报 输出:三点要点",
    );
  });

  it("自然语句的 @总结 应保守回退正文", () => {
    const parsedCommand = parseSummaryWorkbenchCommand(
      "@总结 帮我把上面的讨论整理成 3 条要点",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "summary",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("帮我把上面的讨论整理成 3 条要点");
  });

  it("应把带字段的 @翻译 回放整理成固定顺序", () => {
    const parsedCommand = parseTranslationWorkbenchCommand(
      "@翻译 风格:产品文案 输出:只输出译文 目标语言:中文 内容:hello world 原语言:英语",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "translation",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("内容:hello world 原语言:英语 目标语言:中文 风格:产品文案 输出:只输出译文");
  });

  it("自然语句的 @翻译 应保守回退正文", () => {
    const parsedCommand = parseTranslationWorkbenchCommand(
      "@翻译 把这段话翻译成英文，保留专业语气",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "translation",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("把这段话翻译成英文，保留专业语气");
  });

  it("应把带字段的 @分析 回放整理成固定顺序", () => {
    const parsedCommand = parseAnalysisWorkbenchCommand(
      "@分析 风格:投资备忘 输出:三点判断 内容:OpenAI 发布新模型 重点:商业影响",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "analysis",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("内容:OpenAI 发布新模型 重点:商业影响 风格:投资备忘 输出:三点判断");
  });

  it("自然语句的 @分析 应保守回退正文", () => {
    const parsedCommand = parseAnalysisWorkbenchCommand(
      "@分析 帮我拆解 Claude Code 最近为什么火",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "analysis",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("帮我拆解 Claude Code 最近为什么火");
  });

  it("应把 @发布合规 回放整理成带默认约束的字段骨架", () => {
    const parsedCommand = parseComplianceWorkbenchCommand(
      "@发布合规 内容:这是一篇小红书种草文案 重点:夸大宣传 输出:风险清单",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "publish_compliance",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "内容:这是一篇小红书种草文案 重点:夸大宣传 风格:合规审校 输出:风险清单",
    );
  });

  it("自然语句的 @发布合规 应保留默认合规骨架", () => {
    const parsedCommand = parseComplianceWorkbenchCommand(
      "@发布合规 帮我看看这条内容能不能发",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "publish_compliance",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "重点:广告法、版权、平台发布风险 风格:合规审校 输出:风险等级、风险点、修改建议、待确认项",
    );
  });

  it("应把 @链接解析 回放整理成链接字段骨架", () => {
    const parsedCommand = parseUrlParseWorkbenchCommand(
      "@链接解析 https://example.com/agent 提取要点 并整理成投资人可读摘要",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "url_parse",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "链接:https://example.com/agent 提取:要点 要求:并整理成投资人可读摘要",
    );
  });

  it("应兼容显式字段的 @网页读取 回放", () => {
    const parsedCommand = parseUrlParseWorkbenchCommand(
      "@网页读取 链接:https://example.com/post 提取:摘要 要求:整理成三条结论",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "webpage_read",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "链接:https://example.com/post 提取:摘要 要求:整理成三条结论",
    );
  });

  it("应把 @代码 回放整理成任务字段骨架", () => {
    const parsedCommand = parseCodeWorkbenchCommand(
      "@代码 类型:重构 重构聊天区时间线组件，合并重复状态分支并补测试",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "code_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("类型:重构 要求:重构聊天区时间线组件，合并重复状态分支并补测试");
  });

  it("应把 @渠道预览 回放整理成平台字段骨架", () => {
    const parsedCommand = parseChannelPreviewWorkbenchCommand(
      "@渠道预览 平台:小红书 帮我预览这篇春日咖啡活动文案的首屏效果",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "channel_preview_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("平台:小红书 要求:帮我预览这篇春日咖啡活动文案的首屏效果");
  });

  it("应把 @上传 回放整理成平台字段骨架", () => {
    const parsedCommand = parseUploadWorkbenchCommand(
      "@上传 平台:微信公众号后台 帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "upload_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe(
      "平台:微信公众号后台 要求:帮我把这篇春日咖啡活动文案整理成可直接上传的版本",
    );
  });

  it("应把 @发布 回放整理成平台字段骨架", () => {
    const parsedCommand = parsePublishWorkbenchCommand(
      "@发布 平台:微信公众号后台 帮我把这篇文章整理成可直接发布的版本",
    );

    expect(
      buildMentionCommandReplayText({
        commandKey: "publish_runtime",
        parsedCommand: parsedCommand!,
      }),
    ).toBe("平台:微信公众号后台 要求:帮我把这篇文章整理成可直接发布的版本");
  });
});
