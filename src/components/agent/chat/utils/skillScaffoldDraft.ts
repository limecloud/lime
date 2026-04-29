import type { SkillScaffoldDraft, SkillsPageParams } from "@/types/page";
import type { CreationReplayMetadata } from "./creationReplayMetadata";

interface SkillScaffoldDraftSource {
  messageId: string;
  content: string;
}

interface BuildSkillsPageParamsFromMessageOptions {
  creationProjectId?: string | null;
  creationReplay?: CreationReplayMetadata;
}

const DEFAULT_SKILL_NAME = "结果复用技能";
const DEFAULT_DIRECTORY_PREFIX = "saved-skill";
const DEFAULT_DESCRIPTION = "沉淀自一次成功结果，便于后续复用。";
const MEMORY_CATEGORY_LABELS = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
} as const;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownSyntax(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trim()}...`;
}

function getMeaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(stripMarkdownSyntax(line)))
    .filter(Boolean);
}

function getMeaningfulSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;]+/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length >= 6);
}

function buildStructuredItems(
  ...items: Array<string | null | undefined>
): string[] {
  return items.map((item) => normalizeWhitespace(item || "")).filter(Boolean);
}

function dedupeStructuredItems(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeWhitespace(item).toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeStructuredItems(
  primary: string[] | undefined,
  secondary: string[] | undefined,
): string[] {
  return dedupeStructuredItems([...(primary || []), ...(secondary || [])]);
}

function buildDirectorySlug(seed: string, messageId: string): string {
  const asciiSeed = seed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const normalizedMessageId = messageId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-6);
  const suffix = normalizedMessageId || "draft";

  if (asciiSeed) {
    return `${asciiSeed}-${suffix}`.slice(0, 48);
  }

  return `${DEFAULT_DIRECTORY_PREFIX}-${suffix}`;
}

function resolveSkillName(text: string): string {
  const lines = getMeaningfulLines(text);

  if (lines.length === 0) {
    return DEFAULT_SKILL_NAME;
  }

  return truncate(lines[0] || DEFAULT_SKILL_NAME, 24);
}

function resolveFocusSnippet(text: string, sourceExcerpt: string): string {
  const lines = getMeaningfulLines(text);
  if (lines.length > 1 && (lines[0]?.length || 0) <= 24) {
    return truncate(lines[1] || sourceExcerpt, 52);
  }

  const sentences = getMeaningfulSentences(text);
  if (sentences.length > 0) {
    return truncate(sentences[0] || sourceExcerpt, 52);
  }

  if (lines.length > 1) {
    return truncate(lines[1] || sourceExcerpt, 52);
  }

  return truncate(sourceExcerpt, 52);
}

function buildWhenToUseItems(name: string, focusSnippet: string): string[] {
  return buildStructuredItems(
    `当你需要继续产出“${name}”这类结果时使用。`,
    focusSnippet
      ? `适合继续沿用这次围绕“${focusSnippet}”的结构、判断方式和交付颗粒度。`
      : "适合把一次成功结果沉淀成可重复使用的固定工作流。",
  );
}

function buildInputItems(focusSnippet: string): string[] {
  return buildStructuredItems(
    focusSnippet ? `目标与主题：${focusSnippet}` : null,
    "补充受众、风格、篇幅、平台或输出格式等关键约束。",
    "如有历史版本、参考资料、示例或素材，可一并提供。",
  );
}

function buildOutputItems(name: string, focusSnippet: string): string[] {
  return buildStructuredItems(
    `交付一份与“${name}”同类型、可直接使用的完整结果。`,
    focusSnippet
      ? `输出需要覆盖“${focusSnippet}”对应的关键信息，并保持结构清晰。`
      : "输出应保留结构层级、重点信息和可执行细节。",
    "必要时附带简短说明，便于继续复用或二次迭代。",
  );
}

function buildStepItems(focusSnippet: string): string[] {
  return buildStructuredItems(
    focusSnippet
      ? `先确认本次任务是否仍围绕：${focusSnippet}`
      : "先确认目标、边界和交付格式。",
    "提炼这次成功结果里的结构骨架，再决定哪些部分需要沿用或改写。",
    "按相同颗粒度补齐关键信息与执行细节，输出可直接交付的结果。",
  );
}

function buildFallbackStrategyItems(): string[] {
  return buildStructuredItems(
    "如果用户目标或素材不足，先补问最关键的主题、受众或平台约束。",
    "如果原结果不适合直接复用，先提炼最小骨架，再给出可继续迭代的首版。",
    "如果信息仍然缺失，明确标注待补内容，不要假设不存在的事实。",
  );
}

function applyCreationReplayToDraft(
  draft: SkillScaffoldDraft,
  creationReplay?: CreationReplayMetadata,
): SkillScaffoldDraft {
  if (!creationReplay) {
    return draft;
  }

  if (creationReplay.kind === "skill_scaffold") {
    return {
      ...draft,
      target:
        (creationReplay.data.target as SkillScaffoldDraft["target"]) ||
        draft.target,
      directory: creationReplay.data.directory || draft.directory,
      name:
        draft.name === DEFAULT_SKILL_NAME && creationReplay.data.name
          ? creationReplay.data.name
          : draft.name,
      whenToUse: mergeStructuredItems(
        creationReplay.data.when_to_use,
        draft.whenToUse,
      ),
      inputs: mergeStructuredItems(creationReplay.data.inputs, draft.inputs),
      outputs: mergeStructuredItems(creationReplay.data.outputs, draft.outputs),
      steps: mergeStructuredItems(creationReplay.data.steps, draft.steps),
      fallbackStrategy: mergeStructuredItems(
        creationReplay.data.fallback_strategy,
        draft.fallbackStrategy,
      ),
    };
  }

  const categoryLabel = MEMORY_CATEGORY_LABELS[creationReplay.data.category];
  const memoryTitle = creationReplay.data.title?.trim();
  const memorySummary = creationReplay.data.summary?.trim();
  const memoryTags = (creationReplay.data.tags || []).join("、");

  return {
    ...draft,
    description:
      memoryTitle || memorySummary
        ? buildStructuredItems(
            memoryTitle
              ? `沉淀自一次继续复用“${memoryTitle}”灵感后的成功结果。`
              : null,
            memorySummary,
          ).join(" ")
        : draft.description,
    whenToUse: mergeStructuredItems(
      buildStructuredItems(
        memoryTitle
          ? `适合继续围绕灵感库中的“${memoryTitle}”这条${categoryLabel}线索扩展成完整工作流。`
          : `适合继续把灵感库里的${categoryLabel}线索扩展成稳定可复用的结果。`,
      ),
      draft.whenToUse,
    ),
    inputs: mergeStructuredItems(
      buildStructuredItems(
        memoryTitle ? `参考灵感：${memoryTitle}` : null,
        memorySummary ? `灵感摘要：${memorySummary}` : null,
        memoryTags ? `参考标签：${memoryTags}` : null,
      ),
      draft.inputs,
    ),
  };
}

export function buildSkillsPageParamsFromMessage(
  source: SkillScaffoldDraftSource,
  options: BuildSkillsPageParamsFromMessageOptions = {},
): SkillsPageParams | null {
  const strippedContent = stripMarkdownSyntax(source.content || "");
  const normalizedContent = normalizeWhitespace(strippedContent);

  if (!normalizedContent) {
    return null;
  }

  const name = resolveSkillName(strippedContent);
  const sourceExcerpt = truncate(normalizedContent, 72);
  const focusSnippet = resolveFocusSnippet(strippedContent, sourceExcerpt);
  const initialScaffoldDraft = applyCreationReplayToDraft(
    {
      target: "project",
      directory: buildDirectorySlug(name, source.messageId),
      name,
      description: sourceExcerpt
        ? `沉淀自一次成功结果：${sourceExcerpt}`
        : DEFAULT_DESCRIPTION,
      whenToUse: buildWhenToUseItems(name, focusSnippet),
      inputs: buildInputItems(focusSnippet),
      outputs: buildOutputItems(name, focusSnippet),
      steps: buildStepItems(focusSnippet),
      fallbackStrategy: buildFallbackStrategyItems(),
      sourceMessageId: source.messageId,
      sourceExcerpt,
    },
    options.creationReplay,
  );

  return {
    ...(options.creationProjectId?.trim()
      ? { creationProjectId: options.creationProjectId.trim() }
      : {}),
    initialScaffoldDraft,
    initialScaffoldRequestKey: Date.now(),
  };
}
