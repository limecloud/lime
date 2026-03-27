import React, {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  BookMarked,
  FilePenLine,
  FileClock,
  FileStack,
  GitCompare,
  Info,
  Link2,
  Save,
  ScrollText,
  RotateCcw,
} from "lucide-react";
import {
  ArtifactCanvasOverlay,
  ArtifactRenderer,
  ArtifactToolbar,
} from "@/components/artifact";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  resolveArtifactDocumentCurrentVersion,
  resolveArtifactDocumentCurrentVersionDiff,
  resolveArtifactDocumentSourceLinks,
  resolveArtifactDocumentVersionHistory,
  extractPortableText,
  type ArtifactDocumentBlock,
  type ArtifactDocumentSource,
  type ArtifactDocumentVersionDiff,
  type ArtifactDocumentSourceLink,
  type ArtifactDocumentV1,
  type ArtifactDocumentVersionSummary,
} from "@/lib/artifact-document";
import { resolveArtifactProtocolDocumentPayload } from "@/lib/artifact-protocol";
import type { Artifact } from "@/lib/artifact/types";
import { buildCanvasWorkbenchDiff } from "@/components/agent/chat/utils/canvasWorkbenchDiff";
import { updateArtifactDocumentStatus } from "./artifactWorkbenchActions";
import type { AgentThreadItem } from "../types";
import {
  buildArtifactTimelineLinkIndex,
  type ArtifactTimelineLink,
} from "../utils/artifactTimelineNavigation";
import { cn } from "@/lib/utils";
import {
  NotionEditor,
  type NotionEditorHandle,
} from "@/components/content-creator/canvas/document/editor";

interface ArtifactWorkbenchShellProps {
  artifact: Artifact;
  artifactOverlay: React.ComponentProps<typeof ArtifactCanvasOverlay>["overlay"] | null;
  isStreaming: boolean;
  showPreviousVersionBadge: boolean;
  viewMode: React.ComponentProps<typeof ArtifactToolbar>["viewMode"];
  onViewModeChange: NonNullable<
    React.ComponentProps<typeof ArtifactToolbar>["onViewModeChange"]
  >;
  previewSize: React.ComponentProps<typeof ArtifactToolbar>["previewSize"];
  onPreviewSizeChange: NonNullable<
    React.ComponentProps<typeof ArtifactToolbar>["onPreviewSizeChange"]
  >;
  onSaveArtifactDocument?: (
    artifact: Artifact,
    document: ArtifactDocumentV1,
  ) => Promise<void> | void;
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
  onCloseCanvas: () => void;
  actionsSlot?: React.ReactNode;
}

interface EditableArtifactBlockEntry {
  blockId: string;
  label: string;
  detail?: string;
  editorKind: EditableArtifactBlockDraft["editorKind"];
  draft: EditableArtifactBlockDraft;
}

type EditableArtifactBlockDraft =
  | {
      editorKind: "rich_text";
      markdown: string;
    }
  | {
      editorKind: "section_header";
      title: string;
      description: string;
    }
  | {
      editorKind: "hero_summary";
      eyebrow: string;
      title: string;
      summary: string;
      highlights: string;
    }
  | {
      editorKind: "callout";
      title: string;
      body: string;
      tone: string;
    };

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
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
    normalizeText(source?.title) ||
    normalizeText(source?.url) ||
    link.sourceRef
  );
}

function resolveSourceMeta(
  link: ArtifactDocumentSourceLink,
  source?: ArtifactDocumentSource,
): string | undefined {
  return (
    normalizeText(source?.note) ||
    normalizeText(source?.quote) ||
    normalizeText(source?.publishedAt) ||
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

interface ArtifactRecoveryPresentation {
  kind: "recovered_draft" | "recovered_failed" | "repaired_structure";
  tone: "info" | "warning";
  title: string;
  detail: string;
  badgeLabel: string;
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

  if (
    document.status === "draft" &&
    (fallbackUsed || recoveredFromMarkdown)
  ) {
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

function resolveRichTextContent(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.markdown) ||
    normalizeText(block.text) ||
    normalizeText(block.content) ||
    extractPortableText(block.content) ||
    extractPortableText(block.tiptap) ||
    extractPortableText(block.proseMirror) ||
    ""
  );
}

function resolveCalloutContent(block: ArtifactDocumentBlock): string {
  return (
    normalizeText(block.content) ||
    normalizeText(block.text) ||
    extractPortableText(block.content) ||
    ""
  );
}

function normalizeHighlightsDraft(value: string): string {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
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
  const entries: EditableArtifactBlockEntry[] = [];

  for (const block of document.blocks) {
    if (block.type === "section_header") {
      sectionHeaderIndex += 1;
      currentSectionLabel = normalizeText(block.title) || currentSectionLabel;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `章节 ${sectionHeaderIndex}`,
        detail: "章节标题",
        editorKind: "section_header",
        draft: {
          editorKind: "section_header",
          title: normalizeText(block.title) || "",
          description: normalizeText(block.description) || "",
        },
      });
      continue;
    }

    if (block.type === "hero_summary") {
      heroSummaryIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `摘要卡 ${heroSummaryIndex}`,
        detail: currentSectionLabel || "摘要卡",
        editorKind: "hero_summary",
        draft: {
          editorKind: "hero_summary",
          eyebrow: normalizeText(block.eyebrow) || "",
          title: normalizeText(block.title) || "",
          summary: normalizeText(block.summary) || "",
          highlights: normalizeStringArray(block.highlights).join("\n"),
        },
      });
      continue;
    }

    if (block.type === "callout") {
      calloutIndex += 1;
      entries.push({
        blockId: block.id,
        label: normalizeText(block.title) || `提示块 ${calloutIndex}`,
        detail: currentSectionLabel || "提示信息",
        editorKind: "callout",
        draft: {
          editorKind: "callout",
          title: normalizeText(block.title) || "",
          body: resolveCalloutContent(block),
          tone:
            normalizeText(block.tone) ||
            normalizeText(block.variant) ||
            "",
        },
      });
      continue;
    }

    if (block.type === "rich_text") {
      richTextIndex += 1;
      entries.push({
        blockId: block.id,
        label:
          normalizeText(block.title) ||
          currentSectionLabel ||
          `正文块 ${richTextIndex}`,
        detail: currentSectionLabel,
        editorKind: "rich_text",
        draft: {
          editorKind: "rich_text",
          markdown: resolveRichTextContent(block),
        },
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
          summary: summary || undefined,
          highlights: highlights.length > 0 ? highlights : undefined,
        };
      }

      if (block.type === "callout" && draft.editorKind === "callout") {
        const title = draft.title.trim();
        const body = draft.body.trim();
        const tone = draft.tone.trim();
        return {
          ...block,
          title: title || undefined,
          content: body || undefined,
          text: body || undefined,
          tone: tone || undefined,
          variant: tone || undefined,
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
  }) => {
  return (
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
  );
});
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
        sourceType: normalizeText(source.kind) || "unknown",
        sourceRef: source.url || source.id,
        label: source.title,
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

const ArtifactEditSurface: React.FC<{
  entry: EditableArtifactBlockEntry | null;
  draft: EditableArtifactBlockDraft | null;
  timelineLink?: ArtifactTimelineLink | null;
  isSaving: boolean;
  isStreaming: boolean;
  onChange: (draft: EditableArtifactBlockDraft) => void;
  onSave: (draft?: EditableArtifactBlockDraft) => Promise<void> | void;
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
    onCancel,
    onJumpToTimelineItem,
  }) => {
    const editorRef = useRef<NotionEditorHandle | null>(null);

    const handleSave = useCallback(() => {
      if (!entry || !draft) {
        return;
      }

      if (entry.editorKind === "rich_text" && draft.editorKind === "rich_text") {
        const latestDraft: EditableArtifactBlockDraft = {
          ...draft,
          markdown: editorRef.current?.flushContent() ?? draft.markdown,
        };
        onChange(latestDraft);
        void onSave(latestDraft);
        return;
      }

      void onSave(draft);
    }, [draft, entry, onChange, onSave]);

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
                    onChange(nextDraft);
                    void onSave(nextDraft);
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
                </div>
              )}
          </div>
        </div>
      </div>
    );
  },
);
ArtifactEditSurface.displayName = "ArtifactEditSurface";

export const ArtifactWorkbenchShell: React.FC<ArtifactWorkbenchShellProps> = memo(
  ({
    artifact,
    artifactOverlay,
    isStreaming,
    showPreviousVersionBadge,
    viewMode,
    onViewModeChange,
    previewSize,
    onPreviewSizeChange,
    onSaveArtifactDocument,
    threadItems = [],
    focusedBlockId = null,
    blockFocusRequestKey = 0,
    onJumpToTimelineItem,
    onCloseCanvas,
    actionsSlot,
  }) => {
    const rendererViewportRef = useRef<HTMLDivElement>(null);
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
    const defaultInspectorTab =
      currentVersionDiff?.changedBlocks.length
        ? "diff"
        : sourceLinks.length > 0
        ? "sources"
        : versionHistory.length > 0 || currentVersion
          ? "versions"
          : "overview";
    const [inspectorTab, setInspectorTab] = useState(defaultInspectorTab);
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
      const container = rendererViewportRef.current;
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
    }, []);

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
        if (
          !document ||
          !selectedEditableBlock ||
          !onSaveArtifactDocument
        ) {
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

        setEditSaveError(null);
        setIsSavingEdit(true);

        try {
          await onSaveArtifactDocument(artifact, nextDocument);
          setLastSavedAt(new Date().toISOString());
        } catch (error) {
          setEditSaveError(
            error instanceof Error ? error.message : "保存编辑结果失败",
          );
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

    return (
      <div
        data-testid="artifact-workbench-shell"
        className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5"
      >
        <ArtifactToolbar
          artifact={artifact}
          onClose={onCloseCanvas}
          isStreaming={isStreaming}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          previewSize={previewSize}
          onPreviewSizeChange={onPreviewSizeChange}
          tone="light"
          displayBadgeLabel={showPreviousVersionBadge ? "预览上一版本" : undefined}
          actionsSlot={actionsSlot}
        />
        <div
          className={cn(
            "grid min-h-0 flex-1",
            canEditDocument
              ? "lg:grid-cols-[minmax(0,1fr)_360px]"
              : "lg:grid-cols-[minmax(0,1fr)_320px]",
          )}
        >
          <div
            ref={rendererViewportRef}
            className={cn(
              "relative min-h-0 bg-white lg:border-r lg:border-slate-200",
              inspectorTab === "edit" && canEditDocument
                ? "overflow-hidden"
                : "overflow-auto",
            )}
          >
            {inspectorTab === "edit" && canEditDocument ? (
              <ArtifactEditSurface
                entry={selectedEditableBlock}
                draft={selectedEditableDraft}
                timelineLink={selectedTimelineLink}
                isSaving={isSavingEdit}
                isStreaming={isStreaming}
                onChange={handleEditDraftChange}
                onSave={handleEditSave}
                onCancel={handleEditCancel}
                onJumpToTimelineItem={onJumpToTimelineItem}
              />
            ) : (
              <>
                <ArtifactRenderer
                  artifact={artifact}
                  isStreaming={isStreaming}
                  hideToolbar={true}
                  viewMode={viewMode}
                  previewSize={previewSize}
                  tone="light"
                />
                {artifactOverlay ? <ArtifactCanvasOverlay overlay={artifactOverlay} /> : null}
              </>
            )}
          </div>
          <aside className="min-h-0 border-t border-slate-200 bg-slate-50/70 lg:border-t-0">
            <Tabs
              value={inspectorTab}
              onValueChange={setInspectorTab}
              className="flex h-full min-h-0 flex-col p-4"
            >
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
                      canMarkAsReady={Boolean(
                        onSaveArtifactDocument &&
                          recoveryPresentation?.kind === "recovered_draft",
                      )}
                      isUpdatingRecoveryState={isUpdatingRecoveryState}
                      recoveryActionError={recoveryActionError}
                      onContinueEditing={handleContinueEditing}
                      onMarkAsReady={() => {
                        void handleMarkAsReady();
                      }}
                    />
                  ) : (
                    <EmptyInspectorState
                      icon={<BookMarked className="h-4 w-4" />}
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
                      focusBlock(blockId);
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
                      focusBlock(blockId);
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
                      onSelectBlock={(blockId) => {
                        setInspectorTab("edit");
                        setSelectedEditBlockId(blockId);
                      }}
                    />
                  </TabsContent>
                ) : null}
              </div>
            </Tabs>
          </aside>
        </div>
      </div>
    );
  },
);
ArtifactWorkbenchShell.displayName = "ArtifactWorkbenchShell";
