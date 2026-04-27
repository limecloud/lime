import { ArrowUpRight, FileStack, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  resolveArtifactDocumentCurrentVersion,
  type ArtifactDocumentBlock,
  type ArtifactDocumentKind,
  type ArtifactDocumentStatus,
  type ArtifactDocumentV1,
} from "@/lib/artifact-document";
import {
  resolveArtifactProtocolDocumentPayload,
  resolveArtifactProtocolPreviewText,
} from "@/lib/artifact-protocol";
import type { AgentThreadItem } from "../types";
import {
  resolveTimelineArtifactNavigation,
  type ArtifactTimelineOpenTarget,
} from "../utils/artifactTimelineNavigation";

interface AgentThreadTimelineArtifactCardProps {
  item: Extract<AgentThreadItem, { type: "file_artifact" }>;
  timestamp?: string | null;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenArtifactFromTimeline?: (target: ArtifactTimelineOpenTarget) => void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMetadataText(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const direct = normalizeText(metadata?.[key]);
    if (direct) {
      return direct;
    }
  }
  return undefined;
}

function readMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function resolveFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function truncateMiddle(value: string, maxLength = 72): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const headLength = Math.max(20, Math.ceil((maxLength - 1) * 0.58));
  const tailLength = Math.max(14, maxLength - headLength - 1);
  return `${normalized.slice(0, headLength)}…${normalized.slice(-tailLength)}`;
}

function truncateInlineText(value: string, maxLength = 160): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function resolveArtifactDocumentKindLabel(
  kind?: ArtifactDocumentKind | string,
): string | null {
  switch (kind) {
    case "report":
      return "报告";
    case "roadmap":
      return "路线图";
    case "prd":
      return "PRD";
    case "brief":
      return "简报";
    case "analysis":
      return "分析";
    case "comparison":
      return "对比";
    case "plan":
      return "计划";
    case "table_report":
      return "表格报告";
    default:
      return kind || null;
  }
}

function resolveArtifactDocumentStatusLabel(
  status?: ArtifactDocumentStatus | string,
): string | null {
  switch (status) {
    case "draft":
      return "草稿";
    case "streaming":
      return "生成中";
    case "ready":
      return "可阅读";
    case "failed":
      return "失败";
    case "archived":
      return "已归档";
    default:
      return status || null;
  }
}

function resolveArtifactSourceLabel(source?: string): string | null {
  switch (source) {
    case "artifact_snapshot":
      return "已同步";
    case "artifact_document_service":
      return "文稿服务";
    case "tool_result":
      return "处理结果";
    case "tool_start":
      return "开始处理";
    case "message_content":
      return "消息内容";
    default:
      return source && !source.includes("_") ? source : null;
  }
}

function resolveBlockLabel(
  document: ArtifactDocumentV1 | null,
  blockId: string,
): string {
  const block = document?.blocks.find((entry) => entry.id === blockId);
  if (!block) {
    return blockId;
  }

  const record = block as ArtifactDocumentBlock & Record<string, unknown>;
  const fallbackByType: Record<string, string> = {
    hero_summary: "摘要",
    section_header: "章节",
    rich_text: "正文",
    callout: "提示",
    key_points: "要点",
  };
  const label =
    normalizeText(record.title) ||
    normalizeText(record.summary) ||
    normalizeText(record.description) ||
    normalizeText(record.label) ||
    normalizeText(record.text) ||
    normalizeText(record.markdown);

  return label
    ? truncateInlineText(label, 20)
    : fallbackByType[block.type] || blockId;
}

function resolveFallbackPreview(content: string | undefined): string | null {
  const normalized = normalizeText(content);
  if (!normalized) {
    return null;
  }

  if (/^[[{]/.test(normalized)) {
    return "包含结构化结果，点击在画布中查看完整内容。";
  }

  return truncateInlineText(normalized);
}

function resolveDocumentPreview(
  document: ArtifactDocumentV1 | null,
  displayTitle: string,
): string | null {
  if (!document) {
    return null;
  }

  const preview = normalizeText(resolveArtifactProtocolPreviewText(document));
  if (!preview || preview === displayTitle) {
    return "已同步到工作区，可继续在画布里阅读、编辑和定位到对应区块。";
  }

  return truncateInlineText(preview);
}

export function AgentThreadTimelineArtifactCard({
  item,
  timestamp,
  onFileClick,
  onOpenArtifactFromTimeline,
}: AgentThreadTimelineArtifactCardProps) {
  const metadata = asRecord(item.metadata);
  const navigation = resolveTimelineArtifactNavigation(item);
  const blockTargets = navigation?.blockTargets || [];
  const shouldOpenFocusedBlock =
    Boolean(onOpenArtifactFromTimeline) && blockTargets.length === 1;
  const document = resolveArtifactProtocolDocumentPayload({
    content: item.content,
    metadata,
  });
  const metadataVersion = asRecord(metadata?.artifactVersion);
  const currentVersion = document
    ? resolveArtifactDocumentCurrentVersion(document)
    : null;
  const metadataTitle = readMetadataText(metadata, [
    "artifactTitle",
    "artifact_title",
    "title",
  ]);
  const metadataKind = readMetadataText(metadata, [
    "artifactKind",
    "artifact_kind",
    "kind",
  ]);
  const metadataStatus =
    readMetadataText(metadata, [
      "artifactStatus",
      "artifact_status",
      "status",
    ]) || normalizeText(metadataVersion?.status);
  const metadataVersionNo =
    readMetadataNumber(metadata, [
      "artifactVersionNo",
      "artifact_version_no",
    ]) || readMetadataNumber(metadataVersion, ["versionNo", "version_no"]);
  const metadataPreview = readMetadataText(metadata, [
    "previewText",
    "preview_text",
    "artifactSummary",
    "artifact_summary",
    "summary",
  ]);
  const displayTitle =
    normalizeText(document?.title) ||
    metadataTitle ||
    resolveFileName(item.path);
  const displayPath = truncateMiddle(item.path, 84);
  const previewText =
    resolveDocumentPreview(document, displayTitle) ||
    (metadataPreview ? truncateInlineText(metadataPreview) : null) ||
    resolveFallbackPreview(item.content) ||
    "点击在画布中打开完整内容。";
  const sourceLabel = resolveArtifactSourceLabel(item.source);
  const kindLabel = resolveArtifactDocumentKindLabel(
    document?.kind || metadataKind,
  );
  const statusLabel = resolveArtifactDocumentStatusLabel(
    currentVersion?.status || document?.status || metadataStatus,
  );
  const versionNo = currentVersion?.versionNo || metadataVersionNo;
  const blockCount = document?.blocks.length || 0;
  const sourceCount = document?.sources.length || 0;

  return (
    <div className="py-1.5">
      <button
        type="button"
        data-testid="timeline-file-artifact-card"
        className="group w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm shadow-slate-950/5 transition hover:border-sky-200 hover:bg-sky-50/40"
        onClick={() => {
          if (onOpenArtifactFromTimeline && navigation) {
            onOpenArtifactFromTimeline(
              shouldOpenFocusedBlock ? blockTargets[0] : navigation.rootTarget,
            );
            return;
          }

          onFileClick?.(item.path, item.content || "");
        }}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
            {document ? (
              <FileStack className="h-[18px] w-[18px]" />
            ) : (
              <FileText className="h-[18px] w-[18px]" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1 text-sm font-medium leading-6 text-slate-900">
                <span className="line-clamp-1 break-all">{displayTitle}</span>
              </div>
              {kindLabel ? (
                <Badge
                  variant="outline"
                  className="border-sky-200 bg-sky-50 text-sky-700"
                >
                  {kindLabel}
                </Badge>
              ) : null}
              {statusLabel ? (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  {statusLabel}
                </Badge>
              ) : null}
              {sourceLabel ? (
                <Badge
                  variant="outline"
                  className="border-slate-200 bg-slate-50 text-slate-600"
                >
                  {sourceLabel}
                </Badge>
              ) : null}
              {timestamp ? (
                <span className="text-xs text-slate-400">{timestamp}</span>
              ) : null}
            </div>

            <div
              data-testid="timeline-file-artifact-preview"
              className="mt-2 text-sm leading-6 text-slate-600"
            >
              {previewText}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                title={item.path}
                className="inline-flex max-w-full rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-500"
              >
                <span className="truncate">{displayPath}</span>
              </span>
              {versionNo ? (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                  V{versionNo}
                </span>
              ) : null}
              {blockCount > 0 ? (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                  {blockCount} 个区块
                </span>
              ) : null}
              {sourceCount > 0 ? (
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                  {sourceCount} 条来源
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 text-xs text-slate-400 transition group-hover:text-sky-700">
                <span>在画布中打开</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </div>
        </div>
      </button>

      {onOpenArtifactFromTimeline && blockTargets.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {blockTargets.slice(0, 4).map((target) => (
            <button
              key={`${item.id}:${target.blockId}`}
              type="button"
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
              onClick={() => onOpenArtifactFromTimeline(target)}
            >
              定位到 {resolveBlockLabel(document, target.blockId || "")}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
