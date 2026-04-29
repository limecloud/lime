import type { MemoryCategory, UnifiedMemory } from "@/lib/api/unifiedMemory";

export type InspirationProjectionKind =
  | "style"
  | "reference"
  | "preference"
  | "outcome"
  | "collection";

export interface InspirationProjectionMeta {
  label: string;
  description: string;
}

export interface InspirationProjectionEntryViewModel {
  id: string;
  title: string;
  summary: string;
  contentPreview: string;
  category: MemoryCategory;
  categoryLabel: string;
  projectionKind: InspirationProjectionKind;
  projectionLabel: string;
  tags: string[];
  updatedAt: number;
}

export interface InspirationTasteSummaryViewModel {
  summary: string;
  styleKeywords: string[];
  referenceKeywords: string[];
  avoidKeywords: string[];
}

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
};

const CATEGORY_TO_PROJECTION_KIND: Record<
  MemoryCategory,
  InspirationProjectionKind
> = {
  identity: "style",
  context: "reference",
  preference: "preference",
  experience: "outcome",
  activity: "collection",
};

export const INSPIRATION_PROJECTION_META: Record<
  InspirationProjectionKind,
  InspirationProjectionMeta
> = {
  style: {
    label: "风格线索",
    description: "帮助系统理解你想保留的语气、审美和表达方式。",
  },
  reference: {
    label: "参考素材",
    description: "明确这次创作要带上的案例、资料和外部链接。",
  },
  preference: {
    label: "偏好约束",
    description: "沉淀你反复强调的取舍、禁忌和执行偏好。",
  },
  outcome: {
    label: "成果打法",
    description: "保留下次还想直接复用的结果结构和方法。",
  },
  collection: {
    label: "收藏备选",
    description: "暂时先留存，等待进入后续创作或筛选流程。",
  },
};

function normalizeWhitespace(value?: string | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function uniqueItems(
  items: Array<string | null | undefined>,
  maxItems: number,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = normalizeWhitespace(item);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

function extractAvoidKeywords(value: string): string[] {
  const result: string[] = [];
  const pattern =
    /(?:避免|不要|别|禁用|禁忌)(?:使用|做)?[:：]?\s*([^\n，。；;]{2,18})/g;

  for (const match of value.matchAll(pattern)) {
    result.push(normalizeWhitespace(match[1]));
  }

  return uniqueItems(result, 4);
}

export function buildInspirationProjectionEntries(
  memories: UnifiedMemory[],
): InspirationProjectionEntryViewModel[] {
  return [...memories]
    .sort((left, right) => right.updated_at - left.updated_at)
    .map((memory) => {
      const projectionKind = CATEGORY_TO_PROJECTION_KIND[memory.category];
      const projectionMeta = INSPIRATION_PROJECTION_META[projectionKind];
      const normalizedSummary = normalizeWhitespace(memory.summary);
      const normalizedContent = normalizeWhitespace(memory.content);

      return {
        id: memory.id,
        title: normalizeWhitespace(memory.title) || "未命名灵感",
        summary:
          normalizedSummary ||
          truncate(normalizedContent || "等待补充摘要", 96),
        contentPreview: truncate(normalizedContent || normalizedSummary, 120),
        category: memory.category,
        categoryLabel: CATEGORY_LABELS[memory.category],
        projectionKind,
        projectionLabel: projectionMeta.label,
        tags: uniqueItems(memory.tags, 6),
        updatedAt: memory.updated_at,
      };
    });
}

export function buildInspirationTasteSummary(
  entries: InspirationProjectionEntryViewModel[],
): InspirationTasteSummaryViewModel {
  const styleEntries = entries.filter(
    (entry) =>
      entry.projectionKind === "style" || entry.projectionKind === "preference",
  );
  const referenceEntries = entries.filter(
    (entry) => entry.projectionKind === "reference",
  );

  const styleKeywords = uniqueItems(
    [
      ...styleEntries.flatMap((entry) => entry.tags),
      ...styleEntries.map((entry) => entry.title),
    ],
    8,
  );
  const referenceKeywords = uniqueItems(
    [
      ...referenceEntries.flatMap((entry) => entry.tags),
      ...referenceEntries.map((entry) => entry.title),
    ],
    6,
  );
  const avoidKeywords = uniqueItems(
    styleEntries.flatMap((entry) =>
      extractAvoidKeywords(`${entry.summary}\n${entry.contentPreview}`),
    ),
    4,
  );

  const summary =
    styleEntries.length > 0 || referenceEntries.length > 0
      ? `当前已从 ${styleEntries.length} 条风格/偏好线索和 ${referenceEntries.length} 条参考素材里，整理出可复用的 taste 摘要。`
      : "当前还没有足够的灵感条目可提炼风格层摘要。";

  return {
    summary,
    styleKeywords,
    referenceKeywords,
    avoidKeywords,
  };
}

export function buildScenePrefillFromInspiration(
  entry: Pick<
    InspirationProjectionEntryViewModel,
    "categoryLabel" | "summary" | "tags" | "title"
  >,
): string {
  return [
    `围绕这条${entry.categoryLabel}灵感继续创作：${entry.title}`,
    entry.summary ? `保留关键感觉：${entry.summary}` : null,
    entry.tags.length > 0
      ? `参考标签：${entry.tags.slice(0, 4).join("、")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}
