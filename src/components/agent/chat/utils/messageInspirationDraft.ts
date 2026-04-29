import type {
  CreateUnifiedMemoryRequest,
  MemoryCategory,
} from "@/lib/api/unifiedMemory";
import type { MemoryPageSection } from "@/types/page";
import type { CreationReplayMetadata } from "./creationReplayMetadata";

interface MessageInspirationDraftSource {
  messageId: string;
  content: string;
  sessionId?: string | null;
}

interface MessageInspirationDraft {
  category: MemoryCategory;
  categoryLabel: string;
  section: MemoryPageSection;
  title: string;
  request: CreateUnifiedMemoryRequest;
}

const DEFAULT_TITLE_BY_CATEGORY: Record<MemoryCategory, string> = {
  identity: "风格灵感",
  context: "参考灵感",
  preference: "偏好灵感",
  experience: "成果沉淀",
  activity: "收藏灵感",
};

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  identity: "风格",
  context: "参考",
  preference: "偏好",
  experience: "成果",
  activity: "收藏",
};

const CATEGORY_KEYWORDS: Array<{
  category: MemoryCategory;
  keywords: string[];
}> = [
  {
    category: "identity",
    keywords: ["风格", "语气", "口吻", "审美", "画风", "氛围", "调性"],
  },
  {
    category: "preference",
    keywords: ["偏好", "习惯", "喜欢", "倾向", "口味", "常用"],
  },
  {
    category: "experience",
    keywords: ["复盘", "经验", "方法", "做法", "模板", "流程", "步骤", "清单"],
  },
  {
    category: "activity",
    keywords: ["收藏", "待看", "备选", "灵感", "稍后", "候选"],
  },
  {
    category: "context",
    keywords: ["参考", "资料", "案例", "背景", "来源", "链接"],
  },
];

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMeaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function getMeaningfulSentences(text: string): string[] {
  return text
    .split(/[。！？!?；;]+/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length >= 6);
}

function inferCategory(text: string): MemoryCategory {
  const normalized = text.toLowerCase();

  const matched = CATEGORY_KEYWORDS.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword)),
  );

  return matched?.category ?? "experience";
}

function resolveTitle(text: string, category: MemoryCategory): string {
  const lines = getMeaningfulLines(text);
  const sentences = getMeaningfulSentences(text);
  const titleCandidate =
    lines[0] || sentences[0] || DEFAULT_TITLE_BY_CATEGORY[category];

  return truncate(titleCandidate, 28);
}

function resolveSummary(text: string, title: string): string {
  const sentences = getMeaningfulSentences(text);
  const lines = getMeaningfulLines(text);
  const titlePrefix = normalizeWhitespace(title);
  const titlePrefixPattern = new RegExp(
    `^${escapeRegExp(titlePrefix)}(?:\\s+|[:：-]+\\s*)?`,
  );
  const stripLeadingTitle = (candidate: string): string =>
    normalizeWhitespace(candidate).replace(titlePrefixPattern, "").trim();
  const summaryCandidate =
    [...sentences, ...lines]
      .map((candidate) => stripLeadingTitle(candidate))
      .find(Boolean) || title;

  return truncate(summaryCandidate, 140);
}

function extractTags(text: string): string[] {
  const tagLine = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find((line) => /^标签[:：]/.test(line));

  if (!tagLine) {
    return [];
  }

  return tagLine
    .replace(/^标签[:：]/, "")
    .split(/[，,、/|]/)
    .map((tag) => normalizeWhitespace(tag))
    .filter(Boolean)
    .slice(0, 6);
}

export function buildMessageInspirationDraft(
  source: MessageInspirationDraftSource,
  options: {
    creationReplay?: CreationReplayMetadata;
  } = {},
): MessageInspirationDraft | null {
  const strippedContent = stripMarkdownSyntax(source.content || "");
  const normalizedContent = normalizeWhitespace(strippedContent);

  if (!normalizedContent) {
    return null;
  }

  const replayCategory =
    options.creationReplay?.kind === "memory_entry"
      ? options.creationReplay.data.category
      : undefined;
  const category = replayCategory || inferCategory(normalizedContent);
  const title = resolveTitle(strippedContent, category);
  const summary = resolveSummary(strippedContent, title);
  const replayTags =
    options.creationReplay?.kind === "memory_entry"
      ? options.creationReplay.data.tags || []
      : [];
  const tags = [...replayTags, ...extractTags(strippedContent)].filter(
    (tag, index, list) =>
      list.findIndex(
        (current) => normalizeWhitespace(current) === normalizeWhitespace(tag),
      ) === index,
  );

  return {
    category,
    categoryLabel: CATEGORY_LABELS[category],
    section: category,
    title,
    request: {
      session_id: source.sessionId?.trim() || source.messageId,
      title,
      content: truncate(normalizedContent, 4000),
      summary,
      category,
      tags,
      confidence: 0.86,
      importance: 7,
    },
  };
}
