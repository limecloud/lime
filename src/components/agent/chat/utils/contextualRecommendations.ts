import type { CreationMode, EntryTaskType } from "../components/types";
import { getEntryTaskRecommendations } from "./entryPromptComposer";

export type RecommendationTuple = [string, string];
const SELECTED_TEXT_MAX_LENGTH = 320;

interface RecommendationContext {
  activeTheme: string;
  input: string;
  creationMode: CreationMode;
  entryTaskType: EntryTaskType;
  platform: string;
  hasCanvasContent: boolean;
  hasContentId: boolean;
  selectedText?: string;
  subagentEnabled?: boolean;
}

const SOCIAL_PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小红书",
  wechat: "公众号",
  zhihu: "知乎",
  toutiao: "头条",
  juejin: "掘金",
  csdn: "CSDN",
};

const FALLBACK_THEME_RECOMMENDATIONS: Record<string, RecommendationTuple[]> = {
  general: [
    [
      "需求澄清助手",
      "请先帮我澄清当前问题：目标是什么、已知条件是什么、缺失信息是什么，并给出下一步提问清单。",
    ],
    [
      "方案对比",
      "围绕这个问题给我 3 套可执行方案，分别说明优缺点、适用场景和实施成本。",
    ],
    [
      "快速总结",
      "请把这件事总结成“背景-问题-建议-行动”四段结构，控制在 200 字内。",
    ],
    [
      "行动清单",
      "请把目标拆成可执行 TODO 列表：按优先级排序，给出预计耗时和验收标准。",
    ],
  ],
  "social-media": [
    [
      "爆款标题生成",
      "帮我为“春季护肤routine”写10个小红书爆款标题，要求：数字开头、制造悬念、引发共鸣。",
    ],
    [
      "小红书探店文案",
      "写一篇小红书探店文案：周末在杭州发现一家宝藏咖啡店，工业风装修+拉花拿铁，适合拍照出片。",
    ],
    [
      "公众号排版",
      "帮我把这段话排版成公众号风格：每段不超过150字，加入小标题和 emoji，重点内容加粗。",
    ],
    [
      "评论区回复",
      "用户评论“这个产品真的好用吗？还是广告？”，帮我写一条真诚、有说服力的回复。",
    ],
  ],
  knowledge: [
    [
      "解释量子计算",
      "用通俗易懂的方式解释量子计算是什么，类比成生活中的例子，适合非理科背景的人理解。",
    ],
    [
      "总结这篇论文",
      "帮我总结这篇论文的核心观点、研究方法和主要结论，输出 500 字以内摘要。",
    ],
    [
      "如何制定OKR",
      "详细介绍 OKR 制定方法，包括设定原则、常见误区和实际案例，适合团队管理者。",
    ],
    [
      "分析行业趋势",
      "分析 2024 年 AI 行业发展趋势，从技术突破、商业化进程、监管政策三个维度展开。",
    ],
  ],
  planning: [
    [
      "日本旅行计划",
      "帮我制定一个 7 天日本关西旅行计划：大阪进京都出，包含景点、美食、交通路线和预算估算。",
    ],
    [
      "年度职业规划",
      "制定一名前端开发工程师的年度职业规划：技能提升、项目经验、人脉积累、求职目标四个维度。",
    ],
    [
      "婚礼流程表",
      "制定一场户外草坪婚礼流程：上午 10 点开始，包含仪式、宴会、互动环节，并标注每个环节时间。",
    ],
    [
      "健身计划",
      "为办公室上班族制定健身计划：每周 3 次，每次 30 分钟，无需器械，可在办公室或家中完成。",
    ],
  ],
  document: [
    [
      "公文式润色",
      "请把当前内容改写成正式办公文档风格，要求语句简洁、结构清晰、术语统一。",
    ],
    [
      "会议纪要整理",
      "请把内容整理成会议纪要：议题、讨论要点、结论、责任人、截止时间。",
    ],
    [
      "汇报提纲",
      "请基于当前主题生成一份工作汇报提纲：背景、进展、风险、下一步计划。",
    ],
    [
      "邮件草稿",
      "请生成一封专业邮件草稿：说明背景、核心诉求、希望对方的下一步动作。",
    ],
  ],
  video: [
    [
      "短视频脚本",
      "请为这个主题写一条 60 秒短视频脚本，结构为“开场钩子-冲突-解决-行动号召”。",
    ],
    [
      "分镜清单",
      "请把内容拆成 8-10 个镜头分镜，包含画面描述、旁白、时长和转场建议。",
    ],
    [
      "口播优化",
      "请将当前文案改成自然口播稿，句子更短、更有节奏，并保留关键信息。",
    ],
    [
      "标题与封面",
      "请给我 10 个短视频标题和 5 个封面文案，要求突出冲突与收益点。",
    ],
  ],
};

const SOCIAL_BLANK_RECOMMENDATIONS: RecommendationTuple[] = [
  [
    "从选题开始",
    "请先帮我做社媒选题：给我 5 个可执行且有传播潜力的选题，并说明各自目标受众与切入角度。",
  ],
  [
    "先搭结构",
    "先不要写正文，请先给我“标题-开头-主体-结尾-互动引导”的内容结构框架。",
  ],
  [
    "平台差异建议",
    "同一主题下，小红书、公众号、知乎的写法差异是什么？请给我一份可执行对照清单。",
  ],
];

const SOCIAL_REWRITE_RECOMMENDATIONS: RecommendationTuple[] = [
  [
    "正文润色提效",
    "请帮我润色当前文稿，保持核心观点不变，增强可读性和节奏感，并标注关键修改点。",
  ],
  [
    "结构压缩重排",
    "请把当前文稿重排成“问题-观点-方法-案例-行动”结构，删掉重复表达。",
  ],
  [
    "平台适配改写",
    "请基于当前文稿输出三个版本：小红书版、公众号版、知乎版，保留事实信息，语气与结构各自适配。",
  ],
];

export function isTeamRuntimeRecommendation(
  shortLabel: string,
  fullPrompt: string,
): boolean {
  const normalizedLabel = shortLabel.trim().toLowerCase();
  const normalizedPrompt = fullPrompt.trim().toLowerCase();

  return (
    normalizedLabel.includes("team") ||
    shortLabel.includes("多代理") ||
    shortLabel.includes("父子线程") ||
    normalizedPrompt.includes("team runtime") ||
    fullPrompt.includes("父子线程联调") ||
    fullPrompt.includes("多代理") ||
    (fullPrompt.includes("子代理") &&
      (fullPrompt.includes("主线程") ||
        normalizedPrompt.includes("explorer") ||
        normalizedPrompt.includes("executor")))
  );
}

function buildGeneralRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  const baseRecommendations = FALLBACK_THEME_RECOMMENDATIONS.general || [];
  const subject = normalizeSubject(context.input);
  const teamSetupHint = context.subagentEnabled
    ? ""
    : "如果当前多代理偏好未开启，请先开启输入框工具条里的“多代理”开关，再继续执行。";
  return [
    [
      "Team 冒烟测试",
      `请按 team runtime 方式处理“${subject}”：先在主线程拆成两个子任务，再创建 explorer 与 executor 两个子代理并行推进；至少等待一个子代理结束，必要时继续 send_input，最后回到主线程汇总每个 agent 的状态、结论和下一步。${teamSetupHint}`,
    ],
    [
      "父子线程联调",
      `请围绕“${subject}”做一次父子线程联调：主线程只负责分派、等待和汇总；子代理 A 负责整理事实与风险，子代理 B 负责给出落地步骤与验收标准；最终输出 team workspace 视角的协作总结。${teamSetupHint}`,
    ],
    ...baseRecommendations.slice(0, 2),
  ];
}

function normalizeSubject(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "这个主题";
  }

  return normalized.length > 24
    ? `${normalized.slice(0, 24).trim()}...`
    : normalized;
}

function normalizePlatform(value: string): string {
  return SOCIAL_PLATFORM_LABELS[value] || "社媒平台";
}

function buildSocialRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  const selectedText = (context.selectedText || "").trim();
  if (selectedText) {
    return [
      [
        "按选中内容改写",
        "请基于我选中的段落做三版改写：精简版、增强感染力版、专业理性版，并解释适用场景。",
      ],
      [
        "选中段落提炼",
        "请提炼我选中段落的核心观点，并改成“可直接发布”的社媒表达，控制在 120 字内。",
      ],
      [
        "选中段落转风格",
        "请把我选中的内容分别改成小红书口语风和公众号深度风，保留事实，不改变结论。",
      ],
    ];
  }

  if (context.hasCanvasContent) {
    return SOCIAL_REWRITE_RECOMMENDATIONS;
  }

  const normalizedInput = context.input.trim();
  if (normalizedInput) {
    const subject = normalizeSubject(normalizedInput);
    const platform = normalizePlatform(context.platform);
    return [
      [
        "补全创作简报",
        `基于“${subject}”，请先补全一份社媒创作简报：目标受众、核心卖点、内容结构、语气风格、互动引导。`,
      ],
      [
        "直接起 3 个版本",
        `围绕“${subject}”，先给我 3 个不同风格的 ${platform} 起稿版本（实用型/故事型/观点型）。`,
      ],
      [
        "先出标题开头",
        `围绕“${subject}”，先输出 10 个标题和 3 个开头钩子，供我选择后再写正文。`,
      ],
    ];
  }

  if (context.hasContentId || context.creationMode === "guided") {
    return SOCIAL_BLANK_RECOMMENDATIONS;
  }

  const entryRecommendations = getEntryTaskRecommendations(
    context.entryTaskType,
  );
  if (entryRecommendations.length > 0) {
    return entryRecommendations;
  }

  return FALLBACK_THEME_RECOMMENDATIONS["social-media"];
}

export function getContextualRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  if (context.activeTheme === "social-media") {
    return buildSocialRecommendations(context);
  }

  if (context.activeTheme === "general") {
    return buildGeneralRecommendations(context);
  }

  return FALLBACK_THEME_RECOMMENDATIONS[context.activeTheme] || [];
}

export function buildRecommendationPrompt(
  basePrompt: string,
  selectedText?: string,
  appendSelectedText = true,
): string {
  const normalizedPrompt = basePrompt.trim();
  if (!appendSelectedText) {
    return normalizedPrompt;
  }

  const normalizedSelected = (selectedText || "").trim();

  if (!normalizedSelected) {
    return normalizedPrompt;
  }

  const clippedSelected =
    normalizedSelected.length > SELECTED_TEXT_MAX_LENGTH
      ? `${normalizedSelected.slice(0, SELECTED_TEXT_MAX_LENGTH).trim()}…`
      : normalizedSelected;

  return `${normalizedPrompt}\n\n[参考选中内容]\n${clippedSelected}`;
}
