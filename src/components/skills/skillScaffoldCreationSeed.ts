import type { SkillScaffoldDraft } from "@/types/page";

interface SkillScaffoldCreationSeed {
  initialUserPrompt: string;
  entryBannerMessage: string;
}

const DEFAULT_SKILL_NAME = "结果复用技能";

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function normalizeOptionalSnippet(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = normalizeInlineText(value || "");
  if (!normalized) {
    return undefined;
  }

  return truncateText(normalized, maxLength);
}

function normalizeStructuredItems(
  value: string[] | undefined,
  maxItems = 4,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeInlineText(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function buildSection(title: string, items: string[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return [`${title}：`, ...items.map((item, index) => `${index + 1}. ${item}`)].join(
    "\n",
  );
}

export function buildSkillScaffoldCreationSeed(
  draft: SkillScaffoldDraft,
): SkillScaffoldCreationSeed {
  const name =
    normalizeOptionalSnippet(draft.name, 80) || DEFAULT_SKILL_NAME;
  const description = normalizeOptionalSnippet(draft.description, 160);
  const sourceExcerpt = normalizeOptionalSnippet(draft.sourceExcerpt, 180);
  const whenToUse = normalizeStructuredItems(draft.whenToUse);
  const inputs = normalizeStructuredItems(draft.inputs);
  const outputs = normalizeStructuredItems(draft.outputs);
  const steps = normalizeStructuredItems(draft.steps);
  const fallbackStrategy = normalizeStructuredItems(draft.fallbackStrategy);

  return {
    initialUserPrompt: [
      "请基于下面这份技能草稿继续开工。先整理成可编辑的输入骨架，再继续执行。",
      `技能名称：${name}`,
      description ? `技能定位：${description}` : undefined,
      sourceExcerpt ? `来源结果：${sourceExcerpt}` : undefined,
      buildSection("适用场景", whenToUse),
      buildSection("输入约束", inputs),
      buildSection("期望输出", outputs),
      buildSection("执行步骤", steps),
      buildSection("失败回退", fallbackStrategy),
    ]
      .filter(Boolean)
      .join("\n\n"),
    entryBannerMessage: `已从技能草稿“${name}”带回创作输入，可继续改写后发送。`,
  };
}
