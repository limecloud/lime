import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  extractLimeToolMetadataBlock,
  normalizeToolResultImages,
} from "../hooks/agentChatToolResult";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { SiteSavedContentTarget } from "../types";
import {
  buildToolHeadline,
  getToolDisplayInfo,
  humanizeToolName,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
} from "../utils/toolDisplayInfo";
import {
  normalizeSiteToolResultSummary,
  resolveSiteAdapterSourceLabel,
  resolveSiteSavedContentTargetRelativePath,
  resolveSiteProjectSourceLabel,
  resolveSiteSavedContentTargetFromMetadata,
} from "../utils/siteToolResultSummary";

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

function buildSiteNoticeLines(toolCall: ToolCallState): string[] {
  const summary = normalizeSiteToolResultSummary(toolCall.result?.metadata);
  if (!summary) {
    return [];
  }

  const lines: string[] = [];
  const savedProjectId =
    summary.savedProjectId || summary.savedContent?.projectId || "";
  const savedSourceLabel = resolveSiteProjectSourceLabel(summary.savedBy || "");

  if (summary.savedContent?.title) {
    let line = `已保存：${summary.savedContent.title}`;
    if (savedProjectId) {
      line += ` · 项目 ${savedProjectId}`;
    }
    if (savedSourceLabel) {
      line += ` · ${savedSourceLabel}`;
    }
    lines.push(line);
  }

  if (summary.savedContent?.markdownRelativePath) {
    lines.push(`Markdown：${summary.savedContent.markdownRelativePath}`);
  }

  if (typeof summary.savedContent?.imageCount === "number") {
    const imageDir = summary.savedContent.imagesRelativeDir;
    lines.push(
      `图片：${summary.savedContent.imageCount} 张${
        imageDir ? ` · ${imageDir}` : ""
      }`,
    );
  }

  if (summary.saveSkippedProjectId) {
    const skippedSourceLabel = resolveSiteProjectSourceLabel(
      summary.saveSkippedBy || "",
    );
    let line = `未写入项目 ${summary.saveSkippedProjectId}`;
    if (skippedSourceLabel) {
      line += ` · ${skippedSourceLabel}`;
    }
    lines.push(line);
  }

  if (summary.saveErrorMessage) {
    lines.push(`自动保存失败：${summary.saveErrorMessage}`);
  }

  const adapterSourceLabel = resolveSiteAdapterSourceLabel(summary);
  if (adapterSourceLabel) {
    lines.push(`脚本来源：${adapterSourceLabel}`);
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
  const rawToolNameLabel = useMemo(() => {
    if (
      toolDisplay.family === "generic" &&
      toolDisplay.label !== humanizeToolName(toolCall.name)
    ) {
      return humanizeToolName(toolCall.name);
    }
    return null;
  }, [toolCall.name, toolDisplay.family, toolDisplay.label]);
  const resultText = useMemo(() => {
    const rawText = toolCall.result?.error || toolCall.result?.output || "";
    return extractLimeToolMetadataBlock(rawText).text.trim();
  }, [toolCall.result?.error, toolCall.result?.output]);
  const resultPreview = useMemo(
    () => summarizeResultText(resultText),
    [resultText],
  );
  const resultImages = useMemo(
    () => normalizeToolResultImages(toolCall.result?.images, resultText) || [],
    [resultText, toolCall.result?.images],
  );
  const savedSiteContentTarget = useMemo(
    () => resolveSiteSavedContentTargetFromMetadata(toolCall.result?.metadata),
    [toolCall.result?.metadata],
  );
  const savedSiteContentRelativePath = useMemo(
    () => resolveSiteSavedContentTargetRelativePath(savedSiteContentTarget),
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
  const hasDetails =
    Boolean(resultText) ||
    resultImages.length > 0 ||
    siteNoticeLines.length > 0 ||
    Boolean(savedSiteContentTarget) ||
    Boolean(skillTitle && skillTitle !== subject);

  useEffect(() => {
    if (
      toolCall.status === "running" ||
      isMessageStreaming ||
      siteNoticeLines.length > 0
    ) {
      setExpanded(true);
    }
  }, [isMessageStreaming, siteNoticeLines.length, toolCall.status]);

  const statusLabel =
    toolCall.status === "running"
      ? "执行中"
      : toolCall.status === "failed"
        ? "执行失败"
        : "执行完成";

  const detailBadges = [
    isPreload ? "系统预执行" : null,
    skillTitle && skillTitle !== subject ? `技能：${skillTitle}` : null,
    statusLabel,
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
              {rawToolNameLabel ? (
                <div className="mt-0.5 truncate text-[11px] leading-5 text-slate-400">
                  {rawToolNameLabel}
                </div>
              ) : null}
              {!expanded && resultPreview ? (
                <div className="mt-1 text-xs leading-5 text-slate-600">
                  {resultPreview}
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
                        {savedSiteContentTarget.preferredTarget === "project_file"
                          ? "在下方预览导出 Markdown"
                          : "打开已保存内容"}
                      </span>
                      {savedSiteContentRelativePath ? (
                        <span className="block truncate text-[11px] leading-5 text-emerald-700/80">
                          {savedSiteContentRelativePath}
                        </span>
                      ) : null}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                  </button>
                </div>
              ) : null}

              {resultText ? (
                <div className="text-sm leading-6 text-slate-700">
                  <MarkdownRenderer content={resultText} />
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
