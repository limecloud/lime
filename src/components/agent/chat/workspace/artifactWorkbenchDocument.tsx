/* eslint-disable react-refresh/only-export-components */
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileClock,
  FilePenLine,
  FileStack,
  GitCompare,
  Info,
  Link2,
  RotateCcw,
  Save,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  resolveArtifactDocumentCurrentVersion,
  resolveArtifactDocumentCurrentVersionDiff,
  resolveArtifactDocumentSourceLinks,
  resolveArtifactDocumentVersionHistory,
  type ArtifactDocumentSource,
  type ArtifactDocumentVersionDiff,
  type ArtifactDocumentSourceLink,
  type ArtifactDocumentV1,
  type ArtifactDocumentVersionSummary,
} from "@/lib/artifact-document";
import { resolveArtifactProtocolDocumentPayload } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import { buildCanvasWorkbenchDiff } from "@/components/agent/chat/utils/canvasWorkbenchDiff";
import {
  createArtifactDocumentNextVersion,
  updateArtifactDocumentStatus,
} from "./artifactWorkbenchActions";
import type { AgentThreadItem } from "../types";
import {
  buildArtifactTimelineLinkIndex,
  type ArtifactTimelineLink,
} from "../utils/artifactTimelineNavigation";
import { cn } from "@/lib/utils";
import {
  normalizeHighlightsDraft,
  normalizeStringArray,
  normalizeText,
  parseChecklistDraftItems,
  parseMetricDraftItems,
  parseTableDraftColumns,
  parseTableDraftRows,
  resolveCodeBlockContent,
  resolveEditableArtifactDraft,
  resolveEditableCalloutTone,
  type EditableArtifactBlockDraft,
  type EditableArtifactBlockEntry,
} from "./artifactWorkbenchEditableDraft";
import { DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION } from "./artifactWorkbenchRewriteConfig";
import type { ArtifactBlockRewriteCompletion } from "./artifactWorkbenchRewrite";
import {
  NotionEditor,
  type NotionEditorHandle,
} from "@/lib/workspace/workbenchCanvas";

type ArtifactWorkbenchInspectorTab =
  | "overview"
  | "sources"
  | "versions"
  | "diff"
  | "edit";
export type {
  EditableArtifactBlockDraft,
  EditableArtifactBlockEntry,
} from "./artifactWorkbenchEditableDraft";

interface ArtifactRecoveryPresentation {
  kind: "recovered_draft" | "recovered_failed" | "repaired_structure";
  tone: "info" | "warning";
  title: string;
  detail: string;
  badgeLabel: string;
}

export interface ArtifactWorkbenchDocumentController {
  artifact: Artifact;
  document: ArtifactDocumentV1 | null;
  currentVersion: ArtifactDocumentVersionSummary | null;
  currentVersionDiff: ArtifactDocumentVersionDiff | null;
  versionHistory: ArtifactDocumentVersionSummary[];
  sourceLinks: ArtifactDocumentSourceLink[];
  timelineLinksByBlockId: Record<string, ArtifactTimelineLink[]>;
  recoveryPresentation: ArtifactRecoveryPresentation | null;
  canEditDocument: boolean;
  canMarkAsReady: boolean;
  inspectorTab: ArtifactWorkbenchInspectorTab;
  setInspectorTab: (tab: ArtifactWorkbenchInspectorTab) => void;
  editableBlocks: EditableArtifactBlockEntry[];
  draftByBlockId: Record<string, EditableArtifactBlockDraft>;
  selectedEditableBlock: EditableArtifactBlockEntry | null;
  selectedEditableDraft: EditableArtifactBlockDraft | null;
  selectedTimelineLink: ArtifactTimelineLink | null;
  isSavingEdit: boolean;
  isUpdatingRecoveryState: boolean;
  editSaveError: string | null;
  recoveryActionError: string | null;
  lastSavedAt: string | null;
  rendererViewportRef: React.RefObject<HTMLDivElement | null>;
  focusBlock: (blockId: string) => void;
  selectEditableBlock: (blockId: string) => void;
  handleEditDraftChange: (draft: EditableArtifactBlockDraft) => void;
  handleEditCancel: () => void;
  handleEditSave: (draft?: EditableArtifactBlockDraft) => Promise<void>;
  handleContinueEditing: () => void;
  handleMarkAsReady: () => Promise<void>;
  onJumpToTimelineItem?: (itemId: string) => void;
}

interface UseArtifactWorkbenchDocumentControllerParams {
  artifact: Artifact;
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
  rendererViewportRef?: React.RefObject<HTMLDivElement | null>;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function formatVersionDate(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getStatusLabel(status: ArtifactDocumentV1["status"]): string {
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
      return status;
  }
}

function getKindLabel(kind: ArtifactDocumentV1["kind"]): string {
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
      return kind;
  }
}

function getEditableBlockKindLabel(
  editorKind: EditableArtifactBlockDraft["editorKind"],
): string {
  switch (editorKind) {
    case "rich_text":
      return "编辑正文";
    case "section_header":
      return "编辑章节";
    case "hero_summary":
      return "编辑摘要卡";
    case "callout":
      return "编辑提示块";
    case "key_points":
      return "编辑要点";
    case "table":
      return "编辑表格";
    case "checklist":
      return "编辑清单";
    case "metric_grid":
      return "编辑指标卡";
    case "quote":
      return "编辑引述";
    case "code_block":
      return "编辑代码块";
    default:
      return "编辑 block";
  }
}

function buildSourceLookup(
  sources: ArtifactDocumentSource[],
): Map<string, ArtifactDocumentSource> {
  return new Map(sources.map((source) => [source.id, source]));
}

function resolveSourceDisplayLabel(
  link: ArtifactDocumentSourceLink,
  source?: ArtifactDocumentSource,
): string {
  return (
    normalizeText(link.label) ||
    normalizeText(source?.label) ||
    normalizeText(source?.locator?.url) ||
    normalizeText(source?.locator?.path) ||
    link.sourceRef
  );
}

function resolveSourceMeta(
  link: ArtifactDocumentSourceLink,
  source?: ArtifactDocumentSource,
): string | undefined {
  return (
    normalizeText(source?.snippet) ||
    normalizeText(typeof link.locator === "string" ? link.locator : undefined)
  );
}

function getDiffLabel(changeType: string): string {
  switch (changeType) {
    case "added":
      return "新增";
    case "removed":
      return "删除";
    case "updated":
      return "更新";
    case "moved":
      return "移动";
    default:
      return changeType;
  }
}

function getDiffBadgeClassName(changeType: string): string {
  switch (changeType) {
    case "added":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "removed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "updated":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "moved":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function resolveArtifactRecoveryPresentation(
  artifact: Artifact,
  document: ArtifactDocumentV1,
): ArtifactRecoveryPresentation | null {
  const issues = normalizeStringArray(artifact.meta.artifactValidationIssues);
  const fallbackUsed = normalizeBoolean(artifact.meta.artifactFallbackUsed);
  const repaired = normalizeBoolean(artifact.meta.artifactValidationRepaired);
  const recoveredFromMarkdown = issues.some((issue) =>
    issue.includes("Markdown 正文自动恢复"),
  );
  const recoveredFromTruncatedJson = issues.some((issue) =>
    issue.includes("不完整的 ArtifactDocument JSON"),
  );

  if (document.status === "failed") {
    return {
      kind: "recovered_failed",
      tone: "warning",
      badgeLabel: "恢复稿",
      title: "已保留恢复稿",
      detail:
        "模型这次没有完整生成结构化文稿，正文已经保留在工作台里。建议先继续编辑补齐，再作为正式文稿使用。",
    };
  }

  if (document.status === "draft" && (fallbackUsed || recoveredFromMarkdown)) {
    return {
      kind: "recovered_draft",
      tone: "info",
      badgeLabel: "恢复稿",
      title: "已整理为可继续编辑的草稿",
      detail:
        "系统已先把可用正文整理成恢复稿。你可以直接继续编辑，确认内容顺畅后，再手动标记为可阅读。",
    };
  }

  if (repaired || recoveredFromTruncatedJson) {
    return {
      kind: "repaired_structure",
      tone: "info",
      badgeLabel: "已补全",
      title: "文稿结构已自动补全",
      detail: "系统已补齐中断的结构化内容，当前文稿可以继续预览和编辑。",
    };
  }

  return null;
}

function serializeEditableArtifactDraft(draft: EditableArtifactBlockDraft): string {
  switch (draft.editorKind) {
    case "rich_text":
      return JSON.stringify({
        editorKind: draft.editorKind,
        markdown: draft.markdown,
      });
    case "section_header":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        description: draft.description.trim(),
      });
    case "hero_summary":
      return JSON.stringify({
        editorKind: draft.editorKind,
        eyebrow: draft.eyebrow.trim(),
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        highlights: normalizeHighlightsDraft(draft.highlights),
      });
    case "callout":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        tone: draft.tone.trim(),
      });
    case "key_points":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        items: draft.items
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
    case "table":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        columns: parseTableDraftColumns(draft.columns),
        rows: parseTableDraftRows(
          draft.rows,
          parseTableDraftColumns(draft.columns).length,
        ),
      });
    case "checklist":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        items: parseChecklistDraftItems(draft.items, "preview"),
      });
    case "metric_grid":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        metrics: parseMetricDraftItems(draft.metrics, "preview"),
      });
    case "quote":
      return JSON.stringify({
        editorKind: draft.editorKind,
        text: draft.text.trim(),
        attribution: draft.attribution.trim(),
      });
    case "code_block":
      return JSON.stringify({
        editorKind: draft.editorKind,
        title: draft.title.trim(),
        language: draft.language.trim(),
        code: draft.code,
      });
    default:
      return JSON.stringify(draft);
  }
}

function resolveEditableArtifactBlocks(
  document: ArtifactDocumentV1,
): EditableArtifactBlockEntry[] {
  let currentSectionLabel: string | undefined;
  let richTextIndex = 0;
  let sectionHeaderIndex = 0;
  let heroSummaryIndex = 0;
  let calloutIndex = 0;
  let keyPointsIndex = 0;
  let tableIndex = 0;
  let checklistIndex = 0;
  let metricGridIndex = 0;
  let quoteIndex = 0;
  let codeBlockIndex = 0;
  const entries: EditableArtifactBlockEntry[] = [];

  for (const block of document.blocks) {
    if (block.type === "section_header") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "section_header") {
        continue;
      }
      sectionHeaderIndex += 1;
      currentSectionLabel = normalizeText(block.title) || currentSectionLabel;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `章节 ${sectionHeaderIndex}`,
        detail: "章节标题",
        editorKind: "section_header",
        draft,
      });
      continue;
    }

    if (block.type === "hero_summary") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "hero_summary") {
        continue;
      }
      heroSummaryIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `摘要卡 ${heroSummaryIndex}`,
        detail: currentSectionLabel || "摘要卡",
        editorKind: "hero_summary",
        draft,
      });
      continue;
    }

    if (block.type === "callout") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "callout") {
        continue;
      }
      calloutIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `提示块 ${calloutIndex}`,
        detail: currentSectionLabel || "提示信息",
        editorKind: "callout",
        draft,
      });
      continue;
    }

    if (block.type === "rich_text") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "rich_text") {
        continue;
      }
      richTextIndex += 1;
      entries.push({
        blockId: block.id,
        label:
          normalizeText(block.title) ||
          currentSectionLabel ||
          `正文块 ${richTextIndex}`,
        detail: currentSectionLabel,
        editorKind: "rich_text",
        draft,
      });
      continue;
    }

    if (block.type === "key_points") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "key_points") {
        continue;
      }
      keyPointsIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `要点块 ${keyPointsIndex}`,
        detail: currentSectionLabel || "关键结论",
        editorKind: "key_points",
        draft,
      });
      continue;
    }

    if (block.type === "table") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "table") {
        continue;
      }
      tableIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `表格 ${tableIndex}`,
        detail: currentSectionLabel || "结构化表格",
        editorKind: "table",
        draft,
      });
      continue;
    }

    if (block.type === "checklist") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "checklist") {
        continue;
      }
      checklistIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `清单 ${checklistIndex}`,
        detail: currentSectionLabel || "执行清单",
        editorKind: "checklist",
        draft,
      });
      continue;
    }

    if (block.type === "metric_grid") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "metric_grid") {
        continue;
      }
      metricGridIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `指标块 ${metricGridIndex}`,
        detail: currentSectionLabel || "关键指标",
        editorKind: "metric_grid",
        draft,
      });
      continue;
    }

    if (block.type === "quote") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "quote") {
        continue;
      }
      quoteIndex += 1;
      entries.push({
        blockId: block.id,
        label:
          normalizeText(block.attribution) ||
          normalizeText(block.text) ||
          `引述 ${quoteIndex}`,
        detail: currentSectionLabel || "引用语句",
        editorKind: "quote",
        draft,
      });
      continue;
    }

    if (block.type === "code_block") {
      const draft = resolveEditableArtifactDraft(block);
      if (!draft || draft.editorKind !== "code_block") {
        continue;
      }
      codeBlockIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `代码块 ${codeBlockIndex}`,
        detail:
          currentSectionLabel ||
          normalizeText(block.language) ||
          "代码片段",
        editorKind: "code_block",
        draft,
      });
    }
  }

  return entries;
}

function replaceEditableArtifactBlockContent(
  document: ArtifactDocumentV1,
  blockId: string,
  draft: EditableArtifactBlockDraft,
): ArtifactDocumentV1 {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.id !== blockId) {
        return block;
      }

      if (block.type === "rich_text" && draft.editorKind === "rich_text") {
        return {
          ...block,
          contentFormat: "markdown",
          content: draft.markdown,
          markdown: draft.markdown,
        };
      }

      if (block.type === "section_header" && draft.editorKind === "section_header") {
        const title = draft.title.trim();
        const description = draft.description.trim();
        return {
          ...block,
          title,
          description: description || undefined,
        };
      }

      if (block.type === "hero_summary" && draft.editorKind === "hero_summary") {
        const eyebrow = draft.eyebrow.trim();
        const title = draft.title.trim();
        const summary = draft.summary.trim();
        const highlights = normalizeHighlightsDraft(draft.highlights)
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
        return {
          ...block,
          eyebrow: eyebrow || undefined,
          title: title || undefined,
          summary: summary || normalizeText(block.summary) || "",
          highlights: highlights.length > 0 ? highlights : undefined,
        };
      }

      if (block.type === "callout" && draft.editorKind === "callout") {
        const title = draft.title.trim();
        const body = draft.body.trim();
        const tone = draft.tone.trim();
        const nextBody =
          body ||
          normalizeText(block.body) ||
          normalizeText(block.content) ||
          normalizeText(block.text) ||
          "";
        return {
          ...block,
          title: title || undefined,
          body: nextBody,
          content: nextBody,
          text: nextBody,
          tone: resolveEditableCalloutTone(tone),
          variant: tone || normalizeText(block.variant) || normalizeText(block.tone),
        };
      }

      if (block.type === "key_points" && draft.editorKind === "key_points") {
        const title = draft.title.trim();
        const items = draft.items
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
        return {
          ...block,
          title: title || undefined,
          items:
            items.length > 0
              ? items
              : normalizeStringArray(block.items),
        };
      }

      if (block.type === "table" && draft.editorKind === "table") {
        const title = draft.title.trim();
        const currentColumns = Array.isArray(block.columns) ? block.columns : [];
        const currentRows = Array.isArray(block.rows) ? block.rows : [];
        const columns = parseTableDraftColumns(draft.columns);
        const effectiveColumns = columns.length > 0 ? columns : currentColumns;
        const rows = parseTableDraftRows(draft.rows, effectiveColumns.length);
        return {
          ...block,
          title: title || undefined,
          columns: effectiveColumns,
          rows: rows.length > 0 ? rows : currentRows,
        };
      }

      if (block.type === "checklist" && draft.editorKind === "checklist") {
        const title = draft.title.trim();
        const currentItems = Array.isArray(block.items) ? block.items : [];
        const items = parseChecklistDraftItems(draft.items, block.id, currentItems);
        return {
          ...block,
          title: title || undefined,
          items: items.length > 0 ? items : currentItems,
        };
      }

      if (block.type === "metric_grid" && draft.editorKind === "metric_grid") {
        const title = draft.title.trim();
        const currentMetrics = Array.isArray(block.metrics) ? block.metrics : [];
        const metrics = parseMetricDraftItems(
          draft.metrics,
          block.id,
          currentMetrics,
        );
        return {
          ...block,
          title: title || undefined,
          metrics: metrics.length > 0 ? metrics : currentMetrics,
        };
      }

      if (block.type === "quote" && draft.editorKind === "quote") {
        const text =
          draft.text.trim() ||
          normalizeText(block.text) ||
          normalizeText(block.quote) ||
          "";
        const attribution = draft.attribution.trim();
        return {
          ...block,
          text,
          quote: text,
          attribution: attribution || undefined,
          author:
            attribution || normalizeText(block.author) || undefined,
          source:
            attribution || normalizeText(block.source) || undefined,
        };
      }

      if (block.type === "code_block" && draft.editorKind === "code_block") {
        const title = draft.title.trim();
        const language = draft.language.trim();
        const code = draft.code || resolveCodeBlockContent(block);
        return {
          ...block,
          title: title || undefined,
          language: language || undefined,
          code,
        };
      }

      return block;
    }),
  };
}

const EmptyInspectorState: React.FC<{
  icon: React.ReactNode;
  title: string;
  detail: string;
}> = memo(({ icon, title, detail }) => (
  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
      {icon}
    </div>
    <div className="font-medium text-slate-800">{title}</div>
    <p className="mt-1 leading-6">{detail}</p>
  </div>
));
EmptyInspectorState.displayName = "EmptyInspectorState";

function resolveEditableDraftPreviewText(
  draft: EditableArtifactBlockDraft,
): string {
  switch (draft.editorKind) {
    case "rich_text":
      return draft.markdown.trim();
    case "section_header":
      return [draft.title.trim(), draft.description.trim()]
        .filter(Boolean)
        .join("\n");
    case "hero_summary":
      return [
        draft.eyebrow.trim(),
        draft.title.trim(),
        draft.summary.trim(),
        normalizeHighlightsDraft(draft.highlights),
      ]
        .filter(Boolean)
        .join("\n");
    case "callout":
      return [draft.title.trim(), draft.tone.trim(), draft.body.trim()]
        .filter(Boolean)
        .join("\n");
    case "key_points":
      return [draft.title.trim(), draft.items.trim()].filter(Boolean).join("\n");
    case "table":
      return [draft.title.trim(), draft.columns.trim(), draft.rows.trim()]
        .filter(Boolean)
        .join("\n");
    case "checklist":
      return [draft.title.trim(), draft.items.trim()].filter(Boolean).join("\n");
    case "metric_grid":
      return [draft.title.trim(), draft.metrics.trim()].filter(Boolean).join("\n");
    case "quote":
      return [draft.text.trim(), draft.attribution.trim()].filter(Boolean).join("\n");
    case "code_block":
      return [draft.title.trim(), draft.language.trim(), draft.code.trim()]
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

const OverviewPanel: React.FC<{
  document: ArtifactDocumentV1;
  currentVersion: ArtifactDocumentVersionSummary | null;
  versionHistory: ArtifactDocumentVersionSummary[];
  sourceLinks: ArtifactDocumentSourceLink[];
  recoveryPresentation: ArtifactRecoveryPresentation | null;
  canEditDocument: boolean;
  canMarkAsReady: boolean;
  isUpdatingRecoveryState: boolean;
  recoveryActionError: string | null;
  onContinueEditing: () => void;
  onMarkAsReady: () => void;
}> = memo(
  ({
    document,
    currentVersion,
    versionHistory,
    sourceLinks,
    recoveryPresentation,
    canEditDocument,
    canMarkAsReady,
    isUpdatingRecoveryState,
    recoveryActionError,
    onContinueEditing,
    onMarkAsReady,
  }) => (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{getKindLabel(document.kind)}</Badge>
          <Badge
            variant={document.status === "failed" ? "destructive" : "outline"}
          >
            {getStatusLabel(document.status)}
          </Badge>
          {recoveryPresentation ? (
            <Badge
              variant="outline"
              className={cn(
                recoveryPresentation.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-sky-200 bg-sky-50 text-sky-700",
              )}
            >
              {recoveryPresentation.badgeLabel}
            </Badge>
          ) : null}
          {currentVersion ? (
            <Badge variant="outline">v{currentVersion.versionNo}</Badge>
          ) : null}
        </div>
        {document.summary ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">{document.summary}</p>
        ) : null}
      </section>

      {recoveryPresentation ? (
        <section
          data-testid="artifact-recovery-notice"
          className={cn(
            "rounded-2xl border px-4 py-3",
            recoveryPresentation.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-sky-200 bg-sky-50 text-sky-950",
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                recoveryPresentation.tone === "warning"
                  ? "border-amber-200 bg-white text-amber-700"
                  : "border-sky-200 bg-white text-sky-700",
              )}
            >
              <Info className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {recoveryPresentation.title}
              </div>
              <p className="mt-1 text-sm leading-6 opacity-90">
                {recoveryPresentation.detail}
              </p>
              {canEditDocument ||
              (recoveryPresentation.kind === "recovered_draft" &&
                canMarkAsReady) ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canEditDocument ? (
                    <button
                      data-testid="artifact-recovery-continue-editing"
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={onContinueEditing}
                      disabled={isUpdatingRecoveryState}
                    >
                      <FilePenLine className="h-4 w-4" />
                      继续编辑
                    </button>
                  ) : null}
                  {recoveryPresentation.kind === "recovered_draft" &&
                  canMarkAsReady ? (
                    <button
                      data-testid="artifact-recovery-mark-ready"
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                      onClick={onMarkAsReady}
                      disabled={isUpdatingRecoveryState}
                    >
                      <Save className="h-4 w-4" />
                      {isUpdatingRecoveryState ? "处理中" : "标记为可阅读"}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {recoveryActionError ? (
                <p className="mt-3 text-sm text-rose-700">{recoveryActionError}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            Blocks
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {document.blocks.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            Sources
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {document.sources.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            Links
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {sourceLinks.length}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">
            Versions
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {versionHistory.length || (currentVersion ? 1 : 0)}
          </div>
        </div>
      </section>
    </div>
  ),
);
OverviewPanel.displayName = "OverviewPanel";

const SourcesPanel: React.FC<{
  links: ArtifactDocumentSourceLink[];
  sources: ArtifactDocumentSource[];
  onSelectBlock?: (blockId: string) => void;
  resolveTimelineLink?: (blockId: string) => ArtifactTimelineLink | null;
  onSelectTimelineItem?: (itemId: string) => void;
}> = memo(
  ({
    links,
    sources,
    onSelectBlock,
    resolveTimelineLink,
    onSelectTimelineItem,
  }) => {
    if (links.length === 0 && sources.length === 0) {
      return (
        <EmptyInspectorState
          icon={<Link2 className="h-4 w-4" />}
          title="还没有来源抽屉"
          detail="当前文档还没有可展示的来源绑定，后续搜索、文件或工具引用会沉淀到这里。"
        />
      );
    }

    const sourceLookup = buildSourceLookup(sources);
    const items = links.length
      ? links
      : sources.map((source) => ({
          artifactId: "artifact-document",
          blockId: "document",
          sourceId: source.id,
          sourceType: source.type,
          sourceRef:
            source.locator?.url ||
            source.locator?.path ||
            source.locator?.toolCallId ||
            source.locator?.messageId ||
            source.id,
          label: source.label,
        }));

    return (
      <div className="space-y-3">
        {items.map((link, index) => {
          const source = link.sourceId ? sourceLookup.get(link.sourceId) : undefined;
          const timelineLink = resolveTimelineLink?.(link.blockId) || null;
          return (
            <article
              key={`${link.blockId}:${link.sourceRef}:${index}`}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    className="truncate text-left text-sm font-medium text-slate-950 transition hover:text-sky-700"
                    onClick={() => onSelectBlock?.(link.blockId)}
                  >
                    {resolveSourceDisplayLabel(link, source)}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{link.sourceType}</span>
                    <span>·</span>
                    <span>block {link.blockId}</span>
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {link.sourceId || "linked"}
                </Badge>
              </div>
              {resolveSourceMeta(link, source) ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  {resolveSourceMeta(link, source)}
                </p>
              ) : null}
              {timelineLink && onSelectTimelineItem ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                    onClick={() => onSelectTimelineItem(timelineLink.itemId)}
                  >
                    跳到过程
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  },
);
SourcesPanel.displayName = "SourcesPanel";

const VersionsPanel: React.FC<{
  currentVersion: ArtifactDocumentVersionSummary | null;
  versionHistory: ArtifactDocumentVersionSummary[];
}> = memo(({ currentVersion, versionHistory }) => {
  const versions =
    versionHistory.length > 0
      ? versionHistory
      : currentVersion
        ? [currentVersion]
        : [];

  if (versions.length === 0) {
    return (
      <EmptyInspectorState
        icon={<FileClock className="h-4 w-4" />}
        title="版本历史还未建立"
        detail="当前还没有可回看的版本摘要。接下来每次正式持久化都会在这里沉淀一个版本快照。"
      />
    );
  }

  return (
    <div className="space-y-3">
      {versions.map((version) => (
        <article
          key={version.id}
          className={cn(
            "rounded-2xl border p-4",
            currentVersion?.id === version.id
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-900",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">v{version.versionNo}</div>
              <div
                className={cn(
                  "mt-1 text-xs",
                  currentVersion?.id === version.id
                    ? "text-slate-300"
                    : "text-slate-500",
                )}
              >
                {formatVersionDate(version.createdAt) || "时间未知"}
              </div>
            </div>
            <Badge
              variant={currentVersion?.id === version.id ? "secondary" : "outline"}
              className={currentVersion?.id === version.id ? "text-slate-950" : undefined}
            >
              {currentVersion?.id === version.id ? "当前" : version.createdBy || "快照"}
            </Badge>
          </div>
          <div
            className={cn(
              "mt-3 text-sm font-medium",
              currentVersion?.id === version.id ? "text-white" : "text-slate-950",
            )}
          >
            {version.title || "未命名交付物"}
          </div>
          {version.summary ? (
            <p
              className={cn(
                "mt-2 text-sm leading-6",
                currentVersion?.id === version.id
                  ? "text-slate-300"
                  : "text-slate-600",
              )}
            >
              {version.summary}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
});
VersionsPanel.displayName = "VersionsPanel";

const DiffPanel: React.FC<{
  diff: ArtifactDocumentVersionDiff | null;
  onSelectBlock?: (blockId: string) => void;
  resolveTimelineLink?: (blockId: string) => ArtifactTimelineLink | null;
  onSelectTimelineItem?: (itemId: string) => void;
}> = memo(({ diff, onSelectBlock, resolveTimelineLink, onSelectTimelineItem }) => {
  if (!diff || diff.changedBlocks.length === 0) {
    return (
      <EmptyInspectorState
        icon={<GitCompare className="h-4 w-4" />}
        title="还没有版本差异"
        detail="当前文档还没有可展示的 block diff。后续版本生成后，会在这里展示新增、更新、删除与位置变化。"
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Updated</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {diff.updatedCount || 0}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Added</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {diff.addedCount || 0}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Removed</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {diff.removedCount || 0}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Moved</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">
            {diff.movedCount || 0}
          </div>
        </div>
      </section>

      <div className="space-y-3">
        {diff.changedBlocks.map((changedBlock) => {
          const diffLines = buildCanvasWorkbenchDiff(
            changedBlock.beforeText || "",
            changedBlock.afterText || "",
          ).slice(0, 12);
          const canJump = changedBlock.changeType !== "removed";
          const timelineLink = resolveTimelineLink?.(changedBlock.blockId) || null;

          return (
            <article
              key={`${changedBlock.blockId}:${changedBlock.changeType}`}
              className="rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("shrink-0", getDiffBadgeClassName(changedBlock.changeType))}
                    >
                      {getDiffLabel(changedBlock.changeType)}
                    </Badge>
                    <span className="truncate text-sm font-medium text-slate-950">
                      {changedBlock.blockId}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {changedBlock.summary || "检测到 block 发生变化。"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {timelineLink && onSelectTimelineItem ? (
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                      onClick={() => onSelectTimelineItem(timelineLink.itemId)}
                    >
                      跳到过程
                    </button>
                  ) : null}
                  {canJump ? (
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                      onClick={() => onSelectBlock?.(changedBlock.blockId)}
                    >
                      跳到 block
                    </button>
                  ) : null}
                </div>
              </div>

              {diffLines.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                  <div className="max-h-56 overflow-auto px-3 py-2 font-mono text-[11px] leading-5 text-slate-700">
                    {diffLines.map((line, index) => (
                      <div
                        key={`${changedBlock.blockId}:${index}:${line.type}`}
                        className={cn(
                          "rounded px-2",
                          line.type === "add" && "bg-emerald-50 text-emerald-800",
                          line.type === "remove" && "bg-rose-50 text-rose-800",
                        )}
                      >
                        <span className="mr-2 inline-block w-3 text-center text-slate-400">
                          {line.type === "add"
                            ? "+"
                            : line.type === "remove"
                              ? "-"
                              : " "}
                        </span>
                        <span>{line.value || " "}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : changedBlock.afterText || changedBlock.beforeText ? (
                <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">
                  {changedBlock.afterText || changedBlock.beforeText}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
});
DiffPanel.displayName = "DiffPanel";

const EditInspectorPanel: React.FC<{
  editableBlocks: EditableArtifactBlockEntry[];
  selectedBlockId: string | null;
  draftByBlockId: Record<string, EditableArtifactBlockDraft>;
  saveError: string | null;
  lastSavedAt: string | null;
  isSaving: boolean;
  onSelectBlock: (blockId: string) => void;
}> = memo(
  ({
    editableBlocks,
    selectedBlockId,
    draftByBlockId,
    saveError,
    lastSavedAt,
    isSaving,
    onSelectBlock,
  }) => {
    if (editableBlocks.length === 0) {
      return (
        <EmptyInspectorState
          icon={<FilePenLine className="h-4 w-4" />}
          title="当前文档没有可编辑 block"
          detail="当前编辑态已支持章节头、摘要卡、正文块与提示块；如果这里为空，说明该交付物暂时只包含只读结构。"
        />
      );
    }

    return (
      <div className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-medium text-slate-900">Workbench 编辑</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            当前支持章节头、摘要卡、正文块与提示块原位编辑，保存后会回写到同一份
            ArtifactDocument JSON，不再把正文打回聊天区。
          </p>
        </section>

        <div className="space-y-2">
          {editableBlocks.map((block) => {
            const currentDraft = draftByBlockId[block.blockId] ?? block.draft;
            const isDirty =
              serializeEditableArtifactDraft(currentDraft) !==
              serializeEditableArtifactDraft(block.draft);
            const isActive = selectedBlockId === block.blockId;

            return (
              <button
                key={block.blockId}
                type="button"
                className={cn(
                  "w-full rounded-2xl border px-4 py-3 text-left transition",
                  isActive
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-900 hover:border-sky-200 hover:bg-sky-50",
                )}
                onClick={() => onSelectBlock(block.blockId)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {block.label}
                    </div>
                    {block.detail ? (
                      <div
                        className={cn(
                          "mt-1 truncate text-xs",
                          isActive ? "text-slate-300" : "text-slate-500",
                        )}
                      >
                        {block.detail}
                      </div>
                    ) : null}
                  </div>
                  {isDirty ? (
                    <Badge
                      variant={isActive ? "secondary" : "outline"}
                      className={isActive ? "text-slate-950" : undefined}
                    >
                      未保存
                    </Badge>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {saveError ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
            {saveError}
          </section>
        ) : null}

        {lastSavedAt ? (
          <div className="text-xs text-slate-500">
            最近保存于 {formatVersionDate(lastSavedAt) || lastSavedAt}
            {isSaving ? "，正在同步…" : ""}
          </div>
        ) : isSaving ? (
          <div className="text-xs text-slate-500">正在同步编辑结果…</div>
        ) : null}
      </div>
    );
  },
);
EditInspectorPanel.displayName = "EditInspectorPanel";

export const ArtifactWorkbenchEditSurface: React.FC<{
  entry: EditableArtifactBlockEntry | null;
  draft: EditableArtifactBlockDraft | null;
  timelineLink?: ArtifactTimelineLink | null;
  isSaving: boolean;
  isStreaming: boolean;
  onChange: (draft: EditableArtifactBlockDraft) => void;
  onSave: (draft?: EditableArtifactBlockDraft) => Promise<void> | void;
  onRewrite?: (payload: {
    draft: EditableArtifactBlockDraft;
    instruction: string;
  }) => Promise<ArtifactBlockRewriteCompletion | void> | void;
  onCancel: () => void;
  onJumpToTimelineItem?: (itemId: string) => void;
}> = memo(
  ({
    entry,
    draft,
    timelineLink,
    isSaving,
    isStreaming,
    onChange,
    onSave,
    onRewrite,
    onCancel,
    onJumpToTimelineItem,
  }) => {
    const editorRef = useRef<NotionEditorHandle | null>(null);
    const [isRewriting, setIsRewriting] = useState(false);
    const [rewriteInstruction, setRewriteInstruction] = useState(
      DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION,
    );
    const [rewriteFeedback, setRewriteFeedback] = useState<{
      tone: "success" | "error" | "info";
      message: string;
    } | null>(null);
    const [rewriteSuggestion, setRewriteSuggestion] = useState<{
      draft: EditableArtifactBlockDraft;
      summary?: string;
    } | null>(null);

    useEffect(() => {
      setIsRewriting(false);
      setRewriteInstruction(DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION);
      setRewriteFeedback(null);
      setRewriteSuggestion(null);
    }, [entry?.blockId]);

    const runSave = useCallback(
      (nextDraft: EditableArtifactBlockDraft) => {
        onChange(nextDraft);
        return Promise.resolve(onSave(nextDraft));
      },
      [onChange, onSave],
    );

    const handleSave = useCallback(() => {
      if (!entry || !draft) {
        return;
      }

      if (entry.editorKind === "rich_text" && draft.editorKind === "rich_text") {
        const latestDraft: EditableArtifactBlockDraft = {
          ...draft,
          markdown: editorRef.current?.flushContent() ?? draft.markdown,
        };
        void runSave(latestDraft).catch(() => undefined);
        return;
      }

      void runSave(draft).catch(() => undefined);
    }, [draft, entry, runSave]);

    const handleRewrite = useCallback(async () => {
      if (!entry || !draft || !onRewrite || isRewriting) {
        return;
      }

      const instruction =
        rewriteInstruction.trim() || DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION;

      setRewriteFeedback(null);
      setRewriteSuggestion(null);
      setIsRewriting(true);
      try {
        if (entry.editorKind === "rich_text" && draft.editorKind === "rich_text") {
          const latestDraft: EditableArtifactBlockDraft = {
            ...draft,
            markdown: editorRef.current?.flushContent() ?? draft.markdown,
          };
          onChange(latestDraft);
          const result = await onRewrite({
            draft: latestDraft,
            instruction,
          });
          if (result?.suggestion) {
            setRewriteSuggestion({
              draft: result.suggestion.draft,
              summary: result.suggestion.summary,
            });
            setRewriteFeedback({
              tone: "success",
              message: "已收到当前块改写建议，可先回填到草稿，再决定是否保存。",
            });
          } else {
            setRewriteFeedback({
              tone: "info",
              message:
                result?.warning ||
                "改写已完成，但当前没有可直接回填的结构化结果，请在对话流查看返回内容。",
            });
          }
          return;
        }

        const result = await onRewrite({
          draft,
          instruction,
        });
        if (result?.suggestion) {
          setRewriteSuggestion({
            draft: result.suggestion.draft,
            summary: result.suggestion.summary,
          });
          setRewriteFeedback({
            tone: "success",
            message: "已收到当前块改写建议，可先回填到草稿，再决定是否保存。",
          });
        } else {
          setRewriteFeedback({
            tone: "info",
            message:
              result?.warning ||
              "改写已完成，但当前没有可直接回填的结构化结果，请在对话流查看返回内容。",
          });
        }
      } catch (error) {
        setRewriteSuggestion(null);
        setRewriteFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "发起当前块 AI 改写失败，请稍后重试。",
        });
        throw error;
      } finally {
        setIsRewriting(false);
      }
    }, [draft, entry, isRewriting, onChange, onRewrite, rewriteInstruction]);

    const handleApplyRewriteSuggestion = useCallback(() => {
      if (!rewriteSuggestion) {
        return;
      }

      onChange(rewriteSuggestion.draft);
      setRewriteSuggestion(null);
      setRewriteFeedback({
        tone: "success",
        message: "已回填到当前草稿，确认无误后点击保存即可写回文稿。",
      });
    }, [onChange, rewriteSuggestion]);

    const handleApplyRewriteSuggestionAndSave = useCallback(async () => {
      if (!rewriteSuggestion) {
        return;
      }

      setRewriteFeedback({
        tone: "info",
        message: "正在把改写建议保存为当前文稿的新版本…",
      });

      try {
        await runSave(rewriteSuggestion.draft);
        setRewriteSuggestion(null);
        setRewriteFeedback({
          tone: "success",
          message: "已把改写建议保存为当前文稿的新版本。",
        });
      } catch (error) {
        setRewriteFeedback({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "保存改写建议失败，请稍后重试。",
        });
      }
    }, [rewriteSuggestion, runSave]);

    if (!entry || !draft) {
      return (
        <div className="flex h-full items-center justify-center bg-slate-50/70 p-6">
          <div className="max-w-md rounded-[24px] border border-dashed border-slate-200 bg-white px-6 py-8 text-sm leading-6 text-slate-500">
            选择一个正文块后，这里会切换到可编辑的文档视图。
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col bg-slate-50/60">
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {getEditableBlockKindLabel(entry.editorKind)}
                </Badge>
                <span className="truncate text-sm font-medium text-slate-900">
                  {entry.label}
                </span>
              </div>
              {entry.detail ? (
                <p className="mt-2 text-sm text-slate-500">{entry.detail}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {timelineLink && onJumpToTimelineItem ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onJumpToTimelineItem(timelineLink.itemId)}
                  disabled={isSaving}
                >
                  <ScrollText className="h-4 w-4" />
                  跳到过程
                </button>
              ) : null}
              {onRewrite ? (
                <button
                  data-testid="artifact-edit-ai-rewrite"
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    void handleRewrite().catch(() => undefined);
                  }}
                  disabled={isSaving || isStreaming || isRewriting}
                >
                  <Sparkles className="h-4 w-4" />
                  {isRewriting ? "AI 改写中" : "AI 改写当前块"}
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onCancel}
                disabled={isSaving}
              >
                <RotateCcw className="h-4 w-4" />
                还原
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                onClick={handleSave}
                disabled={isSaving || isStreaming}
              >
                <Save className="h-4 w-4" />
                {isSaving ? "保存中" : "保存"}
              </button>
            </div>
          </div>
          {onRewrite ? (
            <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    AI 改写说明
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    只作用于当前 block；发送时会带上当前未保存草稿、相邻结构和来源绑定。
                  </p>
                </div>
                <textarea
                  data-testid="artifact-edit-rewrite-instruction"
                  value={rewriteInstruction}
                  className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  onChange={(event) => {
                    setRewriteInstruction(event.target.value);
                    setRewriteFeedback(null);
                  }}
                  disabled={isSaving || isStreaming || isRewriting}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>不会自动覆盖当前草稿；改写结果会先回到对话流。</span>
                  <span>
                    {isRewriting ? "正在发起改写请求..." : "可按当前 block 单独改写"}
                  </span>
                </div>
                {rewriteFeedback ? (
                  <div
                    data-testid="artifact-edit-rewrite-feedback"
                    className={cn(
                      "rounded-2xl border px-4 py-3 text-sm leading-6",
                      rewriteFeedback.tone === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : rewriteFeedback.tone === "info"
                          ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-rose-200 bg-rose-50 text-rose-700",
                    )}
                  >
                    {rewriteFeedback.message}
                  </div>
                ) : null}
                {rewriteSuggestion ? (
                  <div
                    data-testid="artifact-edit-rewrite-suggestion"
                    className="rounded-[24px] border border-emerald-200 bg-white px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          本次改写建议
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {rewriteSuggestion.summary ||
                            "当前建议尚未写回文稿，你可以先回填到草稿，再决定是否保存。"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          data-testid="artifact-edit-rewrite-dismiss"
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                          onClick={() => {
                            setRewriteSuggestion(null);
                            setRewriteFeedback(null);
                          }}
                        >
                          先不采纳
                        </button>
                        <button
                          data-testid="artifact-edit-rewrite-apply"
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                          onClick={handleApplyRewriteSuggestion}
                          disabled={isSaving || isStreaming}
                        >
                          回填到当前草稿
                        </button>
                        <button
                          data-testid="artifact-edit-rewrite-save"
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                          onClick={() => {
                            void handleApplyRewriteSuggestionAndSave();
                          }}
                          disabled={isSaving || isStreaming}
                        >
                          <Save className="h-4 w-4" />
                          保存为新版本
                        </button>
                      </div>
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                      {resolveEditableDraftPreviewText(rewriteSuggestion.draft)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto h-full max-w-4xl rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
            {entry.editorKind === "rich_text" && draft.editorKind === "rich_text" ? (
              <NotionEditor
                ref={editorRef}
                content={draft.markdown}
                contentVersionKey={entry.blockId}
                readOnly={isSaving || isStreaming}
                onCommit={(content) => {
                  onChange({
                    ...draft,
                    markdown: content,
                  });
                }}
                onSave={(latestContent) => {
                  const nextDraft: EditableArtifactBlockDraft = {
                    ...draft,
                    markdown:
                      typeof latestContent === "string"
                        ? latestContent
                        : draft.markdown,
                  };
                  void runSave(nextDraft).catch(() => undefined);
                }}
                onCancel={onCancel}
              />
            ) : (
              <div className="space-y-5 px-6 py-6">
                {entry.editorKind === "section_header" &&
                draft.editorKind === "section_header" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">章节标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">章节说明</span>
                      <textarea
                        data-testid="artifact-structured-edit-description"
                        value={draft.description}
                        className="min-h-32 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            description: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "hero_summary" &&
                draft.editorKind === "hero_summary" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">眉题</span>
                      <input
                        data-testid="artifact-structured-edit-eyebrow"
                        type="text"
                        value={draft.eyebrow}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            eyebrow: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">摘要正文</span>
                      <textarea
                        data-testid="artifact-structured-edit-summary"
                        value={draft.summary}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            summary: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">
                        高亮要点
                      </span>
                      <textarea
                        data-testid="artifact-structured-edit-highlights"
                        value={draft.highlights}
                        className="min-h-32 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            highlights: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        每行一条，会回写为 highlights 列表。
                      </p>
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "callout" &&
                draft.editorKind === "callout" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">提示标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">提示语气</span>
                      <input
                        data-testid="artifact-structured-edit-tone"
                        type="text"
                        value={draft.tone}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            tone: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">提示正文</span>
                      <textarea
                        data-testid="artifact-structured-edit-body"
                        value={draft.body}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            body: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "key_points" &&
                draft.editorKind === "key_points" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">块标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">要点列表</span>
                      <textarea
                        data-testid="artifact-structured-edit-items"
                        value={draft.items}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            items: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        每行一条，会回写为 `items[]`。
                      </p>
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "table" &&
                draft.editorKind === "table" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">表格标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">表头</span>
                      <textarea
                        data-testid="artifact-structured-edit-columns"
                        value={draft.columns}
                        className="min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            columns: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        单行用 `|` 分隔；多行时每行视为一列名。
                      </p>
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">表格行</span>
                      <textarea
                        data-testid="artifact-structured-edit-rows"
                        value={draft.rows}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            rows: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        每行一条数据，用 `|` 分隔单元格。
                      </p>
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "checklist" &&
                draft.editorKind === "checklist" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">清单标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">清单项</span>
                      <textarea
                        data-testid="artifact-structured-edit-checklist"
                        value={draft.items}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            items: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        每行使用 `todo | 内容`、`doing | 内容` 或 `done | 内容`。
                      </p>
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "metric_grid" &&
                draft.editorKind === "metric_grid" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">指标标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">指标项</span>
                      <textarea
                        data-testid="artifact-structured-edit-metrics"
                        value={draft.metrics}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            metrics: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                      <p className="text-xs text-slate-500">
                        每行格式：`标签 | 数值 | 说明 | tone`，后两段可选。
                      </p>
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "quote" &&
                draft.editorKind === "quote" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">引述正文</span>
                      <textarea
                        data-testid="artifact-structured-edit-quote"
                        value={draft.text}
                        className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            text: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">署名 / 来源</span>
                      <input
                        data-testid="artifact-structured-edit-attribution"
                        type="text"
                        value={draft.attribution}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            attribution: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                  </>
                ) : null}

                {entry.editorKind === "code_block" &&
                draft.editorKind === "code_block" ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">代码块标题</span>
                      <input
                        data-testid="artifact-structured-edit-title"
                        type="text"
                        value={draft.title}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            title: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">语言</span>
                      <input
                        data-testid="artifact-structured-edit-language"
                        type="text"
                        value={draft.language}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            language: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-slate-700">代码内容</span>
                      <textarea
                        data-testid="artifact-structured-edit-code"
                        value={draft.code}
                        className="min-h-56 w-full rounded-2xl border border-slate-200 px-4 py-3 font-mono text-sm leading-6 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            code: event.target.value,
                          })
                        }
                        disabled={isSaving || isStreaming}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);
ArtifactWorkbenchEditSurface.displayName = "ArtifactWorkbenchEditSurface";

export function useArtifactWorkbenchDocumentController({
  artifact,
  onSaveArtifactDocument,
  threadItems = [],
  focusedBlockId = null,
  blockFocusRequestKey = 0,
  onJumpToTimelineItem,
  rendererViewportRef,
}: UseArtifactWorkbenchDocumentControllerParams): ArtifactWorkbenchDocumentController {
  const localRendererViewportRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = rendererViewportRef ?? localRendererViewportRef;
  const document = useMemo(
    () =>
      resolveArtifactProtocolDocumentPayload({
        content: artifact.content,
        metadata: artifact.meta,
      }),
    [artifact.content, artifact.meta],
  );
  const currentVersion = useMemo(
    () => (document ? resolveArtifactDocumentCurrentVersion(document) : null),
    [document],
  );
  const currentVersionDiff = useMemo(
    () => (document ? resolveArtifactDocumentCurrentVersionDiff(document) : null),
    [document],
  );
  const versionHistory = useMemo(
    () => (document ? resolveArtifactDocumentVersionHistory(document) : []),
    [document],
  );
  const sourceLinks = useMemo(
    () => (document ? resolveArtifactDocumentSourceLinks(document) : []),
    [document],
  );
  const editableBlocks = useMemo(
    () => (document ? resolveEditableArtifactBlocks(document) : []),
    [document],
  );
  const timelineLinksByBlockId = useMemo(
    () =>
      document
        ? buildArtifactTimelineLinkIndex({
            artifact,
            items: threadItems,
          })
        : {},
    [artifact, document, threadItems],
  );
  const recoveryPresentation = useMemo(
    () =>
      document
        ? resolveArtifactRecoveryPresentation(artifact, document)
        : null,
    [artifact, document],
  );
  const canEditDocument = Boolean(
    document &&
      document.status !== "archived" &&
      onSaveArtifactDocument &&
      editableBlocks.length > 0,
  );
  const canMarkAsReady = Boolean(
    onSaveArtifactDocument && recoveryPresentation?.kind === "recovered_draft",
  );
  const defaultInspectorTab: ArtifactWorkbenchInspectorTab =
    currentVersionDiff?.changedBlocks.length
      ? "diff"
      : sourceLinks.length > 0
        ? "sources"
        : versionHistory.length > 0 || currentVersion
          ? "versions"
          : "overview";
  const [inspectorTab, setInspectorTab] =
    useState<ArtifactWorkbenchInspectorTab>(defaultInspectorTab);
  const [selectedEditBlockId, setSelectedEditBlockId] = useState<string | null>(
    editableBlocks[0]?.blockId ?? null,
  );
  const [draftByBlockId, setDraftByBlockId] = useState<
    Record<string, EditableArtifactBlockDraft>
  >({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isUpdatingRecoveryState, setIsUpdatingRecoveryState] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [recoveryActionError, setRecoveryActionError] = useState<string | null>(
    null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setInspectorTab(defaultInspectorTab);
  }, [defaultInspectorTab, document?.artifactId, currentVersion?.id]);

  useEffect(() => {
    if (!canEditDocument && inspectorTab === "edit") {
      setInspectorTab(defaultInspectorTab);
    }
  }, [canEditDocument, defaultInspectorTab, inspectorTab]);

  useEffect(() => {
    setDraftByBlockId(
      Object.fromEntries(
        editableBlocks.map((block) => [block.blockId, block.draft]),
      ),
    );
  }, [editableBlocks]);

  useEffect(() => {
    setRecoveryActionError(null);
  }, [document?.artifactId, document?.status, currentVersion?.id]);

  useEffect(() => {
    if (
      selectedEditBlockId &&
      editableBlocks.some((block) => block.blockId === selectedEditBlockId)
    ) {
      return;
    }

    setSelectedEditBlockId(editableBlocks[0]?.blockId ?? null);
  }, [editableBlocks, selectedEditBlockId]);

  const focusBlock = useCallback((blockId: string) => {
    const container = viewportRef.current;
    if (!container) {
      return;
    }
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>("[data-artifact-block-id]"),
    );
    const matched = candidates.find(
      (candidate) => candidate.dataset.artifactBlockId === blockId,
    );
    if (!matched) {
      return;
    }
    candidates.forEach((candidate) => {
      candidate.classList.remove("ring-2", "ring-sky-200", "rounded-[28px]");
    });
    matched.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    matched.classList.add("ring-2", "ring-sky-200", "rounded-[28px]");
    globalThis.setTimeout(() => {
      matched.classList.remove("ring-2", "ring-sky-200", "rounded-[28px]");
    }, 1800);
  }, [viewportRef]);

  useEffect(() => {
    if (!focusedBlockId || blockFocusRequestKey <= 0) {
      return;
    }

    if (inspectorTab === "edit") {
      setInspectorTab("overview");
    }

    focusBlock(focusedBlockId);
  }, [blockFocusRequestKey, focusBlock, focusedBlockId, inspectorTab]);

  const selectedEditableBlock = useMemo(
    () =>
      editableBlocks.find((block) => block.blockId === selectedEditBlockId) ||
      editableBlocks[0] ||
      null,
    [editableBlocks, selectedEditBlockId],
  );
  const selectedEditableDraft =
    selectedEditableBlock
      ? draftByBlockId[selectedEditableBlock.blockId] ??
        selectedEditableBlock.draft
      : null;
  const selectedTimelineLink = selectedEditableBlock
    ? timelineLinksByBlockId[selectedEditableBlock.blockId]?.[0] || null
    : null;

  const handleEditDraftChange = useCallback(
    (draft: EditableArtifactBlockDraft) => {
      if (!selectedEditableBlock) {
        return;
      }

      setDraftByBlockId((current) => ({
        ...current,
        [selectedEditableBlock.blockId]: draft,
      }));
    },
    [selectedEditableBlock],
  );

  const handleEditCancel = useCallback(() => {
    if (!selectedEditableBlock) {
      return;
    }

    setEditSaveError(null);
    setDraftByBlockId((current) => ({
      ...current,
      [selectedEditableBlock.blockId]: selectedEditableBlock.draft,
    }));
  }, [selectedEditableBlock]);

  const handleEditSave = useCallback(
    async (draft?: EditableArtifactBlockDraft) => {
      if (!document || !selectedEditableBlock || !onSaveArtifactDocument) {
        return;
      }

      const nextDraft = draft ?? selectedEditableDraft;
      if (!nextDraft) {
        return;
      }
      const nextDocument = replaceEditableArtifactBlockContent(
        document,
        selectedEditableBlock.blockId,
        nextDraft,
      );
      const versionedDocument = createArtifactDocumentNextVersion(
        document,
        nextDocument,
        {
          summary: `更新 ${selectedEditableBlock.label}`,
          createdBy: "user",
        },
      );

      setEditSaveError(null);
      setIsSavingEdit(true);

      try {
        await onSaveArtifactDocument(artifact, versionedDocument);
        setLastSavedAt(new Date().toISOString());
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "保存编辑结果失败";
        setEditSaveError(message);
        throw error instanceof Error ? error : new Error(message);
      } finally {
        setIsSavingEdit(false);
      }
    },
    [
      artifact,
      document,
      onSaveArtifactDocument,
      selectedEditableBlock,
      selectedEditableDraft,
    ],
  );

  const handleContinueEditing = useCallback(() => {
    if (!canEditDocument) {
      return;
    }

    setRecoveryActionError(null);
    setInspectorTab("edit");
    setSelectedEditBlockId((current) => current ?? editableBlocks[0]?.blockId ?? null);
  }, [canEditDocument, editableBlocks]);

  const handleMarkAsReady = useCallback(async () => {
    if (
      !document ||
      !onSaveArtifactDocument ||
      recoveryPresentation?.kind !== "recovered_draft"
    ) {
      return;
    }

    setRecoveryActionError(null);
    setIsUpdatingRecoveryState(true);

    try {
      await onSaveArtifactDocument(
        artifact,
        updateArtifactDocumentStatus(document, "ready"),
      );
      setLastSavedAt(new Date().toISOString());
    } catch (error) {
      setRecoveryActionError(
        error instanceof Error ? error.message : "标记为可阅读失败",
      );
    } finally {
      setIsUpdatingRecoveryState(false);
    }
  }, [artifact, document, onSaveArtifactDocument, recoveryPresentation]);

  const selectEditableBlock = useCallback((blockId: string) => {
    setInspectorTab("edit");
    setSelectedEditBlockId(blockId);
  }, []);

  return useMemo(
    () => ({
      artifact,
      document,
      currentVersion,
      currentVersionDiff,
      versionHistory,
      sourceLinks,
      timelineLinksByBlockId,
      recoveryPresentation,
      canEditDocument,
      canMarkAsReady,
      inspectorTab,
      setInspectorTab,
      editableBlocks,
      draftByBlockId,
      selectedEditableBlock,
      selectedEditableDraft,
      selectedTimelineLink,
      isSavingEdit,
      isUpdatingRecoveryState,
      editSaveError,
      recoveryActionError,
      lastSavedAt,
      rendererViewportRef: viewportRef,
      focusBlock,
      selectEditableBlock,
      handleEditDraftChange,
      handleEditCancel,
      handleEditSave,
      handleContinueEditing,
      handleMarkAsReady,
      onJumpToTimelineItem,
    }),
    [
      artifact,
      canEditDocument,
      canMarkAsReady,
      currentVersion,
      currentVersionDiff,
      document,
      draftByBlockId,
      editSaveError,
      editableBlocks,
      focusBlock,
      handleContinueEditing,
      handleEditCancel,
      handleEditDraftChange,
      handleEditSave,
      handleMarkAsReady,
      inspectorTab,
      isSavingEdit,
      isUpdatingRecoveryState,
      lastSavedAt,
      onJumpToTimelineItem,
      recoveryActionError,
      recoveryPresentation,
      selectEditableBlock,
      selectedEditableBlock,
      selectedEditableDraft,
      selectedTimelineLink,
      sourceLinks,
      timelineLinksByBlockId,
      versionHistory,
      viewportRef,
    ],
  );
}

interface ArtifactWorkbenchDocumentInspectorProps {
  controller: ArtifactWorkbenchDocumentController;
  containerClassName?: string;
  tabsClassName?: string;
  header?: React.ReactNode;
  testId?: string;
}

export const ArtifactWorkbenchDocumentInspector: React.FC<
  ArtifactWorkbenchDocumentInspectorProps
> = memo(
  ({
    controller,
    containerClassName,
    tabsClassName,
    header = null,
    testId,
  }) => {
    const {
      canEditDocument,
      canMarkAsReady,
      currentVersion,
      currentVersionDiff,
      document,
      draftByBlockId,
      editSaveError,
      editableBlocks,
      handleContinueEditing,
      handleMarkAsReady,
      inspectorTab,
      isSavingEdit,
      isUpdatingRecoveryState,
      lastSavedAt,
      recoveryActionError,
      recoveryPresentation,
      selectEditableBlock,
      selectedEditableBlock,
      setInspectorTab,
      sourceLinks,
      timelineLinksByBlockId,
      versionHistory,
      onJumpToTimelineItem,
    } = controller;

    return (
      <div data-testid={testId} className={containerClassName}>
        <Tabs
          value={inspectorTab}
          onValueChange={(value) =>
            setInspectorTab(value as ArtifactWorkbenchInspectorTab)
          }
          className={cn("flex h-full min-h-0 flex-col p-4", tabsClassName)}
        >
          {header}
          <TabsList
            className={cn(
              "grid h-auto w-full gap-1 bg-white p-1",
              canEditDocument ? "grid-cols-5" : "grid-cols-4",
            )}
          >
            <TabsTrigger value="overview" className="gap-2 px-2 text-xs">
              <ScrollText className="h-4 w-4" />
              概览
            </TabsTrigger>
            <TabsTrigger value="sources" className="gap-2 px-2 text-xs">
              <Link2 className="h-4 w-4" />
              来源
            </TabsTrigger>
            <TabsTrigger value="versions" className="gap-2 px-2 text-xs">
              <FileStack className="h-4 w-4" />
              版本
            </TabsTrigger>
            <TabsTrigger value="diff" className="gap-2 px-2 text-xs">
              <GitCompare className="h-4 w-4" />
              差异
            </TabsTrigger>
            {canEditDocument ? (
              <TabsTrigger value="edit" className="gap-2 px-2 text-xs">
                <FilePenLine className="h-4 w-4" />
                编辑
              </TabsTrigger>
            ) : null}
          </TabsList>
          <div className="mt-4 min-h-0 flex-1 overflow-auto pr-1">
            <TabsContent value="overview" className="mt-0">
              {document ? (
                <OverviewPanel
                  document={document}
                  currentVersion={currentVersion}
                  versionHistory={versionHistory}
                  sourceLinks={sourceLinks}
                  recoveryPresentation={recoveryPresentation}
                  canEditDocument={canEditDocument}
                  canMarkAsReady={canMarkAsReady}
                  isUpdatingRecoveryState={isUpdatingRecoveryState}
                  recoveryActionError={recoveryActionError}
                  onContinueEditing={handleContinueEditing}
                  onMarkAsReady={() => {
                    void handleMarkAsReady();
                  }}
                />
              ) : (
                <EmptyInspectorState
                  icon={<ScrollText className="h-4 w-4" />}
                  title="尚未解析出结构化文档"
                  detail="当前预览还没有命中 ArtifactDocument 协议，因此暂时只展示通用画布。"
                />
              )}
            </TabsContent>
            <TabsContent value="sources" className="mt-0">
              <SourcesPanel
                links={sourceLinks}
                sources={document?.sources || []}
                onSelectBlock={(blockId) => {
                  setInspectorTab("sources");
                  controller.focusBlock(blockId);
                }}
                resolveTimelineLink={(blockId) =>
                  timelineLinksByBlockId[blockId]?.[0] || null
                }
                onSelectTimelineItem={onJumpToTimelineItem}
              />
            </TabsContent>
            <TabsContent value="versions" className="mt-0">
              <VersionsPanel
                currentVersion={currentVersion}
                versionHistory={versionHistory}
              />
            </TabsContent>
            <TabsContent value="diff" className="mt-0">
              <DiffPanel
                diff={currentVersionDiff}
                onSelectBlock={(blockId) => {
                  setInspectorTab("diff");
                  controller.focusBlock(blockId);
                }}
                resolveTimelineLink={(blockId) =>
                  timelineLinksByBlockId[blockId]?.[0] || null
                }
                onSelectTimelineItem={onJumpToTimelineItem}
              />
            </TabsContent>
            {canEditDocument ? (
              <TabsContent value="edit" className="mt-0">
                <EditInspectorPanel
                  editableBlocks={editableBlocks}
                  selectedBlockId={selectedEditableBlock?.blockId ?? null}
                  draftByBlockId={draftByBlockId}
                  saveError={editSaveError}
                  lastSavedAt={lastSavedAt}
                  isSaving={isSavingEdit}
                  onSelectBlock={selectEditableBlock}
                />
              </TabsContent>
            ) : null}
          </div>
        </Tabs>
      </div>
    );
  },
);
ArtifactWorkbenchDocumentInspector.displayName =
  "ArtifactWorkbenchDocumentInspector";
