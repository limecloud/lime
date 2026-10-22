import React, { useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FolderTree,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { renderDiffReviewLineForCanvas } from "../utils/diffReview";
import type {
  DiffReviewFile,
  DiffReviewScopeItem,
  DiffReviewSummary,
} from "../utils/diffReview";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type {
  CommandOutputStream,
  CommandToolSummary,
  ToolResultNotice,
} from "./ToolCallDisplayViewModel";

interface ToolCallDisplayResultPanelProps {
  toolCallId: string;
  commandSummary: CommandToolSummary | null;
  commandOutputStreams: CommandOutputStream[];
  commandSurfaceLabel: string | null;
  commandEncoding: string | null;
  commandDecodedWithLabel: string | null;
  diffReviewSummary: DiffReviewSummary | null;
  diffReviewScopeItems: DiffReviewScopeItem[];
  expandedDiffFileIds: Record<string, boolean>;
  onToggleDiffFileExpanded: (fileId: string) => void;
  onOpenChangedFile: (file: DiffReviewFile) => void;
  canOpenChangedFile: boolean;
  resultMetaItems: string[];
  siteResultNotices: ToolResultNotice[];
  showOpenSavedSiteContent: boolean;
  onOpenSavedSiteContent: () => void;
  openSavedSiteContentLabel: string;
  resultPath?: {
    label: string;
    value: string;
    displayValue: string;
  };
  isResultFailure: boolean;
  renderedResultContent: string;
}

export function ToolCallDisplayResultPanel({
  toolCallId,
  commandSummary,
  commandOutputStreams,
  commandSurfaceLabel,
  commandEncoding,
  commandDecodedWithLabel,
  diffReviewSummary,
  diffReviewScopeItems,
  expandedDiffFileIds,
  onToggleDiffFileExpanded,
  onOpenChangedFile,
  canOpenChangedFile,
  resultMetaItems,
  siteResultNotices,
  showOpenSavedSiteContent,
  onOpenSavedSiteContent,
  openSavedSiteContentLabel,
  resultPath,
  isResultFailure,
  renderedResultContent,
}: ToolCallDisplayResultPanelProps) {
  const { t } = useTranslation("agent");
  const [copiedDiffFileId, setCopiedDiffFileId] = useState<string | null>(null);
  const copyDiffFile = async (file: DiffReviewFile) => {
    const content = file.lines.map(renderDiffReviewLineForCanvas).join("\n");
    try {
      await navigator.clipboard.writeText(content);
      setCopiedDiffFileId(file.id);
    } catch {
      setCopiedDiffFileId(null);
    }
  };

  return (
    <div
      className="mb-2 ml-6 mt-1.5 space-y-2"
      data-testid="tool-call-result-panel"
    >
      {commandSummary ? (
        <div
          className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2"
          data-testid="tool-call-command-summary"
        >
          <div className="text-[11px] font-semibold text-slate-700">
            {t("agentChat.toolCall.commandSummary.title")}
          </div>
          <div className="mt-1 space-y-1 text-[11px] text-slate-600">
            {commandSummary.command ? (
              <div className="flex min-w-0 gap-1.5">
                <span className="shrink-0 text-slate-500">
                  {t("agentChat.toolCall.commandSummary.command")}
                </span>
                <code className="min-w-0 break-all rounded bg-white px-1 py-0.5 font-mono text-[11px] text-slate-800">
                  {commandSummary.command}
                </code>
              </div>
            ) : null}
            {commandSummary.cwd ? (
              <div className="flex min-w-0 gap-1.5">
                <span className="shrink-0 text-slate-500">
                  {t("agentChat.toolCall.commandSummary.cwd")}
                </span>
                <span className="min-w-0 break-all text-slate-700">
                  {commandSummary.cwd}
                </span>
              </div>
            ) : null}
            {commandSummary.shell ? (
              <div className="flex min-w-0 gap-1.5">
                <span className="shrink-0 text-slate-500">
                  {t("agentChat.toolCall.commandSummary.shell")}
                </span>
                <code className="min-w-0 break-all rounded bg-white px-1 py-0.5 font-mono text-[11px] text-slate-800">
                  {commandSummary.shell}
                </code>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {commandSummary.exitCode !== null ? (
                <span>
                  {t("agentChat.toolCall.commandSummary.exitCode", {
                    value: commandSummary.exitCode,
                  })}
                </span>
              ) : null}
              {commandSummary.stdoutLength !== null ? (
                <span>
                  {t("agentChat.toolCall.commandSummary.stdout", {
                    value: commandSummary.stdoutLength,
                  })}
                </span>
              ) : null}
              {commandSummary.stderrLength !== null ? (
                <span>
                  {t("agentChat.toolCall.commandSummary.stderr", {
                    value: commandSummary.stderrLength,
                  })}
                </span>
              ) : null}
              {commandSummary.sandboxed === true ? (
                <span>
                  {commandSummary.sandboxType
                    ? t(
                        "agentChat.toolCall.commandSummary.sandboxEnabledWithType",
                        { type: commandSummary.sandboxType },
                      )
                    : t("agentChat.toolCall.commandSummary.sandboxEnabled")}
                </span>
              ) : null}
              {commandSummary.sandboxed === false ? (
                <span>
                  {t("agentChat.toolCall.commandSummary.sandboxDisabled")}
                </span>
              ) : null}
              {commandSummary.outputTruncated === true ? (
                <span>{t("agentChat.toolCall.commandSummary.truncated")}</span>
              ) : null}
              {commandSurfaceLabel ? <span>{commandSurfaceLabel}</span> : null}
              {commandEncoding ? (
                <span>
                  {t("agentChat.toolCall.commandSummary.encoding", {
                    value: commandEncoding,
                  })}
                </span>
              ) : null}
              {commandDecodedWithLabel ? (
                <span>{commandDecodedWithLabel}</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {commandOutputStreams.length > 0 ? (
        <div
          className="rounded-[12px] border border-slate-200 bg-white"
          data-testid="tool-call-command-output-streams"
        >
          <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700">
            {t("agentChat.toolCall.commandOutput.title")}
          </div>
          <div className="divide-y divide-slate-100">
            {commandOutputStreams.map((stream) => (
              <div
                key={stream.key}
                className="px-3 py-2"
                data-testid={`tool-call-command-output-${stream.key}`}
              >
                <div
                  className={cn(
                    "mb-1 text-[11px] font-semibold",
                    stream.tone === "error"
                      ? "text-rose-700"
                      : "text-slate-600",
                  )}
                >
                  {t(`agentChat.toolCall.commandOutput.${stream.key}`)}
                </div>
                <pre
                  className={cn(
                    "max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed",
                    stream.tone === "error"
                      ? "text-rose-800"
                      : "text-slate-800",
                  )}
                >
                  {stream.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {diffReviewSummary ? (
        <div
          className="rounded-[12px] border border-slate-200 bg-white"
          data-testid="tool-call-diff-review"
        >
          {diffReviewSummary.files.length > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-700">
                {t("agentChat.toolCall.diffReview.title")}
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>
                  {t("agentChat.toolCall.diffReview.files", {
                    count: diffReviewSummary.files.length,
                  })}
                </span>
                <span className="text-emerald-700">
                  +{diffReviewSummary.additions}
                </span>
                <span className="text-rose-700">
                  -{diffReviewSummary.deletions}
                </span>
              </div>
            </div>
          ) : null}
          {diffReviewSummary.files.length > 1 &&
          diffReviewScopeItems.length > 0 ? (
            <div
              className="border-b border-slate-100 bg-slate-50/70 px-3 py-2"
              data-testid="tool-call-diff-review-scope"
            >
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                <FolderTree className="h-3.5 w-3.5 text-slate-500" />
                <span>{t("agentChat.toolCall.diffReview.scopeTitle")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {diffReviewScopeItems.map((scope) => (
                  <div
                    key={scope.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                    data-testid="tool-call-diff-review-scope-item"
                  >
                    <code className="max-w-56 truncate font-mono text-slate-800">
                      {scope.label ||
                        t("agentChat.toolCall.diffReview.scopeRoot")}
                    </code>
                    <span className="text-slate-500">
                      {t("agentChat.toolCall.diffReview.files", {
                        count: scope.fileCount,
                      })}
                    </span>
                    <span className="text-emerald-700">+{scope.additions}</span>
                    <span className="text-rose-700">-{scope.deletions}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="divide-y divide-slate-100">
            {diffReviewSummary.files.map((file) => {
              const isDiffFileExpanded = Boolean(expandedDiffFileIds[file.id]);
              const visibleLines = isDiffFileExpanded
                ? file.lines
                : file.previewLines;
              const hiddenLineCount = Math.max(
                file.lines.length - file.previewLines.length,
                0,
              );
              const diffLinesId = `tool-call-diff-lines-${toolCallId}-${file.id}`;

              return (
                <div
                  key={file.id}
                  className="overflow-hidden"
                  data-testid="tool-call-diff-review-file"
                >
                  <div className="flex min-h-9 flex-wrap items-center gap-2 bg-slate-50 px-3 py-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">
                      {file.path}
                    </code>
                    <span className="shrink-0 text-[11px] text-emerald-700">
                      +{file.additions}
                    </span>
                    <span className="shrink-0 text-[11px] text-rose-700">
                      -{file.deletions}
                    </span>
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
                      title={t("agentChat.markdown.code.copyBlock")}
                      aria-label={t("agentChat.markdown.code.copyBlock")}
                      onClick={() => {
                        void copyDiffFile(file);
                      }}
                    >
                      {copiedDiffFileId === file.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {canOpenChangedFile ? (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-slate-900"
                        title={t("agentChat.fileChangesSummary.openFile")}
                        aria-label={t("agentChat.fileChangesSummary.openFile")}
                        onClick={() => onOpenChangedFile(file)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {visibleLines.length > 0 ? (
                    <div
                      id={diffLinesId}
                      className={cn(
                        "overflow-auto border-t border-slate-100 bg-white font-mono text-[11px] leading-relaxed",
                        isDiffFileExpanded ? "max-h-80" : "max-h-36",
                      )}
                      data-testid="tool-call-diff-review-file-lines"
                    >
                      {visibleLines.map((line, index) => (
                        <div
                          key={`${file.id}:${index}`}
                          className={cn(
                            "grid min-w-max grid-cols-[48px_minmax(640px,1fr)]",
                            line.kind === "add" &&
                              "bg-emerald-50 text-emerald-900",
                            line.kind === "remove" &&
                              "bg-rose-50 text-rose-900",
                            line.kind === "hunk" && "bg-sky-50 text-sky-900",
                            line.kind === "context" && "text-slate-700",
                          )}
                        >
                          <span
                            className={cn(
                              "select-none border-r border-slate-100 px-2 py-0.5 text-right text-slate-400",
                              line.kind === "add" && "border-emerald-100",
                              line.kind === "remove" && "border-rose-100",
                            )}
                          >
                            {line.newLine ?? line.oldLine ?? ""}
                          </span>
                          <span className="min-w-0 whitespace-pre px-2 py-0.5">
                            {line.kind === "add"
                              ? "+"
                              : line.kind === "remove"
                                ? "-"
                                : line.kind === "hunk"
                                  ? ""
                                  : " "}
                            {line.text || " "}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {hiddenLineCount > 0 ? (
                    <button
                      type="button"
                      className="inline-flex w-full items-center gap-1 border-t border-slate-100 px-3 py-2 text-left text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                      aria-expanded={isDiffFileExpanded}
                      aria-controls={diffLinesId}
                      onClick={() => onToggleDiffFileExpanded(file.id)}
                    >
                      <span>
                        {isDiffFileExpanded
                          ? t("agentChat.toolCall.diffReview.collapseFile")
                          : t("agentChat.toolCall.diffReview.expandFile", {
                              count: hiddenLineCount,
                            })}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          isDiffFileExpanded && "rotate-180",
                        )}
                      />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {resultMetaItems.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {resultMetaItems.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      {siteResultNotices.length > 0 ? (
        <div className="space-y-1 text-[11px]">
          {siteResultNotices.map((notice) => (
            <div
              key={notice.key}
              className={cn(
                notice.tone === "success" && "text-emerald-700",
                notice.tone === "warning" && "text-amber-700",
                notice.tone === "error" && "text-rose-700",
                notice.tone === "neutral" && "text-slate-500",
              )}
            >
              {notice.text}
            </div>
          ))}
        </div>
      ) : null}
      {showOpenSavedSiteContent ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50"
            onClick={onOpenSavedSiteContent}
          >
            {openSavedSiteContentLabel}
          </button>
        </div>
      ) : null}
      {resultPath ? (
        <div
          className="break-all text-[11px] text-slate-500"
          title={resultPath.value}
        >
          {resultPath.label}: {resultPath.displayValue}
        </div>
      ) : null}
      {commandOutputStreams.length === 0 && !diffReviewSummary ? (
        <div
          className={cn(
            "max-h-64 overflow-y-auto rounded-[14px] border border-slate-200 bg-white p-3",
            isResultFailure && "border-rose-200",
          )}
          data-testid="tool-call-rendered-result"
        >
          <MarkdownRenderer content={renderedResultContent} />
        </div>
      ) : null}
    </div>
  );
}
