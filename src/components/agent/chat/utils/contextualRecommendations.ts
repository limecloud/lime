import type { CreationMode } from "../components/types";

export type RecommendationTuple = [string, string];
const SELECTED_TEXT_MAX_LENGTH = 320;

interface RecommendationContext {
  activeTheme: string;
  input: string;
  creationMode: CreationMode;
  hasCanvasContent: boolean;
  hasContentId: boolean;
  selectedText?: string;
  subagentEnabled?: boolean;
}

const GENERAL_RECOMMENDATIONS: RecommendationTuple[] = [
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
];

export function isTeamRuntimeRecommendation(
  shortLabel: string,
  fullPrompt: string,
): boolean {
  const normalizedLabel = shortLabel.trim().toLowerCase();
  const normalizedPrompt = fullPrompt.trim().toLowerCase();

  return (
    normalizedLabel.includes("team") ||
    shortLabel.includes("任务拆分") ||
    shortLabel.includes("多代理") ||
    shortLabel.includes("父子线程") ||
    normalizedPrompt.includes("team runtime") ||
    fullPrompt.includes("生成视角") ||
    fullPrompt.includes("任务拆分") ||
    fullPrompt.includes("父子线程联调") ||
    fullPrompt.includes("多代理") ||
    (fullPrompt.includes("子代理") &&
      (fullPrompt.includes("主线程") ||
        normalizedPrompt.includes("explorer") ||
        normalizedPrompt.includes("executor")))
  );
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

function buildTeamRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  const subject = normalizeSubject(context.input);
  const teamSetupHint = context.subagentEnabled
    ? ""
    : "如果当前任务拆分偏好未开启，请先开启输入框工具条里的“任务拆分”开关，再继续执行。";

  return [
    [
      "任务拆分冒烟测试",
      `请按任务拆分方式处理“${subject}”：先在主线程拆成两个子任务，再创建 explorer 与 executor 两个子任务并行推进；至少等待一个子任务结束，必要时继续使用 SendMessage 追加说明，最后回到主线程汇总每项任务的状态、结论和下一步。${teamSetupHint}`,
    ],
    [
      "父子线程联调",
      `请围绕“${subject}”做一次父子线程联调：主线程只负责分派、等待和汇总；子任务 A 负责整理事实与风险，子任务 B 负责给出落地步骤与验收标准；最终输出生成视角的任务总结。${teamSetupHint}`,
    ],
  ];
}

function buildContentAwareRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  const selectedText = (context.selectedText || "").trim();
  if (selectedText) {
    return [
      [
        "按选中内容改写",
        "请基于我选中的段落做三版改写：精简版、增强表达版、专业版，并解释适用场景。",
      ],
      [
        "选中段落提炼",
        "请提炼我选中段落的核心观点，并改成可直接复用的精简表达，控制在 120 字内。",
      ],
      [
        "选中段落转风格",
        "请把我选中的内容分别改成口语版、正式版和汇报版，保留事实，不改变结论。",
      ],
    ];
  }

  if (context.hasCanvasContent) {
    return [
      [
        "正文润色提效",
        "请帮我润色当前文稿，保持核心观点不变，增强可读性和节奏感，并标注关键修改点。",
      ],
      [
        "结构压缩重排",
        "请把当前文稿重排成“问题-观点-方法-案例-行动”结构，删掉重复表达。",
      ],
      [
        "补成可交付版",
        "请把当前内容整理成可直接继续迭代的交付版，补齐标题、摘要和下一步建议。",
      ],
    ];
  }

  const normalizedInput = context.input.trim();
  if (normalizedInput) {
    const subject = normalizeSubject(normalizedInput);
    return [
      [
        "补全执行简报",
        `基于“${subject}”，请先补全一份执行简报：目标、约束、关键信息、输出结构和验收标准。`,
      ],
      [
        "直接起 3 个版本",
        `围绕“${subject}”，先给我 3 个不同风格的起稿版本（实用型/故事型/观点型）。`,
      ],
      [
        "先出标题开头",
        `围绕“${subject}”，先输出 10 个标题和 3 个开头钩子，供我选择后再继续展开正文。`,
      ],
    ];
  }

  if (context.hasContentId || context.creationMode === "guided") {
    return [
      [
        "先搭结构",
        "先不要写正文，请先给我“目标-结构-关键信息-交付格式”的内容框架。",
      ],
      [
        "补约束清单",
        "请先帮我列出完成这项任务前还需要确认的约束、素材和风险。",
      ],
      [
        "先给执行顺序",
        "请先给我一份最小可执行顺序：现在先做什么，之后再做什么，每步产出是什么。",
      ],
    ];
  }

  return [];
}

export function getContextualRecommendations(
  context: RecommendationContext,
): RecommendationTuple[] {
  return [
    ...buildContentAwareRecommendations(context),
    ...buildTeamRecommendations(context),
    ...GENERAL_RECOMMENDATIONS.slice(0, 2),
  ].slice(0, 4);
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
