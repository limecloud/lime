import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExecLogEntryDetail {
  kind?: "skill" | "tool";
  sourceRef?: string;
  description?: string;
  workflowSteps?: string[];
  allowedTools?: string[];
  whenToUse?: string;
  artifactPaths?: string[];
  argumentsText?: string;
  resultText?: string;
  errorText?: string;
}

export interface ExecLogEntry {
  id: string;
  type: "user" | "thinking" | "response" | "tool" | "run" | "task";
  typeLabel: string;
  content: string;
  meta?: string;
  timestamp: Date;
  status?: "running" | "completed" | "failed";
  detail?: ExecLogEntryDetail;
}

type ExecLogFilter = "all" | "skill" | "tool" | "failed";

const EXEC_LOG_FILTER_OPTIONS: Array<{
  key: ExecLogFilter;
  label: string;
}> = [
  { key: "all", label: "全部" },
  { key: "skill", label: "技能" },
  { key: "tool", label: "工具" },
  { key: "failed", label: "失败" },
];

const EXEC_LOG_CONTAINER_CLASSNAME = "px-4 py-3";

const EXEC_LOG_TOOLBAR_CLASSNAME = "mb-3 flex flex-col gap-2";

const EXEC_LOG_TOOLBAR_ROW_CLASSNAME =
  "flex flex-wrap items-center justify-between gap-2";

const EXEC_LOG_FILTER_GROUP_CLASSNAME = "flex flex-wrap items-center gap-2";

const EXEC_LOG_TIMELINE_CLASSNAME =
  "relative pl-8 before:absolute before:bottom-2 before:left-3 before:top-2 before:w-px before:bg-slate-200 before:content-['']";

const EXEC_LOG_ITEM_CLASSNAME = "relative pb-3 last:pb-0";

const EXEC_LOG_ITEM_CARD_CLASSNAME =
  "rounded-[18px] border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-950/5";

const EXEC_LOG_HEADER_CLASSNAME = "mb-1.5 flex items-center gap-2";

const EXEC_LOG_TIME_CLASSNAME =
  "ml-auto shrink-0 whitespace-nowrap text-[10px] text-slate-400";

const EXEC_LOG_CONTENT_CLASSNAME =
  "whitespace-pre-wrap break-words text-[11.5px] leading-5 text-slate-700";

const EXEC_LOG_META_CLASSNAME =
  "mt-1 whitespace-pre-wrap break-words text-[10.5px] leading-4.5 text-slate-500";

const EXEC_LOG_EMPTY_CLASSNAME =
  "rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500";

const EXEC_LOG_FOOTER_CLASSNAME = "mt-3 flex justify-center";

const EXEC_LOG_DETAIL_TOGGLE_CLASSNAME =
  "mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-sky-700 transition-colors hover:text-slate-900";

const EXEC_LOG_DETAIL_PANEL_CLASSNAME =
  "mt-3 flex flex-col gap-3 rounded-[16px] border border-slate-200 bg-slate-50 p-3";

const EXEC_LOG_DETAIL_SECTION_CLASSNAME = "flex flex-col gap-1.5";

const EXEC_LOG_DETAIL_LABEL_CLASSNAME =
  "text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500";

const EXEC_LOG_DETAIL_TEXT_CLASSNAME =
  "whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-700";

const EXEC_LOG_DETAIL_LIST_CLASSNAME = "flex flex-col gap-1.5";

const EXEC_LOG_DETAIL_ITEM_CLASSNAME = "text-[11px] leading-5 text-slate-700";

const EXEC_LOG_DETAIL_TAG_LIST_CLASSNAME = "flex flex-wrap gap-1.5";

const EXEC_LOG_DETAIL_TAG_CLASSNAME =
  "inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[10.5px] font-medium text-slate-600";

function matchesExecLogFilter(entry: ExecLogEntry, filter: ExecLogFilter): boolean {
  if (filter === "skill") {
    return entry.type === "run";
  }
  if (filter === "tool") {
    return entry.type === "tool";
  }
  if (filter === "failed") {
    return entry.status === "failed";
  }
  return true;
}

function getExecLogDotClassName(type: string, status?: string) {
  return cn(
    "absolute left-[-21px] top-4 h-3 w-3 rounded-full border-2 bg-white",
    status === "failed" && "border-rose-400 bg-rose-100",
    status === "running" && "border-amber-400 bg-amber-100",
    status === "completed" && "border-emerald-400 bg-emerald-100",
    !status && type === "user" && "border-sky-400 bg-sky-100",
    !status && type === "thinking" && "border-sky-300 bg-sky-50",
    !status && type === "response" && "border-slate-300 bg-white",
    !status && type === "run" && "border-emerald-400 bg-emerald-100",
    !status && type === "task" && "border-amber-300 bg-amber-50",
    !status && type === "tool" && "border-sky-300 bg-sky-50",
  );
}

function getExecLogBadgeClassName(type: string, status?: string) {
  return cn(
    "inline-flex min-h-5 items-center rounded-full border px-2 text-[10px] font-semibold",
    status === "failed" && "border-rose-200 bg-rose-50 text-rose-700",
    status === "running" && "border-amber-200 bg-amber-50 text-amber-700",
    status === "completed" &&
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    !status && type === "user" && "border-sky-200 bg-sky-50 text-sky-700",
    !status &&
      type === "thinking" &&
      "border-sky-100 bg-sky-50 text-sky-600",
    !status &&
      type === "response" &&
      "border-slate-200 bg-slate-100 text-slate-600",
    !status &&
      type === "run" &&
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    !status &&
      type === "task" &&
      "border-amber-200 bg-amber-50 text-amber-700",
    !status && type === "tool" && "border-sky-200 bg-sky-50 text-sky-700",
  );
}

function getExecLogFilterChipClassName(active: boolean) {
  return cn(
    "inline-flex min-w-11 items-center justify-center rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
    active
      ? "border-slate-300 bg-slate-100 text-slate-900"
      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900",
  );
}

function getExecLogMoreButtonClassName(disabled?: boolean) {
  return cn(
    "inline-flex min-w-24 items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
    disabled
      ? "cursor-default border-slate-200 bg-slate-100 text-slate-400"
      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
  );
}

interface GeneralWorkbenchExecLogProps {
  entries: ExecLogEntry[];
  totalEntriesCount: number;
  wasCleared: boolean;
  onClear: () => void;
  onLoadMoreHistory?: () => void;
  historyHasMore?: boolean;
  historyLoading?: boolean;
}

export function GeneralWorkbenchExecLog({
  entries,
  totalEntriesCount,
  wasCleared,
  onClear,
  onLoadMoreHistory,
  historyHasMore = false,
  historyLoading = false,
}: GeneralWorkbenchExecLogProps) {
  const [filter, setFilter] = useState<ExecLogFilter>("all");
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => matchesExecLogFilter(entry, filter)),
    [entries, filter],
  );

  const toggleDetail = useCallback((entryId: string) => {
    setExpandedEntryIds((previous) =>
      previous.includes(entryId)
        ? previous.filter((id) => id !== entryId)
        : [...previous, entryId],
    );
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredEntries.length]);

  useEffect(() => {
    setExpandedEntryIds((previous) =>
      previous.filter((entryId) => entries.some((entry) => entry.id === entryId)),
    );
  }, [entries]);

  const renderEntryDetail = useCallback(
    (entry: ExecLogEntry) => {
      if (!entry.detail) {
        return null;
      }
      const isExpanded = expandedEntryIds.includes(entry.id);
      const detailLabel = entry.detail.kind === "tool" ? "工具详情" : "技能详情";
      const hasDetailContent =
        Boolean(entry.detail.sourceRef) ||
        Boolean(entry.detail.description) ||
        Boolean(entry.detail.whenToUse) ||
        Boolean(entry.detail.workflowSteps?.length) ||
        Boolean(entry.detail.allowedTools?.length) ||
        Boolean(entry.detail.artifactPaths?.length) ||
        Boolean(entry.detail.argumentsText) ||
        Boolean(entry.detail.resultText) ||
        Boolean(entry.detail.errorText);

      if (!hasDetailContent) {
        return null;
      }

      return (
        <>
          <button
            type="button"
            className={EXEC_LOG_DETAIL_TOGGLE_CLASSNAME}
            aria-label={`${isExpanded ? "收起" : "查看"}${detailLabel}-${entry.id}`}
            onClick={() => toggleDetail(entry.id)}
          >
            {isExpanded ? `收起${detailLabel}` : `查看${detailLabel}`}
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {isExpanded ? (
            <div className={EXEC_LOG_DETAIL_PANEL_CLASSNAME}>
              {entry.detail.argumentsText ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>请求参数</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.argumentsText}
                  </div>
                </div>
              ) : null}
              {entry.detail.resultText ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>执行结果</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.resultText}
                  </div>
                </div>
              ) : null}
              {entry.detail.errorText ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>错误信息</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.errorText}
                  </div>
                </div>
              ) : null}
              {entry.detail.sourceRef ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>技能标识</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.sourceRef}
                  </div>
                </div>
              ) : null}
              {entry.detail.description ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>技能说明</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.description}
                  </div>
                </div>
              ) : null}
              {entry.detail.whenToUse ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>适用场景</div>
                  <div className={EXEC_LOG_DETAIL_TEXT_CLASSNAME}>
                    {entry.detail.whenToUse}
                  </div>
                </div>
              ) : null}
              {entry.detail.workflowSteps && entry.detail.workflowSteps.length > 0 ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>工作流步骤</div>
                  <div className={EXEC_LOG_DETAIL_LIST_CLASSNAME}>
                    {entry.detail.workflowSteps.map((step, index) => (
                      <div
                        key={`${entry.id}-workflow-${index}`}
                        className={EXEC_LOG_DETAIL_ITEM_CLASSNAME}
                      >
                        {index + 1}. {step}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {entry.detail.allowedTools && entry.detail.allowedTools.length > 0 ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>允许工具</div>
                  <div className={EXEC_LOG_DETAIL_TAG_LIST_CLASSNAME}>
                    {entry.detail.allowedTools.map((toolName) => (
                      <span
                        key={`${entry.id}-tool-${toolName}`}
                        className={EXEC_LOG_DETAIL_TAG_CLASSNAME}
                      >
                        {toolName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {entry.detail.artifactPaths && entry.detail.artifactPaths.length > 0 ? (
                <div className={EXEC_LOG_DETAIL_SECTION_CLASSNAME}>
                  <div className={EXEC_LOG_DETAIL_LABEL_CLASSNAME}>关联产物</div>
                  <div className={EXEC_LOG_DETAIL_LIST_CLASSNAME}>
                    {entry.detail.artifactPaths.map((artifactPath) => (
                      <div
                        key={`${entry.id}-artifact-${artifactPath}`}
                        className={EXEC_LOG_DETAIL_ITEM_CLASSNAME}
                      >
                        {artifactPath}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      );
    },
    [expandedEntryIds, toggleDetail],
  );

  return (
    <div className={EXEC_LOG_CONTAINER_CLASSNAME}>
      <div className={EXEC_LOG_TOOLBAR_CLASSNAME}>
        <div className={EXEC_LOG_TOOLBAR_ROW_CLASSNAME}>
          <div className={EXEC_LOG_FILTER_GROUP_CLASSNAME}>
            {EXEC_LOG_FILTER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-label={`筛选执行日志-${option.label}`}
                className={getExecLogFilterChipClassName(filter === option.key)}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="清空全部日志"
            disabled={entries.length === 0}
            className={getExecLogMoreButtonClassName(entries.length === 0)}
            onClick={() => {
              if (entries.length > 0) {
                setExpandedEntryIds([]);
                onClear();
              }
            }}
          >
            清空全部
          </button>
        </div>
      </div>
      {filteredEntries.length === 0 ? (
        <>
          <div className={EXEC_LOG_EMPTY_CLASSNAME}>
            {totalEntriesCount > 0 && wasCleared
              ? "日志已清空，等待新的运行记录…"
              : entries.length > 0
                ? "当前筛选下暂无日志"
                : "暂无执行记录"}
          </div>
          {onLoadMoreHistory && (historyHasMore || historyLoading) ? (
            <div className={EXEC_LOG_FOOTER_CLASSNAME}>
              <button
                type="button"
                aria-label="加载更早历史日志"
                disabled={historyLoading}
                className={getExecLogMoreButtonClassName(historyLoading)}
                onClick={() => {
                  if (!historyLoading) {
                    onLoadMoreHistory();
                  }
                }}
              >
                {historyLoading ? "加载中..." : "加载更早历史"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className={EXEC_LOG_TIMELINE_CLASSNAME}>
          {filteredEntries.map((entry) => (
            <div key={entry.id} className={EXEC_LOG_ITEM_CLASSNAME}>
              <span className={getExecLogDotClassName(entry.type, entry.status)} />
              <div className={EXEC_LOG_ITEM_CARD_CLASSNAME}>
                <div className={EXEC_LOG_HEADER_CLASSNAME}>
                  <span className={getExecLogBadgeClassName(entry.type, entry.status)}>
                    {entry.typeLabel}
                  </span>
                  <span className={EXEC_LOG_TIME_CLASSNAME}>
                    {entry.timestamp
                      ? entry.timestamp instanceof Date
                        ? entry.timestamp.toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : new Date(entry.timestamp).toLocaleTimeString("zh-CN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                      : ""}
                  </span>
                </div>
                <div className={EXEC_LOG_CONTENT_CLASSNAME}>{entry.content}</div>
                {entry.meta ? (
                  <div className={EXEC_LOG_META_CLASSNAME}>{entry.meta}</div>
                ) : null}
                {renderEntryDetail(entry)}
              </div>
            </div>
          ))}
          {onLoadMoreHistory && (historyHasMore || historyLoading) ? (
            <div className={EXEC_LOG_FOOTER_CLASSNAME}>
              <button
                type="button"
                aria-label="加载更早历史日志"
                disabled={historyLoading}
                className={getExecLogMoreButtonClassName(historyLoading)}
                onClick={() => {
                  if (!historyLoading) {
                    onLoadMoreHistory();
                  }
                }}
              >
                {historyLoading ? "加载中..." : "加载更早历史"}
              </button>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
