import {
  Database,
  File,
  FileArchive,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Music,
  Video,
} from "lucide-react";
import type {
  ResourceManagerItem,
  ResourceManagerKind,
  ResourceManagerSourceContext,
} from "./types";
import { getResourceFormatLabel } from "./resourceFormatCatalog";

export type ResourceManagerKindFilter = ResourceManagerKind | "all";

export interface ResourceManagerRow {
  label: string;
  value: string;
}

export const RESOURCE_KIND_FILTERS: ResourceManagerKindFilter[] = [
  "all",
  "image",
  "video",
  "audio",
  "pdf",
  "markdown",
  "text",
  "office",
  "data",
  "archive",
];

export function getItemTitle(item: ResourceManagerItem): string {
  return item.title || item.metadata?.slotLabel?.toString() || "资源预览";
}

export function getItemDescription(item: ResourceManagerItem): string | null {
  return item.description || item.metadata?.prompt?.toString() || null;
}

export function getKindLabel(kind: ResourceManagerKind): string {
  const labelMap: Record<ResourceManagerKind, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    pdf: "PDF",
    text: "文本",
    markdown: "Markdown",
    office: "Office",
    data: "数据",
    archive: "压缩包",
    unknown: "未知",
  };
  return labelMap[kind];
}

export function getKindFilterLabel(kind: ResourceManagerKindFilter): string {
  return kind === "all" ? "全部" : getKindLabel(kind);
}

export function getKindIcon(kind: ResourceManagerKind) {
  const iconMap = {
    image: ImageIcon,
    video: Video,
    audio: Music,
    pdf: FileText,
    text: FileText,
    markdown: FileText,
    office: FileSpreadsheet,
    data: Database,
    archive: FileArchive,
    unknown: FileQuestion,
  } satisfies Record<ResourceManagerKind, typeof File>;
  return iconMap[kind];
}

export function getEffectiveSourceContext(
  item: ResourceManagerItem | null,
  session: { sourceContext?: ResourceManagerSourceContext | null } | null,
): ResourceManagerSourceContext | null {
  return item?.sourceContext ?? session?.sourceContext ?? null;
}

export function hasChatLocationContext(
  context: ResourceManagerSourceContext | null,
): boolean {
  return Boolean(context?.threadId || context?.messageId || context?.taskId);
}

export function hasProjectResourceContext(
  context: ResourceManagerSourceContext | null,
): boolean {
  return Boolean(
    context?.projectId &&
    (context.contentId || context.markdownRelativePath || context.sourcePage),
  );
}

export function getProjectResourceActionLabel(
  context: ResourceManagerSourceContext | null,
): string {
  if (
    context?.kind === "browser_saved_content" ||
    context?.markdownRelativePath
  ) {
    return "打开主稿";
  }
  return "回到项目资料";
}

export function getChatLocationActionLabel(
  context: ResourceManagerSourceContext | null,
): string {
  if (context?.kind === "image_task") {
    return "定位到图片任务";
  }
  return "定位到聊天位置";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

export function buildMetadataChips(item: ResourceManagerItem): string[] {
  const metadata = item.metadata ?? {};
  const size = item.size ?? metadata.size;
  return [
    getResourceFormatLabel(item),
    typeof size === "number" ? formatBytes(size) : size?.toString(),
    item.mimeType || metadata.mimeType?.toString(),
    metadata.providerName?.toString(),
    metadata.modelName?.toString(),
    metadata.width && metadata.height
      ? `${metadata.width}×${metadata.height}`
      : null,
  ].filter((value): value is string => Boolean(value?.trim()));
}

export function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export function itemMatchesResourceSearch(params: {
  item: ResourceManagerItem;
  query: string;
  kindFilter: ResourceManagerKindFilter;
}): boolean {
  if (params.kindFilter !== "all" && params.item.kind !== params.kindFilter) {
    return false;
  }

  if (!params.query) {
    return true;
  }

  const metadata = params.item.metadata ?? {};
  const haystack = [
    params.item.id,
    params.item.title,
    params.item.description,
    params.item.filePath,
    params.item.src,
    params.item.mimeType,
    metadata.prompt,
    metadata.slotLabel,
    metadata.providerName,
    metadata.modelName,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value))
    .join(" ")
    .toLowerCase();

  return haystack.includes(params.query);
}

export function buildSourceContextRows(
  context: ResourceManagerSourceContext | null,
): ResourceManagerRow[] {
  if (!context) {
    return [];
  }

  return [
    { label: "来源类型", value: context.kind },
    { label: "项目", value: context.projectId || "" },
    { label: "内容", value: context.contentId || "" },
    { label: "任务", value: context.taskId || "" },
    { label: "输出", value: context.outputId || "" },
    { label: "会话", value: context.threadId || "" },
    { label: "消息", value: context.messageId || "" },
    { label: "Artifact", value: context.artifactId || "" },
    { label: "相对路径", value: context.markdownRelativePath || "" },
    { label: "资源文件夹", value: context.resourceFolderId || "" },
    { label: "资源分类", value: context.resourceCategory || "" },
    { label: "入口", value: context.sourcePage || "" },
    { label: "原文", value: context.originUrl || "" },
  ].filter((row) => row.value.trim().length > 0);
}

export function buildInspectorRows(
  item: ResourceManagerItem,
): ResourceManagerRow[] {
  const metadata = item.metadata ?? {};
  return [
    { label: "资源 ID", value: item.id },
    { label: "类型", value: getKindLabel(item.kind) },
    { label: "格式", value: getResourceFormatLabel(item) || "" },
    { label: "标题", value: getItemTitle(item) },
    { label: "说明", value: getItemDescription(item) || "" },
    { label: "文件路径", value: item.filePath || "" },
    { label: "预览地址", value: item.src || "" },
    {
      label: "MIME",
      value: item.mimeType || metadata.mimeType?.toString() || "",
    },
    {
      label: "大小",
      value:
        typeof item.size === "number"
          ? formatBytes(item.size)
          : metadata.size?.toString() || "",
    },
    { label: "模型", value: metadata.modelName?.toString() || "" },
    { label: "服务商", value: metadata.providerName?.toString() || "" },
    {
      label: "尺寸",
      value:
        metadata.width && metadata.height
          ? `${metadata.width}×${metadata.height}`
          : "",
    },
  ].filter((row) => row.value.trim().length > 0);
}

export function getShortcutHint(item: ResourceManagerItem): string {
  if (item.kind === "image") {
    return "Esc 关闭 · 方向键切换 · / 搜索 · I 详情 · Ctrl/Cmd+C 复制图片 · +/- 缩放 · R 旋转 · H/V 翻转";
  }
  if (item.kind === "video" || item.kind === "audio") {
    return "Esc 关闭 · 方向键切换 · / 搜索 · I 详情 · D 下载 · O 系统打开 · 原生控件播放";
  }
  if (item.kind === "data") {
    return "Esc 关闭 · 方向键切换 · / 搜索 · I 详情 · Ctrl/Cmd+C 复制数据 · O 系统打开 · L 定位文件";
  }
  if (item.kind === "archive") {
    return "Esc 关闭 · 方向键切换 · / 搜索 · I 详情 · Ctrl/Cmd+C 复制路径 · O 系统打开 · L 定位文件";
  }
  return "Esc 关闭 · 方向键切换 · / 搜索 · I 详情 · Ctrl/Cmd+C 复制路径 · O 系统打开 · L 定位文件";
}
