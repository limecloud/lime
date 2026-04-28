import React, { useCallback, useEffect, useMemo, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronDown, ExternalLink, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SearchResultPreviewList } from "./SearchResultPreviewList";
import { ToolSearchSummaryPanel } from "./ToolSearchSummaryPanel";
import {
  extractLimeToolMetadataBlock,
  normalizeToolResultImages,
} from "../hooks/agentChatToolResult";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { SiteSavedContentTarget } from "../types";
import {
  buildToolHeadline,
  getToolDisplayInfo,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
} from "../utils/toolDisplayInfo";
import {
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
} from "../utils/searchResultPreview";
import {
  normalizeSiteToolResultSummary,
  resolveSiteProjectTargetLabel,
  resolveSiteSavedContentTargetDisplayName,
  resolveSiteSavedContentTargetRelativePath,
  resolveSiteSavedContentTargetFromMetadata,
} from "../utils/siteToolResultSummary";
import {
  normalizeToolSearchResultSummary,
  resolveUserFacingToolSearchItemLabel,
} from "../utils/toolSearchResultSummary";
import {
  resolveToolErrorDetailText,
  resolveToolProcessNarrative,
} from "../utils/toolProcessSummary";

interface InlineToolProcessStepProps {
  toolCall: ToolCallState;
  grouped?: boolean;
  groupMarker?: string;
  isMessageStreaming?: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function summarizeResultText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const singleLine = trimmed.replace(/\s+/g, " ");
  if (singleLine.length <= 180) {
    return singleLine;
  }
  return `${singleLine.slice(0, 180).trim()}...`;
}

const LARGE_RESULT_AUTO_COLLAPSE_CHARS = 1200;
function sanitizeToolResultDetailMarkdown(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function summarizeToolSearchPreview(
  value: ReturnType<typeof normalizeToolSearchResultSummary>,
): string | null {
  if (!value) {
    return null;
  }

  const toolNames = value.tools
    .slice(0, 2)
    .map((item) => resolveUserFacingToolSearchItemLabel(item.name))
    .filter(Boolean);
  const prefix = `找到工具 ${value.count} 个`;

  if (toolNames.length === 0) {
    return prefix;
  }

  return `${prefix} · ${toolNames.join(" · ")}`;
}

function summarizeSearchResultPreview(resultCount: number): string | null {
  if (resultCount <= 0) {
    return null;
  }

  return `找到 ${resultCount} 条搜索结果`;
}

function normalizeSummaryLine(
  value: string | null,
  headline: string,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const normalizedHeadline = headline.trim();
  if (normalized === normalizedHeadline) {
    return null;
  }

  return normalized;
}

function buildSiteNoticeLines(toolCall: ToolCallState): string[] {
  const summary = normalizeSiteToolResultSummary(toolCall.result?.metadata);
  if (!summary) {
    return [];
  }

  const lines: string[] = [];
  const savedProjectId =
    summary.savedProjectId || summary.savedContent?.projectId || "";
  const savedProjectTarget = resolveSiteProjectTargetLabel({
    source: summary.savedBy,
    projectId: savedProjectId || undefined,
  });

  if (summary.savedContent?.title) {
    lines.push(`已保存到${savedProjectTarget}：${summary.savedContent.title}`);
  }

  if (summary.savedContent?.markdownRelativePath) {
    lines.push("已导出 Markdown 文稿");
  }

  if (typeof summary.savedContent?.imageCount === "number") {
    lines.push(`附带图片 ${summary.savedContent.imageCount} 张`);
  }

  if (summary.saveSkippedProjectId) {
    const skippedProjectTarget = resolveSiteProjectTargetLabel({
      source: summary.saveSkippedBy,
      projectId: summary.saveSkippedProjectId,
    });
    lines.push(`未保存到${skippedProjectTarget}`);
  }

  if (summary.saveErrorMessage) {
    lines.push(`自动保存失败：${summary.saveErrorMessage}`);
  }

  return lines;
}

export const InlineToolProcessStep: React.FC<InlineToolProcessStepProps> = ({
  toolCall,
  grouped = false,
  groupMarker = "•",
  isMessageStreaming = false,
  onFileClick,
  onOpenSavedSiteContent,
}) => {
  const [expanded, setExpanded] = useState(false);

  const parsedArgs = useMemo(
    () => parseToolCallArguments(toolCall.arguments),
    [toolCall.arguments],
  );
  const toolDisplay = useMemo(
    () => getToolDisplayInfo(toolCall.name, toolCall.status),
    [toolCall.name, toolCall.status],
  );
  const ToolIcon = toolDisplay.icon;
  const metadata = useMemo(
    () => asRecord(toolCall.result?.metadata),
    [toolCall.result?.metadata],
  );
  const filePath = useMemo(() => resolveToolFilePath(parsedArgs), [parsedArgs]);
  const fileContent = useMemo(() => {
    const content = parsedArgs.content || parsedArgs.text;
    return content ? String(content) : "";
  }, [parsedArgs.content, parsedArgs.text]);
  const subject = useMemo(
    () => resolveToolPrimarySubject(toolCall.name, parsedArgs, filePath),
    [filePath, parsedArgs, toolCall.name],
  );
  const headline = useMemo(
    () =>
      buildToolHeadline({
        toolDisplay,
        subject,
        toolName: toolCall.name,
      }),
    [subject, toolCall.name, toolDisplay],
  );
  const rawResultText = useMemo(() => {
    const rawText = toolCall.result?.error || toolCall.result?.output || "";
    return extractLimeToolMetadataBlock(rawText).text.trim();
  }, [toolCall.result?.error, toolCall.result?.output]);
  const resultText = useMemo(() => {
    if (toolCall.status !== "failed") {
      return rawResultText;
    }

    return (
      resolveToolErrorDetailText(toolCall.name, rawResultText) || rawResultText
    );
  }, [rawResultText, toolCall.name, toolCall.status]);
  const resultDetailMarkdown = useMemo(
    () => sanitizeToolResultDetailMarkdown(resultText),
    [resultText],
  );
  const resultPreview = useMemo(
    () => summarizeResultText(resultText),
    [resultText],
  );
  const resultImages = useMemo(
    () =>
      normalizeToolResultImages(toolCall.result?.images, rawResultText) || [],
    [rawResultText, toolCall.result?.images],
  );
  const isToolSearch = useMemo(
    () => normalizeToolNameKey(toolCall.name) === "toolsearch",
    [toolCall.name],
  );
  const toolSearchSummary = useMemo(
    () =>
      isToolSearch ? normalizeToolSearchResultSummary(rawResultText) : null,
    [isToolSearch, rawResultText],
  );
  const searchResultItems = useMemo(() => {
    if (!isUnifiedWebSearchToolName(toolCall.name)) {
      return [];
    }

    return resolveSearchResultPreviewItemsFromText(rawResultText);
  }, [rawResultText, toolCall.name]);
  const structuredResultPreview = useMemo(() => {
    if (toolSearchSummary) {
      return summarizeToolSearchPreview(toolSearchSummary);
    }
    if (searchResultItems.length > 0) {
      return summarizeSearchResultPreview(searchResultItems.length);
    }
    return resultPreview;
  }, [resultPreview, searchResultItems.length, toolSearchSummary]);
  const processNarrative = useMemo(
    () => resolveToolProcessNarrative(toolCall),
    [toolCall],
  );
  const savedSiteContentTarget = useMemo(
    () => resolveSiteSavedContentTargetFromMetadata(toolCall.result?.metadata),
    [toolCall.result?.metadata],
  );
  const savedSiteContentDisplayName = useMemo(
    () =>
      resolveSiteSavedContentTargetDisplayName(savedSiteContentTarget) ||
      resolveSiteSavedContentTargetRelativePath(savedSiteContentTarget),
    [savedSiteContentTarget],
  );
  const siteNoticeLines = useMemo(
    () => buildSiteNoticeLines(toolCall),
    [toolCall],
  );
  const skillTitle =
    readString(asRecord(parsedArgs), ["skill_title", "skillTitle"]) ||
    readString(metadata, ["skill_title", "skillTitle"]);
  const isPreload =
    metadata?.execution_origin === "preload" || metadata?.preload === true;
  const hasOpenableFile = Boolean(filePath && onFileClick);
  const processSummary = useMemo(() => {
    const preferredSummary =
      toolCall.status === "running"
        ? processNarrative.preSummary
        : processNarrative.postSource === "generic" && structuredResultPreview
          ? structuredResultPreview
          : processNarrative.postSummary ||
            structuredResultPreview ||
            processNarrative.preSummary;

    return normalizeSummaryLine(preferredSummary, headline);
  }, [
    headline,
    processNarrative.postSource,
    processNarrative.postSummary,
    processNarrative.preSummary,
    structuredResultPreview,
    toolCall.status,
  ]);
  const hasDetails =
    Boolean(resultText) ||
    resultImages.length > 0 ||
    searchResultItems.length > 0 ||
    Boolean(toolSearchSummary) ||
    siteNoticeLines.length > 0 ||
    Boolean(savedSiteContentTarget) ||
    Boolean(skillTitle && skillTitle !== subject);

  const handleOpenExternalUrl = useCallback(async (url: string) => {
    try {
      await openExternal(url);
    } catch {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(url, "_blank");
      }
    }
  }, []);

  useEffect(() => {
    if (toolCall.status === "running" || siteNoticeLines.length > 0) {
      setExpanded(true);
      return;
    }

    if (isMessageStreaming && !toolSearchSummary) {
      setExpanded(resultText.length <= LARGE_RESULT_AUTO_COLLAPSE_CHARS);
    }
  }, [
    isMessageStreaming,
    resultText.length,
    siteNoticeLines.length,
    toolCall.status,
    toolSearchSummary,
  ]);

  const detailBadges = [
    isPreload ? "系统预执行" : null,
    skillTitle && skillTitle !== subject ? `技能：${skillTitle}` : null,
    toolCall.status === "running"
      ? "执行中"
      : toolCall.status === "failed"
        ? "执行失败"
        : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      className="py-1"
      data-testid="inline-tool-process-step"
      data-grouped={grouped ? "yes" : "no"}
    >
      <div className="flex items-start gap-2">
        {grouped ? (
          <span className="pt-0.5 font-mono text-xs text-slate-400">
            {groupMarker}
          </span>
        ) : null}
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          {toolCall.status === "running" ? (
            <Loader2 className="h-4 w-4 animate-spin text-sky-600" />
          ) : (
            <ToolIcon
              className={cn(
                "h-4 w-4",
                toolCall.status === "completed" && "text-emerald-600",
                toolCall.status === "failed" && "text-rose-600",
                toolCall.status !== "completed" &&
                  toolCall.status !== "failed" &&
                  "text-slate-500",
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              className={cn(
                "min-w-0 flex-1 text-left",
                hasDetails && "cursor-pointer",
              )}
              onClick={() => {
                if (hasDetails) {
                  setExpanded((current) => !current);
                }
              }}
              aria-expanded={hasDetails ? expanded : undefined}
            >
              <div className="truncate text-sm font-medium leading-6 text-slate-800">
                {headline}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-slate-500">
                {detailBadges.map((badge) => (
                  <span key={badge}>{badge}</span>
                ))}
              </div>
              {processSummary ? (
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  {processSummary}
                </div>
              ) : !expanded && structuredResultPreview ? (
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  {structuredResultPreview}
                </div>
              ) : null}
            </button>

            <div className="flex shrink-0 items-center gap-1 pt-0.5">
              {hasOpenableFile ? (
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title="在画布中打开"
                  aria-label={`在画布中打开-${filePath}`}
                  onClick={() => {
                    if (filePath && onFileClick) {
                      onFileClick(filePath, fileContent);
                    }
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {hasDetails ? (
                <button
                  type="button"
                  className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  title={expanded ? "收起过程详情" : "展开过程详情"}
                  onClick={() => setExpanded((current) => !current)}
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
              ) : null}
            </div>
          </div>

          {expanded && hasDetails ? (
            <div className="ml-1 mt-2 space-y-2 border-l border-slate-200 pl-3">
              {siteNoticeLines.length > 0 ? (
                <div className="space-y-1 text-xs leading-5 text-slate-600">
                  {siteNoticeLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              ) : null}

              {savedSiteContentTarget && onOpenSavedSiteContent ? (
                <div>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50/70 px-3 py-2 text-left transition-colors hover:bg-emerald-100/70"
                    onClick={() =>
                      onOpenSavedSiteContent(savedSiteContentTarget)
                    }
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700">
                      <FileText className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium leading-5 text-emerald-900">
                        {savedSiteContentTarget.preferredTarget ===
                        "project_file"
                          ? "在下方预览导出 Markdown"
                          : "打开已保存内容"}
                      </span>
                      {savedSiteContentDisplayName ? (
                        <span className="block truncate text-[11px] leading-5 text-emerald-700/80">
                          {savedSiteContentDisplayName}
                        </span>
                      ) : null}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                  </button>
                </div>
              ) : null}

              {toolSearchSummary ? (
                <ToolSearchSummaryPanel
                  summary={toolSearchSummary}
                  testId="inline-tool-process-tool-search-result"
                />
              ) : null}

              {!toolSearchSummary && searchResultItems.length > 0 ? (
                <SearchResultPreviewList
                  items={searchResultItems}
                  onOpenUrl={handleOpenExternalUrl}
                  popoverSide="bottom"
                  popoverAlign="start"
                  className="max-w-2xl"
                />
              ) : null}

              {!toolSearchSummary &&
              searchResultItems.length === 0 &&
              resultText ? (
                <div className="text-sm leading-6 text-slate-700">
                  <MarkdownRenderer content={resultDetailMarkdown} />
                </div>
              ) : null}

              {resultImages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {resultImages.map((image, index) => (
                    <img
                      key={`${image.src.slice(0, 48)}-${index}`}
                      src={image.src}
                      alt="工具结果图片"
                      className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                      loading="lazy"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default InlineToolProcessStep;
