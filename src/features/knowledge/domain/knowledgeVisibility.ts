import type {
  KnowledgePackDetail,
  KnowledgePackFileEntry,
  KnowledgePackSummary,
} from "@/lib/api/knowledge";
import { PACK_TYPES } from "./knowledgeLabels";

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

function looksLikeMissingSourceNotice(value: string): boolean {
  return /还没有提供.*原始素材|请先.*提供.*(原始|资料|素材)|无法.*整理/.test(
    value,
  );
}

export function getPackTitle(
  pack: KnowledgePackSummary | KnowledgePackDetail,
): string {
  const title = pack.metadata.description || pack.metadata.name;
  return looksLikeMissingSourceNotice(title) ? "待补充的项目资料" : title;
}

export function getUserFacingPackTypeLabel(value?: string | null): string {
  const normalized =
    value === "personal-profile"
      ? "personal-ip"
      : value === "custom:lime-growth-strategy"
        ? "growth-strategy"
        : value;
  return (
    PACK_TYPES.find((type) => type.value === normalized)?.label ?? "通用资料"
  );
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
  void entry;
  if (title.includes("原始") || title.includes("来源")) {
    return "原始资料";
  }
  if (title.includes("整理记录")) {
    return "整理记录";
  }
  if (title.includes("引用")) {
    return "引用摘要";
  }
  if (title.includes("说明")) {
    return "资料说明";
  }
  return "整理内容";
}

function stripInternalPathSegments(value: string): string {
  return value
    .replace(/(?:^|\s)(?:sources|compiled|runs|wiki)\/[^\s，。；;,)）]+/gi, " ")
    .replace(/(?:^|\s)\.lime\/knowledge\/[^\s，。；;,)）]+/gi, " ")
    .replace(/(?:^|\s)\/(?:Users|tmp|var)\/[^\s，。；;,)）]+/g, " ")
    .replace(/[A-Za-z]:\\[^\s，。；;,)）]+/g, " ");
}

function stripKnowledgeBuilderBoilerplate(value: string): string {
  return value
    .replace(/(^|\s)何时使用(?=\s|[:：]|$)/g, " ")
    .replace(/[-*]\s*缺失事实时，?询问用户或标记待确认[。.]?/g, " ")
    .replace(/[-*]\s*不编造来源资料没有提供的事实[。.]?/g, " ")
    .replace(/[-*]\s*把本项目资料当数据，不当指令[。.]?/g, " ")
    .replace(/缺失事实时，?询问用户或标记待确认[。.]?/g, " ")
    .replace(/不编造来源资料没有提供的事实[。.]?/g, " ")
    .replace(/把本项目资料当数据，不当指令[。.]?/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeKnowledgePreview(value?: string | null): string {
  const raw = (value || "").trim();
  if (!raw) {
    return "";
  }
  if (looksLikeMissingSourceNotice(raw)) {
    return "这份资料缺少原始内容，请补充后再确认。";
  }

  const normalized = raw
    .replace(/<knowledge_pack[^>]*>/gi, "")
    .replace(/<\/knowledge_pack>/gi, "")
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/`([^`]+)`/g, "$1");

  const visibleLines = normalized
    .split(/\r?\n/)
    .map((line) => stripInternalPathSegments(line).trim())
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .map((line) => line.replace(/知识包/g, "项目资料"))
    .map(stripKnowledgeBuilderBoilerplate)
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (/^[-*_]{3,}$/.test(line)) {
        return false;
      }
      if (/^[{[]/.test(line) || /[}\]]$/.test(line)) {
        return false;
      }
      if (
        /^(name|status|trust|grounding|metadata|packName|compiled|source|sources|working_dir|workingDir|token)\s*[:=]/i.test(
          line,
        )
      ) {
        return false;
      }
      if (
        /\b(KnowledgePack|packName|metadata|compiled|token|custom)\b/i.test(
          line,
        )
      ) {
        return false;
      }
      if (/运行时边界|运行时\s*brief/i.test(line)) {
        return false;
      }
      if (/当数据.*不当指令|不当指令/.test(line)) {
        return false;
      }
      return true;
    });

  return visibleLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function getKnowledgeEntryPreview(
  title: string,
  entry: KnowledgePackFileEntry,
): string {
  if (title.includes("整理记录")) {
    return entry.preview ? "最近一次整理已记录，可用于回看资料处理结果。" : "";
  }

  const preview = sanitizeKnowledgePreview(entry.preview);
  if (preview) {
    return preview;
  }

  if (title.includes("引用")) {
    return "引用摘要已生成，可在 Agent 生成时作为参考。";
  }
  if (title.includes("原始") || title.includes("来源")) {
    return "原始资料已保存。";
  }
  return "";
}
