import type { MemoryCategory } from "@/lib/api/unifiedMemory";

export interface MemoryEntryCreationSeedInput {
  category: MemoryCategory;
  title: string;
  summary: string;
  content: string;
  tags: string[];
}

interface MemoryEntryCreationSeed {
  initialUserPrompt: string;
  entryBannerMessage: string;
}

const CATEGORY_COPY: Record<
  MemoryCategory,
  {
    label: string;
    instruction: string;
  }
> = {
  identity: {
    label: "风格",
    instruction: "请参考下面这条风格灵感继续创作。",
  },
  context: {
    label: "参考",
    instruction: "请把下面这条参考灵感带回当前创作。",
  },
  preference: {
    label: "偏好",
    instruction: "请沿用下面这条偏好线索继续创作。",
  },
  experience: {
    label: "成果",
    instruction: "请复用下面这条已验证成果继续创作。",
  },
  activity: {
    label: "收藏",
    instruction: "请围绕下面这条收藏灵感继续创作。",
  },
};

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
  value: string,
  maxLength: number,
): string | undefined {
  const normalized = normalizeInlineText(value);
  if (!normalized) {
    return undefined;
  }

  return truncateText(normalized, maxLength);
}

export function buildMemoryEntryCreationSeed(
  entry: MemoryEntryCreationSeedInput,
): MemoryEntryCreationSeed {
  const categoryCopy = CATEGORY_COPY[entry.category];
  const title = normalizeOptionalSnippet(entry.title, 80) || categoryCopy.label;
  const summary =
    normalizeOptionalSnippet(entry.summary, 160) ||
    normalizeOptionalSnippet(entry.content, 160) ||
    title;
  const rawContent = normalizeOptionalSnippet(entry.content, 220);
  const detail = rawContent && rawContent !== summary ? rawContent : undefined;
  const tags = entry.tags
    .map((tag) => normalizeInlineText(tag))
    .filter(Boolean)
    .slice(0, 6)
    .join("、");

  return {
    initialUserPrompt: [
      `${categoryCopy.instruction}先整理成可编辑的输入骨架，再继续执行。`,
      `灵感标题：${title}`,
      summary ? `灵感摘要：${summary}` : undefined,
      detail ? `补充线索：${detail}` : undefined,
      tags ? `标签：${tags}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    entryBannerMessage: `已从灵感库带入“${categoryCopy.label}”条目，可继续改写后发送。`,
  };
}
