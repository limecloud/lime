import type { CreationReplayMetadata } from "../utils/creationReplayMetadata";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotDefinition,
  ServiceSkillSlotValues,
} from "./types";

export interface CreationReplaySlotPrefillResult {
  slotValues: ServiceSkillSlotValues;
  fieldLabels: string[];
  hint: string;
}

const PLATFORM_MATCHERS = [
  {
    value: "xiaohongshu",
    keywords: ["小红书", "xiaohongshu", "rednote"],
  },
  {
    value: "douyin",
    keywords: ["抖音", "douyin"],
  },
  {
    value: "x",
    keywords: ["x / twitter", "x/twitter", "twitter", "推特", "x 平台"],
  },
  {
    value: "bilibili",
    keywords: ["bilibili", "b站", "b 站"],
  },
  {
    value: "general",
    keywords: ["通用平台", "全平台", "多平台", "跨平台"],
  },
] as const;

const LANGUAGE_MATCHERS = [
  { value: "中文", keywords: ["中文", "汉语", "普通话", "国语"] },
  { value: "英文", keywords: ["英文", "英语", "english"] },
  { value: "日文", keywords: ["日文", "日语", "japanese"] },
  { value: "韩文", keywords: ["韩文", "韩语", "korean"] },
  { value: "西班牙语", keywords: ["西班牙语", "西语", "spanish"] },
  { value: "法文", keywords: ["法文", "法语", "french"] },
  { value: "德文", keywords: ["德文", "德语", "german"] },
] as const;

const REGION_MATCHERS = [
  { value: "全球", keywords: ["全球", "全网", "global"] },
  { value: "中国", keywords: ["中国", "国内", "china"] },
  { value: "北美", keywords: ["北美", "美国", "加拿大", "north america"] },
  { value: "欧洲", keywords: ["欧洲", "欧盟", "europe"] },
  { value: "日本", keywords: ["日本", "japan"] },
  { value: "韩国", keywords: ["韩国", "korea"] },
  { value: "东南亚", keywords: ["东南亚", "sea", "southeast asia"] },
] as const;

const DURATION_PATTERNS = [
  /\d+\s*(?:-|~|到|至)\s*\d+\s*(?:秒钟?|秒|分钟|分)/,
  /\d+\s*(?:秒钟?|秒|分钟|分)/,
] as const;

const TIME_WINDOW_PATTERNS = [
  /(?:过去|最近)\s*\d+\s*(?:小时|天|周|个月|月|年)/,
  /(?:今日|今天|本周|本月|本季度|本年)/,
] as const;

const SCHEDULE_PATTERNS = [
  /(?:每天|每日)\s*\d{1,2}:\d{2}/,
  /每周[一二三四五六日天]\s*\d{1,2}:\d{2}/,
  /(?:工作日|每个工作日)\s*\d{1,2}:\d{2}/,
  /每\s*\d+\s*(?:秒|分钟|分|小时|时)/,
] as const;

const URL_PREFILL_SLOT_KEYS = new Set([
  "reference_video",
  "video_source",
  "article_url",
]);

const MATERIAL_PREFILL_SLOT_KEYS = new Set([
  "reference_post",
  "article_source",
]);

const EXPAND_MODE_KEYWORDS = [
  "同风格扩写",
  "同风格扩展",
  "扩写",
  "扩展",
  "延展",
  "展开一版",
  "拉长一版",
] as const;

const STRICT_REPLICATION_KEYWORDS = [
  "1:1",
  "一比一",
  "按原结构",
  "贴近原结构",
  "保留原结构",
  "保持原结构",
  "复刻",
  "同结构",
] as const;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeWhitespace(value);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function dedupeItems(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = normalizeOptionalText(item);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function joinInlineItems(
  items: Array<string | null | undefined>,
  maxItems = 4,
  maxLength = 160,
): string {
  const normalized = dedupeItems(items).slice(0, maxItems);
  if (normalized.length === 0) {
    return "";
  }

  return truncate(normalized.join("、"), maxLength);
}

function joinMultilineItems(
  items: Array<string | null | undefined>,
  maxItems = 3,
  maxLength = 320,
): string {
  const normalized = dedupeItems(items).slice(0, maxItems);
  if (normalized.length === 0) {
    return "";
  }

  return truncate(normalized.join("\n"), maxLength);
}

function collectReplayTexts(creationReplay: CreationReplayMetadata): string[] {
  if (creationReplay.kind === "skill_scaffold") {
    return dedupeItems([
      creationReplay.data.name,
      creationReplay.data.description,
      creationReplay.data.source_excerpt,
      ...(creationReplay.data.when_to_use || []),
      ...(creationReplay.data.inputs || []),
      ...(creationReplay.data.outputs || []),
      ...(creationReplay.data.steps || []),
      ...(creationReplay.data.fallback_strategy || []),
    ]);
  }

  return dedupeItems([
    creationReplay.data.title,
    creationReplay.data.summary,
    creationReplay.data.content_excerpt,
    ...(creationReplay.data.tags || []),
  ]);
}

function collectReplaySearchableText(
  creationReplay: CreationReplayMetadata,
): string {
  return collectReplayTexts(creationReplay).join("\n");
}

function extractReplayUrl(creationReplay: CreationReplayMetadata): string {
  const matched = collectReplaySearchableText(creationReplay).match(
    /https?:\/\/[^\s)>\]]+/i,
  );
  if (!matched?.[0]) {
    return "";
  }

  return matched[0].replace(/[.,;!?]+$/g, "");
}

function resolveReplaySourceLabel(
  creationReplay: CreationReplayMetadata,
): string {
  return creationReplay.kind === "memory_entry"
    ? "当前灵感条目"
    : "当前技能草稿";
}

function buildPrefillHint(
  creationReplay: CreationReplayMetadata,
  fieldLabels: string[],
): string {
  const visibleLabels = fieldLabels.slice(0, 3);
  const fieldSummary =
    fieldLabels.length > 3
      ? `${visibleLabels.join("、")} 等参数`
      : visibleLabels.join("、");

  return `已根据${resolveReplaySourceLabel(creationReplay)}自动预填 ${fieldSummary}，可继续修改后执行。`;
}

function findFirstKeywordValue(
  text: string,
  matchers: ReadonlyArray<{
    value: string;
    keywords: readonly string[];
  }>,
): string {
  const normalizedText = text.toLowerCase();
  if (!normalizedText) {
    return "";
  }

  for (const matcher of matchers) {
    if (
      matcher.keywords.some((keyword) =>
        normalizedText.includes(keyword.toLowerCase()),
      )
    ) {
      return matcher.value;
    }
  }

  return "";
}

function findFirstPatternValue(
  text: string,
  patterns: ReadonlyArray<RegExp>,
): string {
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (matched?.[0]) {
      return normalizeWhitespace(matched[0]);
    }
  }

  return "";
}

function resolvePlatformValue(
  slot: ServiceSkillSlotDefinition,
  creationReplay: CreationReplayMetadata,
): string {
  if (slot.key !== "platform" || slot.type !== "platform") {
    return "";
  }

  const optionValues = new Set(
    (slot.options || []).map((option) => option.value),
  );
  const searchableText = collectReplayTexts(creationReplay)
    .join("\n")
    .toLowerCase();
  if (!searchableText) {
    return "";
  }

  for (const matcher of PLATFORM_MATCHERS) {
    if (!optionValues.has(matcher.value)) {
      continue;
    }
    if (
      matcher.keywords.some((keyword) =>
        searchableText.includes(keyword.toLowerCase()),
      )
    ) {
      return matcher.value;
    }
  }

  return "";
}

function resolveUrlValue(
  slot: ServiceSkillSlotDefinition,
  creationReplay: CreationReplayMetadata,
): string {
  if (slot.type !== "url" || !URL_PREFILL_SLOT_KEYS.has(slot.key)) {
    return "";
  }

  return extractReplayUrl(creationReplay);
}

function buildSourceMaterialValue(
  slot: ServiceSkillSlotDefinition,
  creationReplay: CreationReplayMetadata,
): string {
  if (slot.type !== "textarea" || !MATERIAL_PREFILL_SLOT_KEYS.has(slot.key)) {
    return "";
  }

  if (creationReplay.kind === "skill_scaffold") {
    if (
      !creationReplay.data.source_excerpt &&
      !creationReplay.data.description &&
      !creationReplay.data.inputs?.length
    ) {
      return "";
    }

    return joinMultilineItems([
      creationReplay.data.source_excerpt
        ? `参考线索：${creationReplay.data.source_excerpt}`
        : null,
      creationReplay.data.description
        ? `改写目标：${creationReplay.data.description}`
        : null,
      creationReplay.data.inputs?.length
        ? `输入约束：${creationReplay.data.inputs.join("；")}`
        : null,
      creationReplay.data.name ? `来源标题：${creationReplay.data.name}` : null,
    ]);
  }

  if (!creationReplay.data.summary && !creationReplay.data.content_excerpt) {
    return "";
  }

  return joinMultilineItems([
    creationReplay.data.summary ? `摘要：${creationReplay.data.summary}` : null,
    creationReplay.data.content_excerpt
      ? `补充线索：${creationReplay.data.content_excerpt}`
      : null,
    creationReplay.data.title ? `主题：${creationReplay.data.title}` : null,
    creationReplay.data.tags?.length
      ? `沿用标签：${creationReplay.data.tags.join("、")}`
      : null,
  ]);
}

function resolveReplicationModeValue(
  slot: ServiceSkillSlotDefinition,
  creationReplay: CreationReplayMetadata,
): string {
  if (
    slot.type !== "enum" ||
    (slot.key !== "delivery_mode" && slot.key !== "script_mode")
  ) {
    return "";
  }

  const optionValues = new Set(
    (slot.options || []).map((option) => option.value),
  );
  const searchableText =
    collectReplaySearchableText(creationReplay).toLowerCase();
  if (!searchableText) {
    return "";
  }

  if (
    optionValues.has("expand") &&
    EXPAND_MODE_KEYWORDS.some((keyword) =>
      searchableText.includes(keyword.toLowerCase()),
    )
  ) {
    return "expand";
  }

  if (
    slot.key === "delivery_mode" &&
    optionValues.has("one_to_one") &&
    STRICT_REPLICATION_KEYWORDS.some((keyword) =>
      searchableText.includes(keyword.toLowerCase()),
    )
  ) {
    return "one_to_one";
  }

  if (
    slot.key === "script_mode" &&
    optionValues.has("replicate") &&
    STRICT_REPLICATION_KEYWORDS.some((keyword) =>
      searchableText.includes(keyword.toLowerCase()),
    )
  ) {
    return "replicate";
  }

  return "";
}

function buildMustKeepValue(creationReplay: CreationReplayMetadata): string {
  if (creationReplay.kind === "skill_scaffold") {
    return joinMultilineItems([
      creationReplay.data.source_excerpt
        ? `延续原结果重点：${creationReplay.data.source_excerpt}`
        : null,
      creationReplay.data.outputs?.length
        ? `保留交付骨架：${creationReplay.data.outputs.join("；")}`
        : null,
      creationReplay.data.inputs?.length
        ? `参考原始输入约束：${creationReplay.data.inputs.join("；")}`
        : null,
    ]);
  }

  return joinMultilineItems([
    creationReplay.data.title ? `保留主题：${creationReplay.data.title}` : null,
    creationReplay.data.summary
      ? `保留核心判断：${creationReplay.data.summary}`
      : null,
    creationReplay.data.tags?.length
      ? `沿用标签：${creationReplay.data.tags.join("、")}`
      : null,
  ]);
}

function buildFocusChangesValue(
  creationReplay: CreationReplayMetadata,
): string {
  if (creationReplay.kind === "skill_scaffold") {
    return joinMultilineItems([
      creationReplay.data.steps?.length
        ? `继续沿用步骤：${creationReplay.data.steps.join("；")}`
        : null,
      creationReplay.data.fallback_strategy?.length
        ? `需要注意回退：${creationReplay.data.fallback_strategy.join("；")}`
        : null,
      creationReplay.data.description
        ? `本次意图重点：${creationReplay.data.description}`
        : null,
    ]);
  }

  return joinMultilineItems([
    creationReplay.data.summary
      ? `围绕这条灵感继续展开：${creationReplay.data.summary}`
      : null,
    creationReplay.data.content_excerpt
      ? `结合原始补充线索：${creationReplay.data.content_excerpt}`
      : null,
  ]);
}

function buildVoiceStyleValue(creationReplay: CreationReplayMetadata): string {
  if (creationReplay.kind !== "memory_entry") {
    return "";
  }
  if (
    creationReplay.data.category !== "identity" &&
    creationReplay.data.category !== "preference"
  ) {
    return "";
  }

  return truncate(
    joinInlineItems(
      [creationReplay.data.title, creationReplay.data.summary],
      2,
      120,
    ),
    120,
  );
}

function buildTargetLanguageValue(
  creationReplay: CreationReplayMetadata,
): string {
  return findFirstKeywordValue(
    collectReplaySearchableText(creationReplay),
    LANGUAGE_MATCHERS,
  );
}

function buildSubtitlePreferenceValue(
  creationReplay: CreationReplayMetadata,
): string {
  const searchableText =
    collectReplaySearchableText(creationReplay).toLowerCase();
  if (!searchableText) {
    return "";
  }

  if (
    searchableText.includes("双语字幕") ||
    searchableText.includes("中英双语") ||
    searchableText.includes("双语")
  ) {
    return "bilingual";
  }
  if (
    searchableText.includes("只做配音稿") ||
    searchableText.includes("只要配音稿") ||
    searchableText.includes("不要字幕") ||
    searchableText.includes("仅配音")
  ) {
    return "dub_only";
  }
  if (
    searchableText.includes("保留原字幕") ||
    searchableText.includes("保留字幕")
  ) {
    return "keep_original";
  }

  return "";
}

function buildIndustryKeywordsValue(
  creationReplay: CreationReplayMetadata,
): string {
  if (creationReplay.kind === "memory_entry") {
    return joinInlineItems(
      [...(creationReplay.data.tags || []), creationReplay.data.title],
      5,
      120,
    );
  }

  return joinInlineItems(
    [creationReplay.data.name, ...(creationReplay.data.outputs || [])],
    4,
    120,
  );
}

function buildTargetDurationValue(
  creationReplay: CreationReplayMetadata,
): string {
  return findFirstPatternValue(
    collectReplaySearchableText(creationReplay),
    DURATION_PATTERNS,
  );
}

function buildTimeWindowValue(creationReplay: CreationReplayMetadata): string {
  return findFirstPatternValue(
    collectReplaySearchableText(creationReplay),
    TIME_WINDOW_PATTERNS,
  );
}

function buildRegionValue(creationReplay: CreationReplayMetadata): string {
  return findFirstKeywordValue(
    collectReplaySearchableText(creationReplay),
    REGION_MATCHERS,
  );
}

function buildScheduleValue(creationReplay: CreationReplayMetadata): string {
  return findFirstPatternValue(
    collectReplaySearchableText(creationReplay),
    SCHEDULE_PATTERNS,
  );
}

function buildAccountListValue(creationReplay: CreationReplayMetadata): string {
  const matches = collectReplaySearchableText(creationReplay).match(
    /@[a-zA-Z0-9._-]{2,32}/g,
  );
  if (!matches || matches.length === 0) {
    return "";
  }

  return joinMultilineItems(matches, 5, 160);
}

function buildAlertThresholdValue(
  creationReplay: CreationReplayMetadata,
): string {
  const sentences = collectReplaySearchableText(creationReplay)
    .split(/[。！？\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const matched = sentence.match(
      /(?:低于|高于|下降|下滑|上涨|提升|跌破|超过)[^。！？\n]*?\d+(?:\.\d+)?%[^。！？\n]*/i,
    );
    if (!matched?.index && matched?.index !== 0) {
      continue;
    }

    const prefix = sentence.slice(0, matched.index);
    const separatorIndex = Math.max(
      prefix.lastIndexOf("，"),
      prefix.lastIndexOf(","),
      prefix.lastIndexOf("；"),
      prefix.lastIndexOf(";"),
      prefix.lastIndexOf("、"),
    );
    const startIndex = separatorIndex >= 0 ? separatorIndex + 1 : matched.index;
    return normalizeWhitespace(sentence.slice(startIndex));
  }

  return "";
}

function resolvePrefillValue(
  slot: ServiceSkillSlotDefinition,
  creationReplay: CreationReplayMetadata,
): string {
  switch (slot.key) {
    case "article_url":
    case "reference_video":
    case "video_source":
      return resolveUrlValue(slot, creationReplay);
    case "reference_post":
    case "article_source":
      return buildSourceMaterialValue(slot, creationReplay);
    case "delivery_mode":
    case "script_mode":
      return resolveReplicationModeValue(slot, creationReplay);
    case "platform":
      return resolvePlatformValue(slot, creationReplay);
    case "must_keep":
      return buildMustKeepValue(creationReplay);
    case "focus_changes":
      return buildFocusChangesValue(creationReplay);
    case "voice_style":
      return buildVoiceStyleValue(creationReplay);
    case "target_language":
      return buildTargetLanguageValue(creationReplay);
    case "subtitle_preference":
      return buildSubtitlePreferenceValue(creationReplay);
    case "industry_keywords":
      return buildIndustryKeywordsValue(creationReplay);
    case "target_duration":
      return buildTargetDurationValue(creationReplay);
    case "time_window":
      return buildTimeWindowValue(creationReplay);
    case "region":
      return buildRegionValue(creationReplay);
    case "schedule_time":
    case "report_cadence":
      return buildScheduleValue(creationReplay);
    case "account_list":
      return buildAccountListValue(creationReplay);
    case "alert_threshold":
      return buildAlertThresholdValue(creationReplay);
    default:
      return "";
  }
}

function shouldApplyPrefillValue(
  slot: ServiceSkillSlotDefinition,
  value: string,
): boolean {
  const normalizedValue = normalizeOptionalText(value);
  if (!normalizedValue) {
    return false;
  }

  return normalizedValue !== normalizeOptionalText(slot.defaultValue);
}

export function buildCreationReplaySlotPrefill(
  skill: ServiceSkillHomeItem,
  creationReplay?: CreationReplayMetadata,
): CreationReplaySlotPrefillResult | null {
  if (!creationReplay) {
    return null;
  }

  const slotValues: ServiceSkillSlotValues = {};
  const fieldLabels: string[] = [];

  for (const slot of skill.slotSchema) {
    const nextValue = resolvePrefillValue(slot, creationReplay);
    if (!shouldApplyPrefillValue(slot, nextValue)) {
      continue;
    }

    slotValues[slot.key] = nextValue;
    fieldLabels.push(slot.label);
  }

  if (fieldLabels.length === 0) {
    return null;
  }

  return {
    slotValues,
    fieldLabels,
    hint: buildPrefillHint(creationReplay, fieldLabels),
  };
}
