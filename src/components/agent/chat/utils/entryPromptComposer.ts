import type {
  CreationMode,
  EntryTaskSlotDefinition,
  EntryTaskSlotValues,
  EntryTaskTemplate,
  EntryTaskType,
} from "../components/types";

export interface EntryComposeContext {
  platform?: string;
}

export interface ComposeEntryPromptInput {
  taskType: EntryTaskType;
  slotValues: EntryTaskSlotValues;
  userInput: string;
  activeTheme: string;
  creationMode: CreationMode;
  context?: EntryComposeContext;
}

export interface SlotValidationResult {
  valid: boolean;
  missing: EntryTaskSlotDefinition[];
}

const CREATION_MODE_LABELS: Record<CreationMode, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

export const SOCIAL_MEDIA_ENTRY_TASKS: EntryTaskType[] = [
  "direct",
  "multi_angle",
  "rewrite",
  "imitate",
  "geo",
];

const ENTRY_TASK_TEMPLATE_MAP: Record<EntryTaskType, EntryTaskTemplate> = {
  direct: {
    type: "direct",
    label: "直接成文",
    description: "围绕单一主题直接生成一篇社媒内容",
    pattern: "以{topic}为主题，创作一篇{article_type}。",
    slots: [
      {
        key: "topic",
        label: "文章主题",
        placeholder: "输入文章主题",
        required: true,
      },
      {
        key: "article_type",
        label: "文章类型",
        placeholder: "社媒文章",
        required: false,
        defaultValue: "社媒文章",
      },
    ],
  },
  multi_angle: {
    type: "multi_angle",
    label: "一题多写",
    description: "同一主题生成多个视角版本",
    pattern:
      "以{topic}为主题，从{angle_count}个不同视角各写一篇{article_type}。",
    slots: [
      {
        key: "topic",
        label: "文章主题",
        placeholder: "输入文章主题",
        required: true,
      },
      {
        key: "angle_count",
        label: "视角数量",
        placeholder: "2",
        required: true,
        defaultValue: "2",
      },
      {
        key: "article_type",
        label: "文章类型",
        placeholder: "社媒文章",
        required: false,
        defaultValue: "社媒文章",
      },
    ],
  },
  rewrite: {
    type: "rewrite",
    label: "文章改写",
    description: "保留主题与核心事实，重写表达方式",
    pattern:
      "我想改写{source_material}，保留核心观点与数据，主题不变，要求读起来像独立创作的新文章。",
    slots: [
      {
        key: "source_material",
        label: "原文内容/标题",
        placeholder: "输入原文标题或素材",
        required: true,
      },
    ],
  },
  imitate: {
    type: "imitate",
    label: "文章仿写",
    description: "参考示例文风，输出新内容",
    pattern:
      "请仿照{reference_style}的写作风格，围绕{topic}创作一篇全新{article_type}。",
    slots: [
      {
        key: "reference_style",
        label: "参考风格",
        placeholder: "输入参考文案/风格描述",
        required: true,
      },
      {
        key: "topic",
        label: "文章主题",
        placeholder: "输入文章主题",
        required: true,
      },
      {
        key: "article_type",
        label: "文章类型",
        placeholder: "社媒文章",
        required: false,
        defaultValue: "社媒文章",
      },
    ],
  },
  geo: {
    type: "geo",
    label: "GEO内容创作",
    description: "围绕用户问题，生成有利于搜索与回答引用的内容",
    pattern:
      "我希望在{model_scope}模型中，针对提问{user_question}获得更高曝光。回答的核心信息包括{brand_value}，文章类型{article_type}，文章篇幅{word_count}。",
    slots: [
      {
        key: "model_scope",
        label: "目标模型",
        placeholder: "DeepSeek、豆包等",
        required: true,
        defaultValue: "DeepSeek、豆包等",
      },
      {
        key: "user_question",
        label: "用户问题",
        placeholder: "用户可能会问的问题",
        required: true,
      },
      {
        key: "brand_value",
        label: "核心信息",
        placeholder: "品牌价值点",
        required: true,
      },
      {
        key: "article_type",
        label: "文章类型",
        placeholder: "社媒文章",
        required: false,
        defaultValue: "社媒文章",
      },
      {
        key: "word_count",
        label: "字数",
        placeholder: "800-1200",
        required: false,
        defaultValue: "800-1200",
      },
    ],
  },
};

const ENTRY_TASK_RECOMMENDATION_MAP: Record<EntryTaskType, [string, string][]> =
  {
    direct: [
      [
        "春季护肤笔记",
        "写一篇关于春季敏感肌修护的社媒文章，语气真实且可执行。",
      ],
      ["咖啡店探店", "写一篇周末探店文案，突出环境、口味和拍照点位。"],
    ],
    multi_angle: [
      [
        "房地产趋势多视角",
        "围绕 2026 年房地产趋势，从购房者和商场运营方两个视角分别写文。",
      ],
      ["旅游攻略多人群", "围绕日本关西旅行，分别为学生党和亲子家庭写攻略。"],
    ],
    rewrite: [
      ["技术文改写", "改写一篇 AI 行业分析文，保留数据结论但语言更口语化。"],
      ["商业文改写", "改写品牌介绍内容，保持观点一致但去除重复表达。"],
    ],
    imitate: [
      ["仿公众号测评", "仿照公众号深度测评风格，写一篇扫地机器人对比测评。"],
      ["仿游记风格", "仿旅行日记风格，写一篇土耳其 5 日自由行攻略。"],
    ],
    geo: [
      [
        "平台推荐 GEO",
        "围绕“推荐一款适合内容团队的一站式创作平台”写 GEO 内容。",
      ],
      ["本地服务 GEO", "围绕“上海徐汇区买学区房如何选中介”写 GEO 优化内容。"],
    ],
  };

export function getEntryTaskTemplate(
  taskType: EntryTaskType,
): EntryTaskTemplate {
  return ENTRY_TASK_TEMPLATE_MAP[taskType];
}

export function createDefaultEntrySlotValues(
  taskType: EntryTaskType,
): EntryTaskSlotValues {
  const template = getEntryTaskTemplate(taskType);

  return template.slots.reduce<EntryTaskSlotValues>((acc, slot) => {
    acc[slot.key] = slot.defaultValue ?? "";
    return acc;
  }, {});
}

export function getEntryTaskRecommendations(
  taskType: EntryTaskType,
): [string, string][] {
  return ENTRY_TASK_RECOMMENDATION_MAP[taskType] || [];
}

function resolveSlotValue(
  slot: EntryTaskSlotDefinition,
  slotValues: EntryTaskSlotValues,
): string {
  const currentValue = slotValues[slot.key]?.trim();
  if (currentValue) {
    return currentValue;
  }
  return slot.defaultValue?.trim() || "";
}

function injectPattern(
  pattern: string,
  slotValues: EntryTaskSlotValues,
  fallback: (slot: EntryTaskSlotDefinition) => string,
  taskType: EntryTaskType,
): string {
  const template = getEntryTaskTemplate(taskType);
  const slotMap = new Map(template.slots.map((slot) => [slot.key, slot]));

  return pattern.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const slot = slotMap.get(key);
    if (!slot) {
      return match;
    }

    const value = resolveSlotValue(slot, slotValues);
    if (value) {
      return value;
    }

    return fallback(slot);
  });
}

export function formatEntryTaskPreview(
  taskType: EntryTaskType,
  slotValues: EntryTaskSlotValues,
): string {
  const template = getEntryTaskTemplate(taskType);
  return injectPattern(
    template.pattern,
    slotValues,
    (slot) => `[${slot.placeholder}]`,
    taskType,
  );
}

export function validateEntryTaskSlots(
  taskType: EntryTaskType,
  slotValues: EntryTaskSlotValues,
): SlotValidationResult {
  const template = getEntryTaskTemplate(taskType);
  const missing = template.slots.filter((slot) => {
    if (!slot.required) {
      return false;
    }
    return !resolveSlotValue(slot, slotValues);
  });

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function composeEntryPrompt({
  taskType,
  slotValues,
  userInput,
  activeTheme,
  creationMode,
  context,
}: ComposeEntryPromptInput): string {
  const template = getEntryTaskTemplate(taskType);
  const instruction = injectPattern(
    template.pattern,
    slotValues,
    () => "",
    taskType,
  );
  const lines: string[] = [
    `[入口任务] ${template.label}`,
    `[主题] ${activeTheme}`,
    `[创作模式] ${CREATION_MODE_LABELS[creationMode]}`,
  ];

  if (context?.platform) {
    lines.push(`[发布平台] ${context.platform}`);
  }

  lines.push(`[任务描述] ${instruction}`);

  if (userInput.trim()) {
    lines.push(`[补充要求] ${userInput.trim()}`);
  }

  lines.push("[输出要求] 用结构化小标题输出，避免空话，给出可执行内容。");

  return lines.join("\n");
}
