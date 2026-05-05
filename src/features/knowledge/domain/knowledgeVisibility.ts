import type {
  KnowledgePackDetail,
  KnowledgePackFileEntry,
  KnowledgePackSummary,
} from "@/lib/api/knowledge";

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

export function formatCount(value: number, unit: string): string {
  return `${value.toLocaleString("zh-CN")} ${unit}`;
}

export function normalizePackNameInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function formatPathPreview(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "未选择项目";
  }

  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }

  return `.../${segments.slice(-2).join("/")}`;
}

export function getPackTitle(
  pack: KnowledgePackSummary | KnowledgePackDetail,
): string {
  return pack.metadata.description || pack.metadata.name;
}

export function buildPackMetrics(pack: KnowledgePackSummary | KnowledgePackDetail) {
  return [
    { label: "原始资料", value: pack.sourceCount, caption: "已导入" },
    { label: "整理内容", value: pack.wikiCount, caption: "已生成" },
    { label: "引用摘要", value: pack.compiledCount, caption: "可用于生成" },
    { label: "整理记录", value: pack.runCount, caption: "最近处理" },
  ];
}

export function buildEntryDisplayLabel(
  title: string,
  entry: KnowledgePackFileEntry,
) {
  const basename = entry.relativePath.split("/").filter(Boolean).pop();
  if (title.includes("原始") || title.includes("来源")) {
    return basename || "资料";
  }
  if (title.includes("整理记录")) {
    return "整理记录";
  }
  if (title.includes("引用")) {
    return "引用摘要";
  }
  return basename?.replace(/\.(md|txt|json)$/i, "") || "内容";
}
