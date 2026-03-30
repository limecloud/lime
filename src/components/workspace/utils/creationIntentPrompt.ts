import type { CreationMode } from "@/lib/workspace/workbenchContract";

export type CreationIntentFieldKey =
  | "topic"
  | "targetAudience"
  | "goal"
  | "constraints"
  | "contentType"
  | "length"
  | "corePoints"
  | "tone"
  | "outline"
  | "mustInclude"
  | "extraRequirements";

export interface CreationIntentFormValues {
  topic: string;
  targetAudience: string;
  goal: string;
  constraints: string;
  contentType: string;
  length: string;
  corePoints: string;
  tone: string;
  outline: string;
  mustInclude: string;
  extraRequirements: string;
}

export interface CreationIntentFieldDefinition {
  key: CreationIntentFieldKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
  options?: Array<{
    value: string;
    label: string;
  }>;
}

export interface CreationIntentInput {
  creationMode: CreationMode;
  values: CreationIntentFormValues;
}

export interface CreationIntentValidationResult {
  valid: boolean;
  length: number;
  message?: string;
}

const CREATION_MODE_VALUES: CreationMode[] = [
  "guided",
  "fast",
  "hybrid",
  "framework",
];

const CREATION_INTENT_FIELD_KEYS: CreationIntentFieldKey[] = [
  "topic",
  "targetAudience",
  "goal",
  "constraints",
  "contentType",
  "length",
  "corePoints",
  "tone",
  "outline",
  "mustInclude",
  "extraRequirements",
];

const CREATION_MODE_LABELS: Record<CreationMode, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

const TARGET_AUDIENCE_OPTIONS = [
  { value: "泛用户", label: "泛用户" },
  { value: "学生群体", label: "学生群体" },
  { value: "职场新人", label: "职场新人" },
  { value: "职场管理者", label: "职场管理者" },
  { value: "创业者", label: "创业者" },
  { value: "宝妈群体", label: "宝妈群体" },
];

const GOAL_OPTIONS = [
  { value: "快速起稿并可直接发布", label: "快速起稿并可直接发布" },
  { value: "沉淀方法论并建立专业感", label: "沉淀方法论并建立专业感" },
  { value: "提升互动率与转化率", label: "提升互动率与转化率" },
  { value: "建立品牌认知与信任", label: "建立品牌认知与信任" },
];

const CONTENT_TYPE_OPTIONS = [
  { value: "小红书笔记", label: "小红书笔记" },
  { value: "公众号长文", label: "公众号长文" },
  { value: "知乎回答", label: "知乎回答" },
  { value: "短视频口播稿", label: "短视频口播稿" },
  { value: "通用文档", label: "通用文档" },
];

const LENGTH_OPTIONS = [
  { value: "300-500 字", label: "300-500 字" },
  { value: "500-800 字", label: "500-800 字" },
  { value: "800-1200 字", label: "800-1200 字" },
  { value: "1200 字以上", label: "1200 字以上" },
];

const TONE_OPTIONS = [
  { value: "专业理性", label: "专业理性" },
  { value: "轻松口语", label: "轻松口语" },
  { value: "故事化叙述", label: "故事化叙述" },
  { value: "干货清单式", label: "干货清单式" },
];

const CREATION_INTENT_FIELD_MAP: Record<
  CreationIntentFieldKey,
  CreationIntentFieldDefinition
> = {
  topic: {
    key: "topic",
    label: "主题方向",
    placeholder: "例如：春季敏感肌修护指南",
  },
  targetAudience: {
    key: "targetAudience",
    label: "目标读者",
    placeholder: "请选择目标读者",
    options: TARGET_AUDIENCE_OPTIONS,
  },
  goal: {
    key: "goal",
    label: "目标结果",
    placeholder: "请选择目标结果",
    options: GOAL_OPTIONS,
  },
  constraints: {
    key: "constraints",
    label: "限制条件",
    placeholder: "例如：不要夸张承诺，避免医学术语堆砌",
    multiline: true,
  },
  contentType: {
    key: "contentType",
    label: "输出体裁",
    placeholder: "请选择输出体裁",
    options: CONTENT_TYPE_OPTIONS,
  },
  length: {
    key: "length",
    label: "目标篇幅",
    placeholder: "请选择目标篇幅",
    options: LENGTH_OPTIONS,
  },
  corePoints: {
    key: "corePoints",
    label: "核心观点",
    placeholder: "例如：先稳屏障，再做功效叠加",
    multiline: true,
  },
  tone: {
    key: "tone",
    label: "语气风格",
    placeholder: "请选择语气风格",
    options: TONE_OPTIONS,
  },
  outline: {
    key: "outline",
    label: "框架提纲",
    placeholder: "可填写章节结构或小标题框架",
    multiline: true,
  },
  mustInclude: {
    key: "mustInclude",
    label: "必须覆盖点",
    placeholder: "例如：适用人群、方法步骤、避坑清单",
    multiline: true,
  },
  extraRequirements: {
    key: "extraRequirements",
    label: "补充要求",
    placeholder: "补充你希望 AI 注意的细节",
    multiline: true,
  },
};

const CREATION_INTENT_FIELDS_BY_MODE: Record<
  CreationMode,
  CreationIntentFieldDefinition[]
> = {
  guided: [
    CREATION_INTENT_FIELD_MAP.topic,
    CREATION_INTENT_FIELD_MAP.targetAudience,
    CREATION_INTENT_FIELD_MAP.goal,
    CREATION_INTENT_FIELD_MAP.constraints,
  ],
  fast: [
    CREATION_INTENT_FIELD_MAP.topic,
    CREATION_INTENT_FIELD_MAP.contentType,
    CREATION_INTENT_FIELD_MAP.length,
  ],
  hybrid: [
    CREATION_INTENT_FIELD_MAP.topic,
    CREATION_INTENT_FIELD_MAP.corePoints,
    CREATION_INTENT_FIELD_MAP.targetAudience,
    CREATION_INTENT_FIELD_MAP.tone,
  ],
  framework: [
    CREATION_INTENT_FIELD_MAP.topic,
    CREATION_INTENT_FIELD_MAP.outline,
    CREATION_INTENT_FIELD_MAP.targetAudience,
    CREATION_INTENT_FIELD_MAP.mustInclude,
  ],
};

const FALLBACK_CREATION_INTENT_FIELDS: CreationIntentFieldDefinition[] = [
  {
    ...CREATION_INTENT_FIELD_MAP.topic,
  },
];

export function isCreationMode(value: unknown): value is CreationMode {
  return (
    typeof value === "string" &&
    CREATION_MODE_VALUES.includes(value as CreationMode)
  );
}

export function normalizeCreationMode(
  value: unknown,
  fallback: CreationMode = "guided",
): CreationMode {
  return isCreationMode(value) ? value : fallback;
}

function isCreationIntentFieldKey(value: unknown): value is CreationIntentFieldKey {
  return (
    typeof value === "string" &&
    CREATION_INTENT_FIELD_KEYS.includes(value as CreationIntentFieldKey)
  );
}

function sanitizeFieldDefinition(
  field: unknown,
): CreationIntentFieldDefinition | null {
  if (!field || typeof field !== "object") {
    return null;
  }

  const fieldRecord = field as Partial<CreationIntentFieldDefinition>;
  if (!isCreationIntentFieldKey(fieldRecord.key)) {
    return null;
  }

  if (typeof fieldRecord.label !== "string" || !fieldRecord.label.trim()) {
    return null;
  }

  const normalizedOptions =
    Array.isArray(fieldRecord.options) && fieldRecord.options.length > 0
      ? fieldRecord.options
          .filter(
            (option): option is { value: string; label: string } =>
              Boolean(option) &&
              typeof option.value === "string" &&
              option.value.trim().length > 0 &&
              typeof option.label === "string" &&
              option.label.trim().length > 0,
          )
          .map((option) => ({
            value: option.value,
            label: option.label,
          }))
      : undefined;

  return {
    key: fieldRecord.key,
    label: fieldRecord.label,
    placeholder:
      typeof fieldRecord.placeholder === "string" &&
      fieldRecord.placeholder.trim().length > 0
        ? fieldRecord.placeholder
        : "请输入内容",
    multiline: fieldRecord.multiline === true,
    options:
      normalizedOptions && normalizedOptions.length > 0
        ? normalizedOptions
        : undefined,
  };
}

export function getCreationIntentFieldsSafe(
  mode: unknown,
): CreationIntentFieldDefinition[] {
  const normalizedMode = normalizeCreationMode(mode);
  const fieldDefs = CREATION_INTENT_FIELDS_BY_MODE[normalizedMode] || [];
  const sanitized = fieldDefs
    .map((field) => sanitizeFieldDefinition(field))
    .filter((field): field is CreationIntentFieldDefinition => Boolean(field));

  if (sanitized.length > 0) {
    return sanitized;
  }

  console.warn(
    "[creationIntentPrompt] 创作意图字段配置异常，已降级为最小字段集合",
    { mode: normalizedMode },
  );

  return FALLBACK_CREATION_INTENT_FIELDS.map((field) => ({ ...field }));
}

function normalizeValue(value: string | undefined): string {
  return (value || "").trim();
}

function getRelevantFieldEntries(
  input: CreationIntentInput,
): Array<readonly [CreationIntentFieldDefinition, string]> {
  const fieldDefs = getCreationIntentFieldsSafe(input.creationMode);
  return fieldDefs
    .map((field) => [field, normalizeValue(input.values[field.key])] as const)
    .filter(([, value]) => value.length > 0);
}

function getExtraRequirements(input: CreationIntentInput): string {
  return normalizeValue(input.values.extraRequirements);
}

export function getCreationModeLabel(mode: CreationMode): string {
  return CREATION_MODE_LABELS[mode];
}

export function createInitialCreationIntentValues(): CreationIntentFormValues {
  return {
    topic: "",
    targetAudience: "",
    goal: "",
    constraints: "",
    contentType: "",
    length: "",
    corePoints: "",
    tone: "",
    outline: "",
    mustInclude: "",
    extraRequirements: "",
  };
}

export function getCreationIntentFields(
  mode: CreationMode,
): CreationIntentFieldDefinition[] {
  return getCreationIntentFieldsSafe(mode);
}

export function getCreationIntentText(input: CreationIntentInput): string {
  const parts = getRelevantFieldEntries(input).map(([, value]) => value);
  const extraRequirements = getExtraRequirements(input);
  if (extraRequirements) {
    parts.push(extraRequirements);
  }
  return parts.join("\n");
}

export function validateCreationIntent(
  input: CreationIntentInput,
  minLength = 10,
): CreationIntentValidationResult {
  const normalizedLength = getCreationIntentText(input).replace(/\s+/g, "")
    .length;

  if (normalizedLength < minLength) {
    return {
      valid: false,
      length: normalizedLength,
      message: `创作意图至少需要 ${minLength} 个字，当前 ${normalizedLength} 个字`,
    };
  }

  return {
    valid: true,
    length: normalizedLength,
  };
}

export function buildCreationIntentMetadata(
  input: CreationIntentInput,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    mode: input.creationMode,
    modeLabel: getCreationModeLabel(input.creationMode),
    intentText: getCreationIntentText(input),
  };

  for (const [field, value] of getRelevantFieldEntries(input)) {
    metadata[field.key] = value;
    metadata[field.label] = value;
  }

  const extraRequirements = getExtraRequirements(input);
  if (extraRequirements) {
    metadata.extraRequirements = extraRequirements;
    metadata["补充要求"] = extraRequirements;
  }

  return metadata;
}

export function buildCreationIntentPrompt(input: CreationIntentInput): string {
  const modeLabel = getCreationModeLabel(input.creationMode);
  const lines: string[] = [`[创作模式] ${modeLabel}`];

  const topic = normalizeValue(input.values.topic);
  if (topic) {
    lines.push(`[创作意图] 围绕“${topic}”完成本次内容创作`);
  } else {
    lines.push("[创作意图] 请按以下信息完成本次内容创作");
  }

  for (const [field, value] of getRelevantFieldEntries(input)) {
    lines.push(`[${field.label}] ${value}`);
  }

  const extraRequirements = getExtraRequirements(input);
  if (extraRequirements) {
    lines.push(`[补充要求] ${extraRequirements}`);
  }

  lines.push("[执行要求] 请严格按上述信息开始，并按所选模式推进。");
  return lines.join("\n");
}
