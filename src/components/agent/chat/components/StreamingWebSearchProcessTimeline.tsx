import React from "react";
import { cn } from "@/lib/utils";
import { SearchResultPreviewList } from "./SearchResultPreviewList";
import type { StreamingProcessEntry } from "./StreamingProcessGroupModel";
import type {
  ToolBatchSummaryDescriptor,
  ToolBatchSummarySectionKind,
} from "../utils/toolBatchGrouping";
import {
  formatSearchSourceLabelFromUrl,
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
  type SearchResultPreviewItem,
} from "../utils/searchResultPreview";
import { isUnifiedWebFetchToolName } from "../utils/toolNameFamily";
import { attachUrlPreviewSnapshotsToSearchResults } from "../utils/urlPreviewSnapshot";
import {
  getToolDisplayInfo,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
} from "../utils/toolDisplayInfo";
import { resolveToolProcessNarrative } from "../utils/toolProcessSummary";

type ToolEntry = Extract<StreamingProcessEntry, { kind: "tool" }>;

interface WebSearchTimelineProps {
  entries: StreamingProcessEntry[];
  descriptor: ToolBatchSummaryDescriptor;
  hasNonToolEntries: boolean;
  onOpenUrlPreview?: (item: SearchResultPreviewItem) => void;
  resolveSectionTitle: (kind: ToolBatchSummarySectionKind) => string;
  renderEntry: (
    entry: StreamingProcessEntry,
    grouped: boolean,
    groupMarker: string,
    entries: StreamingProcessEntry[],
  ) => React.ReactNode;
}

interface WebRetrievalProcessRowProps {
  entry: ToolEntry;
  groupMarker: string;
  sectionTitle?: string;
  children?: React.ReactNode;
}

function formatWebRetrievalRowSummary(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/https?:\/\/[^\s，。！？、；：,.!?;:)]+/gi, (url) =>
    formatSearchSourceLabelFromUrl(url),
  );
}

function WebRetrievalProcessRow({
  entry,
  groupMarker,
  sectionTitle,
  children,
}: WebRetrievalProcessRowProps) {
  const toolCall = entry.toolCall;
  const isRunning = toolCall.status === "running";
  const display = getToolDisplayInfo(
    toolCall.name,
    toolCall.status,
    toolCall.metadata,
  );
  const args = parseToolCallArguments(toolCall.arguments);
  const subject = resolveToolPrimarySubject(
    toolCall.name,
    args,
    resolveToolFilePath(args),
    toolCall.metadata,
  );
  const narrative = resolveToolProcessNarrative(toolCall);
  const summary =
    toolCall.status === "running"
      ? narrative.preSummary || narrative.summary
      : narrative.postSummary || narrative.summary || narrative.preSummary;
  const displaySummary = formatWebRetrievalRowSummary(summary);
  const sourceLabel =
    isUnifiedWebFetchToolName(toolCall.name) && typeof subject === "string"
      ? formatSearchSourceLabelFromUrl(subject)
      : subject;

  return (
    <div
      className="flex items-start gap-2 py-1.5"
      data-testid="web-retrieval-process-row"
      data-tool-status={toolCall.status}
    >
      <span className="pt-0.5 text-xs text-slate-300">{groupMarker}</span>
      <div className="mt-2 flex h-2 w-2 shrink-0 items-center justify-center">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isRunning ? "animate-pulse bg-sky-500" : "bg-slate-300",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        {sectionTitle ? (
          <div className="text-[11px] font-medium leading-5 text-slate-500">
            {sectionTitle}
          </div>
        ) : null}
        <div className="truncate text-[13px] font-normal leading-6 text-slate-700">
          {sourceLabel ? `${display.action} ${sourceLabel}` : display.action}
        </div>
        {displaySummary ? (
          <div className="text-xs leading-5 text-slate-500">
            {displaySummary}
          </div>
        ) : null}
        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
    </div>
  );
}

function WebSearchSupportingSections({
  descriptor,
  resolveSectionTitle,
}: {
  descriptor: ToolBatchSummaryDescriptor;
  resolveSectionTitle: (kind: ToolBatchSummarySectionKind) => string;
}) {
  const sections =
    descriptor.supportingSections && descriptor.supportingSections.length > 0
      ? descriptor.supportingSections
      : [
          {
            kind: null,
            lines: descriptor.supportingLines,
          },
        ];

  return (
    <div className="space-y-3">
      {sections.map((section, sectionIndex) => (
        <div
          key={`${section.kind || "web-search-lines"}-${sectionIndex}`}
          className="space-y-1.5"
        >
          {section.kind ? (
            <div className="text-[11px] font-medium leading-5 text-slate-500">
              {resolveSectionTitle(section.kind)}
            </div>
          ) : null}
          <div className="space-y-1">
            {section.lines.slice(0, 8).map((line, lineIndex) => (
              <div
                key={`${section.kind || "line"}-${lineIndex}-${line}`}
                className="text-xs leading-5 text-slate-500"
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildSearchPreviewItemsByToolId(
  entries: StreamingProcessEntry[],
): Map<string, SearchResultPreviewItem[]> {
  const toolCalls = entries
    .filter((entry): entry is ToolEntry => entry.kind === "tool")
    .map((entry) => entry.toolCall);
  const itemsByToolId = new Map<string, SearchResultPreviewItem[]>();
  const usedUrls = new Set<string>();

  for (const entry of entries) {
    if (
      entry.kind !== "tool" ||
      !isUnifiedWebSearchToolName(entry.toolCall.name)
    ) {
      continue;
    }
    const items = attachUrlPreviewSnapshotsToSearchResults({
      items: resolveSearchResultPreviewItemsFromText(
        entry.toolCall.result?.output,
      ).filter((item) => {
        if (usedUrls.has(item.url)) {
          return false;
        }
        usedUrls.add(item.url);
        return true;
      }),
      toolCalls,
    });
    if (items.length > 0) {
      itemsByToolId.set(entry.id, items);
    }
  }

  return itemsByToolId;
}

function WebSearchPreviewProcessRow({
  entry,
  groupMarker,
  sectionTitle,
  items,
  onOpenItem,
}: {
  entry: ToolEntry;
  groupMarker: string;
  sectionTitle: string;
  items: SearchResultPreviewItem[];
  onOpenItem?: (item: SearchResultPreviewItem) => void | Promise<void>;
}) {
  return (
    <WebRetrievalProcessRow
      entry={entry}
      groupMarker={groupMarker}
      sectionTitle={sectionTitle}
    >
      <SearchResultPreviewList
        items={items}
        onOpenItem={onOpenItem}
        popoverSide="bottom"
        popoverAlign="start"
        className="max-w-2xl"
        variant="inline"
      />
    </WebRetrievalProcessRow>
  );
}

function renderWebSearchProcessEntry(
  entry: StreamingProcessEntry,
  index: number,
  entries: StreamingProcessEntry[],
  renderEntry: WebSearchTimelineProps["renderEntry"],
): React.ReactNode {
  const groupMarker = index === 0 ? "└" : "·";
  if (
    entry.kind === "tool" &&
    (isUnifiedWebSearchToolName(entry.toolCall.name) ||
      isUnifiedWebFetchToolName(entry.toolCall.name))
  ) {
    return (
      <WebRetrievalProcessRow
        key={entry.id}
        entry={entry}
        groupMarker={groupMarker}
      />
    );
  }

  return (
    <React.Fragment key={entry.id}>
      {renderEntry(entry, true, groupMarker, entries)}
    </React.Fragment>
  );
}

export function StreamingWebSearchProcessTimeline({
  entries,
  descriptor,
  hasNonToolEntries,
  onOpenUrlPreview,
  resolveSectionTitle,
  renderEntry,
}: WebSearchTimelineProps): React.ReactNode {
  const previewItemsByToolId = buildSearchPreviewItemsByToolId(entries);
  const shouldRenderTimeline =
    previewItemsByToolId.size > 0 && hasNonToolEntries;

  if (shouldRenderTimeline) {
    return (
      <div className="space-y-1">
        {entries.map((entry, index) => {
          const groupMarker = index === 0 ? "└" : "·";
          if (
            entry.kind === "tool" &&
            isUnifiedWebSearchToolName(entry.toolCall.name)
          ) {
            const items = previewItemsByToolId.get(entry.id);
            if (items && items.length > 0 && onOpenUrlPreview) {
              return (
                <WebSearchPreviewProcessRow
                  key={entry.id}
                  entry={entry}
                  groupMarker={groupMarker}
                  sectionTitle={resolveSectionTitle("web_search_sources")}
                  items={items}
                  onOpenItem={onOpenUrlPreview}
                />
              );
            }
          }
          if (
            entry.kind === "tool" &&
            isUnifiedWebFetchToolName(entry.toolCall.name)
          ) {
            return (
              <WebRetrievalProcessRow
                key={entry.id}
                entry={entry}
                groupMarker={groupMarker}
                sectionTitle={resolveSectionTitle("web_fetch_pages")}
              />
            );
          }
          return renderWebSearchProcessEntry(
            entry,
            index,
            entries,
            renderEntry,
          );
        })}
      </div>
    );
  }

  if (onOpenUrlPreview && previewItemsByToolId.size > 0 && !hasNonToolEntries) {
    const previewItems = Array.from(previewItemsByToolId.values()).flat();
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          {descriptor.supportingSections?.[0] ? (
            <div className="text-[11px] font-medium leading-5 text-slate-500">
              {resolveSectionTitle(descriptor.supportingSections[0].kind)}
            </div>
          ) : null}
          <SearchResultPreviewList
            items={previewItems}
            onOpenItem={onOpenUrlPreview}
            popoverSide="bottom"
            popoverAlign="start"
            className="max-w-2xl"
            variant="inline"
          />
        </div>
        {descriptor.supportingSections
          ?.slice(1)
          .map((section, sectionIndex) => (
            <div
              key={`${section.kind}-${sectionIndex}`}
              className="space-y-1.5"
            >
              <div className="text-[11px] font-medium leading-5 text-slate-500">
                {resolveSectionTitle(section.kind)}
              </div>
              <div className="space-y-1">
                {section.lines.slice(0, 8).map((line, lineIndex) => (
                  <div
                    key={`${section.kind}-${lineIndex}-${line}`}
                    className="text-xs leading-5 text-slate-500"
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    );
  }

  if (hasNonToolEntries) {
    return (
      <div className="space-y-1">
        {entries.map((entry, index) =>
          renderWebSearchProcessEntry(entry, index, entries, renderEntry),
        )}
      </div>
    );
  }

  return (
    <WebSearchSupportingSections
      descriptor={descriptor}
      resolveSectionTitle={resolveSectionTitle}
    />
  );
}
