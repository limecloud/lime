import {
  buildCuratedTaskReferencePromptBlock,
  extractCuratedTaskReferenceMemoryIds,
  getCuratedTaskReferenceCategoryLabel,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
} from "./curatedTaskReferenceSelection";
import {
  buildCuratedTaskRecommendationSignalsFromReferenceEntries,
  listCuratedTaskRecommendationSignals,
  type CuratedTaskRecommendationSignal,
} from "./curatedTaskRecommendationSignals";

export interface CuratedTaskTemplateItem {
  id: string;
  title: string;
  summary: string;
  outputHint: string;
  resultDestination: string;
  categoryLabel: string;
  prompt: string;
  requiredInputs: string[];
  requiredInputFields: CuratedTaskInputField[];
  optionalReferences: string[];
  outputContract: string[];
  followUpActions: string[];
  badge: string;
  actionLabel: string;
  statusLabel: string;
  statusTone: "emerald";
  recentUsedAt: number | null;
  isRecent: boolean;
  themeTarget?: string;
  shouldEnableWebSearch?: boolean;
  shouldEnableTeamMode?: boolean;
  shouldLaunchBrowserAssist?: boolean;
  followUpActionTargets?: Record<string, CuratedTaskFollowUpActionTarget>;
}

export type CuratedTaskInputFieldType = "text" | "textarea";

export interface CuratedTaskInputField {
  key: string;
  label: string;
  placeholder: string;
  helperText?: string;
  type: CuratedTaskInputFieldType;
}

export type CuratedTaskInputValues = Record<string, string>;

export interface FeaturedCuratedTaskTemplateItem {
  template: CuratedTaskTemplateItem;
  badgeLabel: string;
  reasonLabel?: string;
  reasonSummary?: string;
}

export interface CuratedTaskFollowUpActionTarget {
  taskId: string;
  promptHint?: string;
}

interface CuratedTaskTemplateDefinition {
  id: string;
  title: string;
  summary: string;
  outputHint: string;
  resultDestination: string;
  categoryLabel: string;
  prompt: string;
  requiredInputFields: CuratedTaskInputField[];
  optionalReferences: string[];
  outputContract: string[];
  followUpActions: string[];
  themeTarget?: string;
  shouldEnableWebSearch?: boolean;
  shouldEnableTeamMode?: boolean;
  shouldLaunchBrowserAssist?: boolean;
  followUpActionTargets?: Record<string, CuratedTaskFollowUpActionTarget>;
}

interface CuratedTaskTemplateUsageRecord {
  templateId: string;
  usedAt: number;
  launchInputValues?: CuratedTaskInputValues;
  referenceMemoryIds?: string[];
  referenceEntries?: CuratedTaskReferenceEntry[];
}

const CURATED_TASK_TEMPLATE_USAGE_STORAGE_KEY =
  "lime:curated-task-template-usage:v2";
const MAX_CURATED_TASK_TEMPLATE_USAGE_RECORDS = 12;
export const CURATED_TASK_TEMPLATE_USAGE_CHANGED_EVENT =
  "lime:curated-task-template-usage-changed";

export interface CuratedTaskTemplateLaunchPrefill {
  inputValues?: CuratedTaskInputValues;
  referenceMemoryIds?: string[];
  referenceEntries?: CuratedTaskReferenceEntry[];
  hint?: string;
}

const CURATED_TASK_TEMPLATES: CuratedTaskTemplateDefinition[] = [
  {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary:
      "先收一版内容趋势、热点方向和值得继续跟进的切口，适合每天快速开工前拉一遍。",
    outputHint: "趋势摘要 + 选题方向",
    resultDestination: "趋势摘要会先写回当前内容，方便继续展开选题和主稿。",
    categoryLabel: "趋势与选题",
    prompt:
      "请先给我做一版每日趋势摘要：围绕当前主题梳理最近值得关注的趋势、热点内容方向、代表案例、用户正在关心的问题，以及最值得立即开工的 3 个选题。",
    requiredInputFields: [
      {
        key: "theme_target",
        label: "主题或赛道",
        placeholder: "例如 AI 内容创作、咖啡品牌联名、跨境电商女装",
        helperText: "先告诉 Lime 你今天要盯哪条内容主线。",
        type: "text",
      },
      {
        key: "platform_region",
        label: "希望关注的平台/地域",
        placeholder: "例如 X + TikTok（北美）或 小红书（中文）",
        helperText: "先限定平台、地域或语种，趋势会更聚焦。",
        type: "text",
      },
    ],
    optionalReferences: ["已有账号方向", "过去爆款链接"],
    outputContract: ["趋势摘要", "3 个优先选题", "代表案例线索"],
    followUpActions: ["继续展开其中一个选题", "生成首条内容主稿"],
    shouldEnableWebSearch: true,
  },
  {
    id: "social-post-starter",
    title: "内容主稿生成",
    summary:
      "围绕目标受众、表达结构和关键信息，先生成一版可继续迭代的内容首稿。",
    outputHint: "内容首稿 + 结构提纲",
    resultDestination: "首版主稿会先进入当前内容，方便继续改写、拆成多平台版本。",
    categoryLabel: "内容起稿",
    prompt:
      "请先帮我起草一版内容首稿：明确目标受众、标题方向、正文结构、核心观点和可继续扩写的角度，并给我一版适合继续打磨的正文。",
    requiredInputFields: [
      {
        key: "subject_or_product",
        label: "主题或产品信息",
        placeholder: "输入主题、产品、活动或你已经掌握的关键信息",
        helperText: "这里适合放主题背景、产品卖点或活动主张。",
        type: "textarea",
      },
      {
        key: "target_audience",
        label: "目标受众",
        placeholder: "例如 25-35 岁新消费品牌运营，或 正在找 AI 剪辑工具的创作者",
        helperText: "先说清楚这条内容是写给谁看的。",
        type: "text",
      },
    ],
    optionalReferences: ["品牌语气", "参考案例或灵感图片"],
    outputContract: ["内容首稿", "结构提纲", "可继续扩写角度"],
    followUpActions: ["改成多平台版本", "转成口播/字幕稿"],
  },
  {
    id: "viral-content-breakdown",
    title: "拆解一条爆款内容",
    summary:
      "把一条高表现内容拆成标题钩子、结构节奏、素材手法和可复用套路，方便快速复刻。",
    outputHint: "爆款拆解 + 可复用模板",
    resultDestination: "拆解结论会先沉淀到当前内容，方便马上复刻成你的版本。",
    categoryLabel: "爆款拆解",
    prompt:
      "请帮我拆解这条爆款内容：识别它的目标受众、标题钩子、开场方式、结构节奏、视觉/素材手法、情绪推动点和转化动作，并总结一版可复用模板。",
    requiredInputFields: [
      {
        key: "source_content",
        label: "爆款链接或内容文本",
        placeholder: "贴链接、标题、正文，或一段关键内容摘要",
        helperText: "Lime 需要知道你想拆哪条内容。",
        type: "textarea",
      },
      {
        key: "reuse_goal",
        label: "你想复用的目标",
        placeholder: "例如 学标题钩子、复刻结构、改成品牌账号版本",
        helperText: "告诉 Lime 你想学它的哪一部分。",
        type: "text",
      },
    ],
    optionalReferences: ["自己的账号定位", "竞品样本"],
    outputContract: ["结构拆解", "可复用套路", "复刻建议"],
    followUpActions: ["改成你的版本", "生成跟进主稿"],
    shouldEnableWebSearch: true,
  },
  {
    id: "longform-multiplatform-rewrite",
    title: "长文转多平台发布稿",
    summary:
      "把长文、资料或文章整理成多平台可直接发布的版本，不用再自己拆标题和结构。",
    outputHint: "多平台发布稿 + 标题组",
    resultDestination: "多平台发布稿会先写回当前内容，继续在当前工作区整理和拆分。",
    categoryLabel: "多平台改写",
    prompt:
      "请把这篇长文整理成多平台发布稿：先提炼核心观点，再给我输出标题组、摘要、正文结构，以及适合不同平台的发布版本和 CTA 建议。",
    requiredInputFields: [
      {
        key: "source_article",
        label: "原始长文或资料",
        placeholder: "粘贴文章、会议纪要、资料摘要，或放一段核心内容",
        helperText: "给原始材料即可，不用先自己整理。",
        type: "textarea",
      },
      {
        key: "target_platform",
        label: "目标平台",
        placeholder: "例如 X、LinkedIn、小红书、公众号",
        helperText: "告诉 Lime 你这次想优先改到哪些平台。",
        type: "text",
      },
    ],
    optionalReferences: ["品牌语气", "发布限制或 CTA"],
    outputContract: ["标题组", "多平台发布稿", "CTA 建议"],
    followUpActions: ["生成配图方向", "补成口播或短视频脚本"],
  },
  {
    id: "script-to-voiceover",
    title: "脚本转口播/字幕稿",
    summary:
      "把现有脚本整理成更适合口播和字幕的版本，补齐停顿、节奏和适合出镜表达的语气。",
    outputHint: "口播稿 + 字幕稿",
    resultDestination:
      "口播稿和字幕稿会先写回当前内容，方便继续改分镜、配音或多语言版本。",
    categoryLabel: "视频脚本",
    prompt:
      "请把这份脚本整理成适合口播和字幕的版本：优化句长、停顿、重音提示、镜头感表达和字幕切分，并附上适合配音录制的版本。",
    requiredInputFields: [
      {
        key: "existing_script",
        label: "现有脚本",
        placeholder: "贴现有脚本、文案，或一段想改成口播的内容",
        helperText: "先把原始表达给到 Lime。",
        type: "textarea",
      },
      {
        key: "voiceover_context",
        label: "口播场景或时长",
        placeholder: "例如 60 秒出镜口播、短视频字幕版、直播预告",
        helperText: "用一句话告诉 Lime 你要把它说成什么样。",
        type: "text",
      },
    ],
    optionalReferences: ["说话风格", "出镜人设"],
    outputContract: ["口播稿", "字幕切分", "配音版本"],
    followUpActions: ["继续生成分镜", "整理多语言版本"],
  },
  {
    id: "account-project-review",
    title: "复盘这个账号/项目",
    summary:
      "围绕目标、已有结果和下一步动作做一次结构化复盘，适合内容账号、项目推进和运营回看。",
    outputHint: "复盘摘要 + 下一步建议",
    resultDestination:
      "复盘摘要会先回到当前内容，并把下一轮动作继续带回生成工作台。",
    categoryLabel: "复盘与优化",
    prompt:
      "请帮我复盘这个账号或项目：先明确目标、当前结果、关键问题、哪些动作有效、哪些地方拖后腿，再给出下一轮最值得执行的优化建议。",
    requiredInputFields: [
      {
        key: "project_goal",
        label: "账号或项目目标",
        placeholder: "例如 一个季度涨粉 1 万、提升新品转化、连续 30 天稳定输出",
        helperText: "先说明这次复盘到底要对齐什么目标。",
        type: "text",
      },
      {
        key: "existing_results",
        label: "已有结果或数据",
        placeholder: "贴关键数据、结果摘要、最近内容表现，或当前遇到的问题",
        helperText: "Lime 需要知道现在做到哪一步了。",
        type: "textarea",
      },
    ],
    optionalReferences: ["最近内容链接", "本轮想解决的问题"],
    outputContract: ["复盘摘要", "关键问题", "下一轮动作建议"],
    followUpActions: ["继续做趋势摘要", "生成下一轮内容方案"],
    followUpActionTargets: {
      "继续做趋势摘要": {
        taskId: "daily-trend-briefing",
        promptHint:
          "请承接这轮复盘结论，先补一轮值得继续跟进的趋势与机会窗口。",
      },
      "生成下一轮内容方案": {
        taskId: "social-post-starter",
        promptHint:
          "请承接这轮复盘结论，直接生成下一轮最值得执行的内容方案。",
      },
    },
    shouldEnableTeamMode: true,
  },
];

export const FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS = [
  "daily-trend-briefing",
  "social-post-starter",
  "viral-content-breakdown",
  "longform-multiplatform-rewrite",
  "script-to-voiceover",
  "account-project-review",
] as const;

const CURATED_TASK_RECOMMENDATION_LABELS = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
} as const;

const CURATED_TASK_RECOMMENDATION_KEYWORDS: Record<string, string[]> = {
  "daily-trend-briefing": [
    "趋势",
    "热点",
    "选题",
    "热度",
    "趋势摘要",
    "trend",
    "topic",
    "tiktok",
    "instagram",
    "x",
    "小红书",
  ],
  "social-post-starter": [
    "文案",
    "主稿",
    "品牌",
    "语气",
    "口吻",
    "风格",
    "调性",
    "卖点",
    "内容",
    "受众",
  ],
  "viral-content-breakdown": [
    "爆款",
    "拆解",
    "案例",
    "复刻",
    "参考",
    "链接",
    "竞品",
    "对标",
    "素材",
  ],
  "longform-multiplatform-rewrite": [
    "长文",
    "文章",
    "改写",
    "发布",
    "平台",
    "公众号",
    "linkedin",
    "cta",
    "摘要",
  ],
  "script-to-voiceover": [
    "脚本",
    "口播",
    "字幕",
    "配音",
    "旁白",
    "视频",
    "出镜",
    "voice",
  ],
  "account-project-review": [
    "复盘",
    "反馈",
    "优化",
    "问题",
    "数据",
    "账号",
    "项目",
    "表现",
    "增长",
    "scorecard",
    "review",
  ],
};

const CURATED_TASK_RECOMMENDATION_CATEGORY_WEIGHTS: Record<
  string,
  Partial<Record<keyof typeof CURATED_TASK_RECOMMENDATION_LABELS, number>>
> = {
  "daily-trend-briefing": {
    context: 9,
    activity: 12,
    experience: 4,
  },
  "social-post-starter": {
    identity: 12,
    preference: 11,
    context: 7,
    experience: 3,
  },
  "viral-content-breakdown": {
    context: 14,
    activity: 13,
    experience: 6,
  },
  "longform-multiplatform-rewrite": {
    context: 10,
    experience: 10,
    preference: 5,
  },
  "script-to-voiceover": {
    identity: 6,
    preference: 7,
    experience: 10,
  },
  "account-project-review": {
    experience: 28,
    context: 5,
    preference: 4,
  },
};

function isValidUsageRecord(
  value: unknown,
): value is CuratedTaskTemplateUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<CuratedTaskTemplateUsageRecord>;
  return (
    typeof record.templateId === "string" &&
    record.templateId.length > 0 &&
    typeof record.usedAt === "number" &&
    Number.isFinite(record.usedAt)
  );
}

function normalizeCuratedTaskUsageInputValues(
  inputValues?: CuratedTaskInputValues | null,
): CuratedTaskInputValues | undefined {
  if (!inputValues || typeof inputValues !== "object") {
    return undefined;
  }

  const normalizedEntries = Object.entries(inputValues)
    .map(([key, value]) => [
      key.trim(),
      normalizeCuratedTaskInputValue(String(value ?? "")),
    ] as const)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].length > 0 && entry[1].length > 0,
    );

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function normalizeCuratedTaskUsageRecord(
  record: CuratedTaskTemplateUsageRecord,
): CuratedTaskTemplateUsageRecord {
  const normalizedReferenceEntries = mergeCuratedTaskReferenceEntries(
    record.referenceEntries ?? [],
  ).slice(0, 3);
  const normalizedReferenceMemoryIds = normalizeCuratedTaskReferenceMemoryIds([
    ...(record.referenceMemoryIds ?? []),
    ...(extractCuratedTaskReferenceMemoryIds(
      normalizedReferenceEntries,
    ) ?? []),
  ]);
  const normalizedLaunchInputValues = normalizeCuratedTaskUsageInputValues(
    record.launchInputValues,
  );

  return {
    templateId: record.templateId.trim(),
    usedAt: record.usedAt,
    ...(normalizedLaunchInputValues
      ? {
          launchInputValues: normalizedLaunchInputValues,
        }
      : {}),
    ...(normalizedReferenceMemoryIds
      ? {
          referenceMemoryIds: normalizedReferenceMemoryIds,
        }
      : {}),
    ...(normalizedReferenceEntries.length > 0
      ? {
          referenceEntries: normalizedReferenceEntries,
        }
      : {}),
  };
}

function listCuratedTaskTemplateUsage(): CuratedTaskTemplateUsageRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      CURATED_TASK_TEMPLATE_USAGE_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isValidUsageRecord)
      .map(normalizeCuratedTaskUsageRecord)
      .sort((left, right) => right.usedAt - left.usedAt)
      .slice(0, MAX_CURATED_TASK_TEMPLATE_USAGE_RECORDS);
  } catch {
    return [];
  }
}

function getCuratedTaskTemplateUsageMap(): Map<
  string,
  CuratedTaskTemplateUsageRecord
> {
  return new Map(
    listCuratedTaskTemplateUsage().map((record) => [
      record.templateId,
      record,
    ]),
  );
}

function emitCuratedTaskTemplateUsageChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(CURATED_TASK_TEMPLATE_USAGE_CHANGED_EVENT),
  );
}

export function subscribeCuratedTaskTemplateUsageChanged(
  callback: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const customEventHandler = () => {
    callback();
  };

  const storageHandler = (event: StorageEvent) => {
    if (event.key !== CURATED_TASK_TEMPLATE_USAGE_STORAGE_KEY) {
      return;
    }

    callback();
  };

  window.addEventListener(
    CURATED_TASK_TEMPLATE_USAGE_CHANGED_EVENT,
    customEventHandler,
  );
  window.addEventListener("storage", storageHandler);

  return () => {
    window.removeEventListener(
      CURATED_TASK_TEMPLATE_USAGE_CHANGED_EVENT,
      customEventHandler,
    );
    window.removeEventListener("storage", storageHandler);
  };
}

export function resolveCuratedTaskTemplateLaunchPrefill(
  task:
    | Pick<CuratedTaskTemplateItem, "id" | "title">
    | Pick<CuratedTaskTemplateDefinition, "id" | "title">
    | null,
): CuratedTaskTemplateLaunchPrefill | null {
  if (!task) {
    return null;
  }

  const recentRecord = getCuratedTaskTemplateUsageMap().get(task.id);
  if (!recentRecord) {
    return null;
  }

  const hasPrefill =
    Boolean(recentRecord.launchInputValues) ||
    Boolean(recentRecord.referenceMemoryIds?.length) ||
    Boolean(recentRecord.referenceEntries?.length);
  if (!hasPrefill) {
    return null;
  }

  return {
    inputValues: recentRecord.launchInputValues,
    referenceMemoryIds: recentRecord.referenceMemoryIds,
    referenceEntries: recentRecord.referenceEntries,
    hint: `已根据你上次启动 ${task.title} 时的参数自动预填，可继续修改后进入生成。`,
  };
}

function resolveCuratedTaskTemplateBadge(
  template: CuratedTaskTemplateDefinition,
  isRecent: boolean,
): string {
  if (isRecent) {
    return "最近使用";
  }

  return template.categoryLabel;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesTemplateQuery(
  query: string,
  template: Pick<
    CuratedTaskTemplateItem,
    | "title"
    | "summary"
    | "outputHint"
    | "resultDestination"
    | "categoryLabel"
    | "prompt"
    | "requiredInputs"
    | "optionalReferences"
    | "outputContract"
    | "followUpActions"
  >,
): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return true;
  }

  return [
    template.title,
    template.summary,
    template.outputHint,
    template.resultDestination,
    template.categoryLabel,
    template.prompt,
    ...template.requiredInputs,
    ...template.optionalReferences,
    ...template.outputContract,
    ...template.followUpActions,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function summarizeCuratedTaskFactItems(
  items: string[],
  limit = 2,
): string {
  const normalizedItems = items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (normalizedItems.length === 0) {
    return "";
  }

  if (normalizedItems.length <= limit) {
    return normalizedItems.join("、");
  }

  return `${normalizedItems.slice(0, limit).join("、")} 等 ${normalizedItems.length} 项`;
}

function normalizeCuratedTaskInputValue(value: string | undefined): string {
  return String(value ?? "").trim();
}

export function summarizeCuratedTaskRequiredInputs(
  task: Pick<CuratedTaskTemplateItem, "requiredInputs">,
  limit = 2,
): string {
  return summarizeCuratedTaskFactItems(task.requiredInputs, limit);
}

export function summarizeCuratedTaskOptionalReferences(
  task: Pick<CuratedTaskTemplateItem, "optionalReferences">,
  limit = 2,
): string {
  return summarizeCuratedTaskFactItems(task.optionalReferences, limit);
}

export function summarizeCuratedTaskOutputContract(
  task: Pick<CuratedTaskTemplateItem, "outputContract">,
  limit = 2,
): string {
  return summarizeCuratedTaskFactItems(task.outputContract, limit);
}

export function summarizeCuratedTaskFollowUpActions(
  task: Pick<CuratedTaskTemplateItem, "followUpActions">,
  limit = 2,
): string {
  return summarizeCuratedTaskFactItems(task.followUpActions, limit);
}

function summarizeCuratedTaskRecentValue(
  value: string,
  maxLength = 36,
): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export function buildCuratedTaskRecentUsageDescription(params: {
  task: Pick<CuratedTaskTemplateItem, "requiredInputFields">;
  prefill?: CuratedTaskTemplateLaunchPrefill | null;
  fieldLimit?: number;
}): string {
  const fieldLimit = params.fieldLimit ?? 2;
  const launchInputSummaryItems = params.task.requiredInputFields
    .map((field) => {
      const rawValue = params.prefill?.inputValues?.[field.key];
      const normalizedValue = normalizeCuratedTaskInputValue(rawValue);
      if (!normalizedValue) {
        return null;
      }

      return `${field.label}=${summarizeCuratedTaskRecentValue(
        normalizedValue,
      )}`;
    })
    .filter((item): item is string => Boolean(item));

  const segments: string[] = [];

  if (launchInputSummaryItems.length > 0) {
    const visibleItems = launchInputSummaryItems.slice(0, fieldLimit);
    segments.push(
      `上次填写：${visibleItems.join("；")}${
        launchInputSummaryItems.length > fieldLimit
          ? ` 等 ${launchInputSummaryItems.length} 项`
          : ""
      }`,
    );
  }

  const referenceEntries =
    mergeCuratedTaskReferenceEntries(params.prefill?.referenceEntries ?? []);
  if (referenceEntries.length > 0) {
    const referenceTitles = referenceEntries
      .map((entry) => entry.title.trim())
      .filter((title) => title.length > 0);
    const visibleTitles = referenceTitles.slice(0, fieldLimit);
    segments.push(
      visibleTitles.length > 0
        ? `参考：${visibleTitles.join("；")}${
            referenceTitles.length > fieldLimit
              ? ` 等 ${referenceTitles.length} 条`
              : ""
          }`
        : `参考：${referenceEntries.length} 条参考对象`,
    );
  }

  return segments.join(" · ");
}

export function buildCuratedTaskFollowUpDescription(
  task: Pick<CuratedTaskTemplateItem, "followUpActions">,
  options: {
    limit?: number;
    prefix?: string;
  } = {},
): string {
  const summary = summarizeCuratedTaskFollowUpActions(task, options.limit);
  if (!summary) {
    return "";
  }

  return `${options.prefix ?? "下一步："}${summary}`;
}

export function buildCuratedTaskCapabilityDescription(
  task: Pick<
    CuratedTaskTemplateItem,
    | "summary"
    | "requiredInputs"
    | "outputContract"
    | "resultDestination"
    | "followUpActions"
  >,
  options: {
    includeSummary?: boolean;
    requiredLimit?: number;
    outputLimit?: number;
    includeResultDestination?: boolean;
    includeFollowUpActions?: boolean;
    followUpLimit?: number;
  } = {},
): string {
  const segments: string[] = [];
  const summary = task.summary.trim();

  if (options.includeSummary !== false && summary.length > 0) {
    segments.push(summary);
  }

  const requiredSummary = summarizeCuratedTaskRequiredInputs(
    task,
    options.requiredLimit,
  );
  if (requiredSummary) {
    segments.push(`需要：${requiredSummary}`);
  }

  const outputSummary = summarizeCuratedTaskOutputContract(
    task,
    options.outputLimit,
  );
  if (outputSummary) {
    segments.push(`交付：${outputSummary}`);
  }

  if (options.includeResultDestination) {
    const resultDestination = task.resultDestination.trim();
    if (resultDestination.length > 0) {
      segments.push(`去向：${resultDestination}`);
    }
  }

  if (options.includeFollowUpActions) {
    const followUpSummary = buildCuratedTaskFollowUpDescription(task, {
      limit: options.followUpLimit,
    });
    if (followUpSummary) {
      segments.push(followUpSummary);
    }
  }

  return segments.join(" · ");
}

export function getCuratedTaskOutputDestination(
  task: Pick<CuratedTaskTemplateItem, "resultDestination">,
): string {
  return task.resultDestination.trim();
}

export function createEmptyCuratedTaskInputValues(
  task: Pick<CuratedTaskTemplateItem, "requiredInputFields">,
): CuratedTaskInputValues {
  return resolveCuratedTaskInputValues({
    task,
  });
}

export function resolveCuratedTaskInputValues(params: {
  task: Pick<CuratedTaskTemplateItem, "requiredInputFields">;
  inputValues?: CuratedTaskInputValues | null;
}): CuratedTaskInputValues {
  return Object.fromEntries(
    params.task.requiredInputFields.map((field) => [
      field.key,
      String(params.inputValues?.[field.key] ?? ""),
    ]),
  );
}

export function hasFilledAllCuratedTaskRequiredInputs(params: {
  task: Pick<CuratedTaskTemplateItem, "requiredInputFields">;
  inputValues: CuratedTaskInputValues;
}): boolean {
  return params.task.requiredInputFields.every(
    (field) => normalizeCuratedTaskInputValue(params.inputValues[field.key]).length > 0,
  );
}

export function buildCuratedTaskLaunchPrompt(params: {
  task: Pick<
    CuratedTaskTemplateItem,
    "prompt" | "requiredInputFields" | "outputContract"
  >;
  inputValues: CuratedTaskInputValues;
  referenceEntries?: CuratedTaskReferenceEntry[];
}): string {
  const starterFacts = params.task.requiredInputFields
    .map((field) => {
      const value = normalizeCuratedTaskInputValue(params.inputValues[field.key]);
      if (!value) {
        return null;
      }
      return `- ${field.label}：${value}`;
    })
    .filter((line): line is string => Boolean(line));

  const sections = [params.task.prompt];
  if (starterFacts.length > 0) {
    sections.push(`启动信息：\n${starterFacts.join("\n")}`);
  }
  const referencePromptBlock = buildCuratedTaskReferencePromptBlock(
    params.referenceEntries,
  );
  if (referencePromptBlock) {
    sections.push(referencePromptBlock);
  }
  if (params.task.outputContract.length > 0) {
    sections.push(
      `本轮先优先给我：\n${params.task.outputContract
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }
  sections.push(
    "如果信息还不够完整，请先基于现有信息给出可执行首版，再明确指出还缺哪些内容。",
  );

  return sections.join("\n\n");
}

export function replaceCuratedTaskLaunchPromptInInput(params: {
  currentInput: string;
  previousPrompt?: string | null;
  nextPrompt: string;
}): string {
  const { currentInput, previousPrompt, nextPrompt } = params;

  if (!currentInput.trim()) {
    return nextPrompt;
  }

  if (!previousPrompt || !previousPrompt.trim()) {
    return nextPrompt;
  }

  if (currentInput === previousPrompt) {
    return nextPrompt;
  }

  if (currentInput.startsWith(previousPrompt)) {
    return `${nextPrompt}${currentInput.slice(previousPrompt.length)}`;
  }

  return nextPrompt;
}

export function listCuratedTaskTemplates(): CuratedTaskTemplateItem[] {
  const usageMap = getCuratedTaskTemplateUsageMap();

  return CURATED_TASK_TEMPLATES.map((template, index) => {
    const recentRecord = usageMap.get(template.id);
    const recentUsedAt = recentRecord?.usedAt ?? null;

    return {
      ...template,
      requiredInputs: template.requiredInputFields.map((field) => field.label),
      badge: resolveCuratedTaskTemplateBadge(
        template,
        typeof recentUsedAt === "number",
      ),
      actionLabel: "进入生成",
      statusLabel: "可直接开始",
      statusTone: "emerald" as const,
      recentUsedAt,
      isRecent: typeof recentUsedAt === "number",
      _sortIndex: index,
    };
  })
    .sort((left, right) => {
      if (left.recentUsedAt && right.recentUsedAt) {
        if (left.recentUsedAt !== right.recentUsedAt) {
          return right.recentUsedAt - left.recentUsedAt;
        }
      } else if (left.recentUsedAt) {
        return -1;
      } else if (right.recentUsedAt) {
        return 1;
      }

      return left._sortIndex - right._sortIndex;
    })
    .map(({ _sortIndex, ...template }) => template);
}

export function filterCuratedTaskTemplates(
  query: string,
  templates: CuratedTaskTemplateItem[] = listCuratedTaskTemplates(),
): CuratedTaskTemplateItem[] {
  return templates.filter((template) => matchesTemplateQuery(query, template));
}

function buildFeaturedTemplateBaseScore(
  template: CuratedTaskTemplateItem,
): number {
  const featuredIndex = FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS.findIndex(
    (templateId) => templateId === template.id,
  );
  if (featuredIndex >= 0) {
    return 72 - featuredIndex * 7;
  }

  const nonFeaturedTemplateIds = CURATED_TASK_TEMPLATES.map(
    (current) => current.id,
  ).filter(
    (templateId) =>
      !FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS.includes(
        templateId as (typeof FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS)[number],
      ),
  );
  const nonFeaturedIndex = nonFeaturedTemplateIds.findIndex(
    (templateId) => templateId === template.id,
  );

  return nonFeaturedIndex >= 0 ? 30 - nonFeaturedIndex * 3 : 24;
}

function buildRecommendationSignalText(
  signal: CuratedTaskRecommendationSignal,
): string {
  return [signal.title, signal.summary, ...signal.tags]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join(" ");
}

function summarizeRecommendationReferenceTitle(
  title: string,
  maxLength = 18,
): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveReferenceContinuationMatch(params: {
  template: CuratedTaskTemplateItem;
  referenceEntry: CuratedTaskReferenceEntry;
}): {
  score: number;
  reasonLabel: string;
  reasonSummary: string;
} | null {
  const { template, referenceEntry } = params;
  if (referenceEntry.category !== "experience") {
    return null;
  }

  if (!referenceEntry.taskPrefillByTaskId?.[template.id]) {
    return null;
  }

  const summarizedTitle = summarizeRecommendationReferenceTitle(
    referenceEntry.title,
  );

  switch (template.id) {
    case "account-project-review":
      return {
        score: 40,
        reasonLabel: "围绕当前成果",
        reasonSummary: `先对齐「${summarizedTitle}」这轮结果基线，再决定下一轮动作`,
      };
    case "daily-trend-briefing":
      return {
        score: 15,
        reasonLabel: "承接当前结果",
        reasonSummary: `围绕「${summarizedTitle}」这轮结果继续找趋势窗口`,
      };
    case "social-post-starter":
      return {
        score: 14,
        reasonLabel: "承接当前结果",
        reasonSummary: `把「${summarizedTitle}」这轮结果直接带成下一版主稿`,
      };
    default:
      return null;
  }
}

function resolveRecommendationReasonLabel(
  signal: CuratedTaskRecommendationSignal,
): string {
  if (signal.source === "review_feedback") {
    return "围绕最近复盘";
  }

  const categoryLabel =
    CURATED_TASK_RECOMMENDATION_LABELS[signal.category] || "灵感";

  if (signal.source === "active_reference") {
    return `围绕当前${categoryLabel}`;
  }

  return `围绕最近${categoryLabel}`;
}

function resolveRecommendationReasonSummary(
  signal: CuratedTaskRecommendationSignal,
): string {
  if (signal.source === "review_feedback") {
    return signal.title.length > 20
      ? `复盘：${signal.title.slice(0, 20).trimEnd()}…`
      : `复盘：${signal.title}`;
  }

  const categoryLabel = getCuratedTaskReferenceCategoryLabel(signal.category);

  return signal.title.length > 18
    ? `${categoryLabel}：${signal.title.slice(0, 18).trimEnd()}…`
    : `${categoryLabel}：${signal.title}`;
}

function scoreTemplateForRecommendationSignal(params: {
  template: CuratedTaskTemplateItem;
  signal: CuratedTaskRecommendationSignal;
  projectId?: string | null;
}): {
  score: number;
  reasonLabel: string;
  reasonSummary: string;
} {
  const { template, signal, projectId } = params;
  const categoryWeight =
    CURATED_TASK_RECOMMENDATION_CATEGORY_WEIGHTS[template.id]?.[
      signal.category
    ] ?? 0;
  const normalizedText = buildRecommendationSignalText(signal);
  const keywordScore = (
    CURATED_TASK_RECOMMENDATION_KEYWORDS[template.id] ?? []
  )
    .filter((keyword) => normalizedText.includes(keyword.toLowerCase()))
    .slice(0, 3).length;

  const activeReferenceBonus = signal.source === "active_reference" ? 8 : 0;
  const reviewFeedbackBonus = signal.source === "review_feedback" ? 6 : 0;
  const preferredTaskBonus =
    signal.preferredTaskIds?.includes(template.id) ? 30 : 0;
  const projectMatchBonus =
    projectId && signal.projectId && projectId === signal.projectId ? 4 : 0;
  const recentSignalBonus =
    signal.source === "saved_inspiration" ||
    signal.source === "review_feedback"
      ? Math.max(
          0,
          5 -
            Math.floor((Date.now() - signal.createdAt) / (24 * 60 * 60 * 1000)),
        )
      : 0;

  return {
    score:
      categoryWeight +
      keywordScore * 4 +
      activeReferenceBonus +
      reviewFeedbackBonus +
      preferredTaskBonus +
      projectMatchBonus +
      recentSignalBonus,
    reasonLabel: resolveRecommendationReasonLabel(signal),
    reasonSummary: resolveRecommendationReasonSummary(signal),
  };
}

export function listFeaturedHomeCuratedTaskTemplates(
  templates: CuratedTaskTemplateItem[] = listCuratedTaskTemplates(),
  options: {
    projectId?: string | null;
    referenceEntries?: CuratedTaskReferenceEntry[] | null;
    sessionId?: string | null;
    limit?: number;
  } = {},
): FeaturedCuratedTaskTemplateItem[] {
  const limit =
    options.limit ?? FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS.length;
  const referenceEntries = mergeCuratedTaskReferenceEntries(
    options.referenceEntries ?? [],
  );
  const signals = [
    ...buildCuratedTaskRecommendationSignalsFromReferenceEntries(referenceEntries, {
      projectId: options.projectId,
      sessionId: options.sessionId,
    }),
    ...listCuratedTaskRecommendationSignals({
      projectId: options.projectId,
      sessionId: options.sessionId,
    }),
  ];

  return templates
    .map((template) => {
      const bestSignalMatch = signals.reduce<{
        score: number;
        reasonLabel?: string;
        reasonSummary?: string;
      }>(
        (best, signal) => {
          const current = scoreTemplateForRecommendationSignal({
            template,
            signal,
            projectId: options.projectId,
          });
          if (current.score <= best.score) {
            return best;
          }
          return current;
        },
        { score: 0 },
      );
      const bestReferenceContinuationMatch = referenceEntries.reduce<{
        score: number;
        reasonLabel?: string;
        reasonSummary?: string;
      }>(
        (best, referenceEntry) => {
          const current = resolveReferenceContinuationMatch({
            template,
            referenceEntry,
          });
          if (!current || current.score <= best.score) {
            return best;
          }

          return current;
        },
        { score: 0 },
      );
      const bestReasonMatch =
        bestReferenceContinuationMatch.score > 0
          ? bestReferenceContinuationMatch
          : bestSignalMatch;

      return {
        template,
        badgeLabel: bestReasonMatch.reasonLabel || template.badge,
        reasonLabel: bestReasonMatch.reasonLabel,
        reasonSummary: bestReasonMatch.reasonSummary,
        _continuationPriority: bestReferenceContinuationMatch.score > 0 ? 1 : 0,
        _score:
          buildFeaturedTemplateBaseScore(template) +
          bestReasonMatch.score +
          (bestReasonMatch.score >= 20 ? 24 : 0),
      };
    })
    .sort((left, right) => {
      if (left._continuationPriority !== right._continuationPriority) {
        return right._continuationPriority - left._continuationPriority;
      }
      if (left._score !== right._score) {
        return right._score - left._score;
      }
      return left.template.title.localeCompare(right.template.title, "zh-CN");
    })
    .slice(0, limit)
    .map(
      ({
        _continuationPriority: _ignoredContinuationPriority,
        _score: _ignoredScore,
        ...item
      }) => item,
    );
}

export function findCuratedTaskTemplateById(
  templateId: string,
): CuratedTaskTemplateItem | null {
  return (
    listCuratedTaskTemplates().find((template) => template.id === templateId) ??
    null
  );
}

export function resolveCuratedTaskFollowUpActionTarget(params: {
  taskId?: string | null;
  action: string;
}): {
  task: CuratedTaskTemplateItem;
  promptHint?: string;
} | null {
  const taskId = params.taskId?.trim();
  const action = params.action.trim();
  if (!taskId || !action) {
    return null;
  }

  const sourceTask = findCuratedTaskTemplateById(taskId);
  const target = sourceTask?.followUpActionTargets?.[action];
  if (!target?.taskId) {
    return null;
  }

  const task = findCuratedTaskTemplateById(target.taskId);
  if (!task) {
    return null;
  }

  return {
    task,
    ...(target.promptHint?.trim()
      ? {
          promptHint: target.promptHint.trim(),
        }
      : {}),
  };
}

export function recordCuratedTaskTemplateUsage(
  input:
    | string
    | {
        templateId: string;
        usedAt?: number;
        launchInputValues?: CuratedTaskInputValues | null;
        referenceMemoryIds?: string[] | null;
        referenceEntries?: CuratedTaskReferenceEntry[] | null;
      },
): void {
  const normalizedInput =
    typeof input === "string" ? { templateId: input } : input;
  const normalizedReferenceEntries = mergeCuratedTaskReferenceEntries(
    normalizedInput.referenceEntries ?? [],
  ).slice(0, 3);
  const normalizedReferenceMemoryIds = normalizeCuratedTaskReferenceMemoryIds([
    ...(normalizedInput.referenceMemoryIds ?? []),
    ...(extractCuratedTaskReferenceMemoryIds(
      normalizedReferenceEntries,
    ) ?? []),
  ]);
  const normalizedLaunchInputValues = normalizeCuratedTaskUsageInputValues(
    normalizedInput.launchInputValues,
  );
  const nextRecord = normalizeCuratedTaskUsageRecord({
    templateId: normalizedInput.templateId,
    usedAt: normalizedInput.usedAt ?? Date.now(),
    ...(normalizedLaunchInputValues
      ? {
          launchInputValues: normalizedLaunchInputValues,
        }
      : {}),
    ...(normalizedReferenceMemoryIds
      ? {
          referenceMemoryIds: normalizedReferenceMemoryIds,
        }
      : {}),
    ...(normalizedReferenceEntries.length > 0
      ? {
          referenceEntries: normalizedReferenceEntries,
        }
      : {}),
  });

  const nextRecords = [
    nextRecord,
    ...listCuratedTaskTemplateUsage().filter(
      (record) => record.templateId !== nextRecord.templateId,
    ),
  ].slice(0, MAX_CURATED_TASK_TEMPLATE_USAGE_RECORDS);

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CURATED_TASK_TEMPLATE_USAGE_STORAGE_KEY,
      JSON.stringify(nextRecords),
    );
    emitCuratedTaskTemplateUsageChanged();
  } catch {
    // ignore write errors
  }
}
