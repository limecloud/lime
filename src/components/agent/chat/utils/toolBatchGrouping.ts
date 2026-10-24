import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { AgentThreadItem } from "../types";
import { resolveToolDisplayName } from "./toolDisplayName";
import {
  classifyMcpToolOperationKind,
  isBrowserToolName,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveToolFilePath,
  type ToolCallArgumentValue,
} from "./toolDisplayInfo";
import {
  formatSearchSourceLabelFromUrl,
  resolveSearchResultPreviewItemsFromText,
} from "./searchResultPreview";
import {
  isUnifiedWebFetchToolName,
  isUnifiedWebSearchToolName,
} from "./toolNameFamily";
import { resolveToolSoulMetadataFromEntries } from "./toolSoulLifecycleMetadata";
import {
  resolveToolProcessFactsOperationKind,
  resolveToolProcessFactsSubject,
} from "./toolProcessSummaryMetadata";
import {
  resolveBrowserCountLabel,
  resolveBrowserFallbackLine,
  resolveBrowserLatestHintLine,
  resolveBrowserRawDetailLabel,
  resolveBrowserTitle,
  resolveExplorationCountLabel,
  resolveExplorationDetailLine,
  resolveExplorationLatestHintLine,
  resolveExplorationRawDetailLabel,
  resolveExplorationTitle,
  resolveWebSearchCountLabel,
  resolveWebSearchFallbackLine,
  resolveWebSearchLatestHintLine,
  resolveWebSearchRawDetailLabel,
  resolveWebSearchTitle,
} from "./toolBatchGroupingCopy";
import type {
  ToolBatchSummaryDescriptor,
  ToolBatchSummarySection,
  ToolLikeDescriptor,
  ToolLikeStatus,
  ToolOperationKind,
} from "./toolBatchGroupingTypes";

export type {
  ToolBatchKind,
  ToolBatchSummaryDescriptor,
  ToolBatchSummarySection,
  ToolBatchSummarySectionKind,
} from "./toolBatchGroupingTypes";

interface ToolBatchAccumulator {
  readCount: number;
  searchCount: number;
  webSearchCount: number;
  webFetchCount: number;
  listCount: number;
  browserCount: number;
  mutationCount: number;
  webSearchFailedCount: number;
  significantCount: number;
  absorbedCount: number;
  otherCount: number;
  hasRunning: boolean;
  latestHint: string | null;
  latestWebSearchHint: string | null;
  webSearchHints: string[];
  webFetchHints: string[];
  searchHints: string[];
  browserHints: string[];
}

type ThreadProcessBatchItem = Extract<
  AgentThreadItem,
  { type: "tool_call" | "command_execution" | "web_search" }
>;

function shorten(
  value: string | null | undefined,
  maxLength = 72,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatShortSourceHint(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return shorten(formatSearchSourceLabelFromUrl(normalized), 56);
  }
  return shorten(normalized, 56);
}

function asRecord(value: unknown): Record<string, ToolCallArgumentValue> {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    const parsed = parseToolCallArguments(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, ToolCallArgumentValue>;
  }

  return {};
}

function normalizeMetadataRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mergeMetadata(base: unknown, override: unknown): unknown {
  const baseRecord = normalizeMetadataRecord(base);
  const overrideRecord = normalizeMetadataRecord(override);
  if (baseRecord && overrideRecord) {
    return {
      ...baseRecord,
      ...overrideRecord,
    };
  }
  return overrideRecord ?? baseRecord ?? override ?? base;
}

function isThreadProcessBatchItem(
  item: AgentThreadItem,
): item is ThreadProcessBatchItem {
  return (
    item.type === "tool_call" ||
    item.type === "command_execution" ||
    item.type === "web_search"
  );
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readFirstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find(
        (item) => typeof item === "string" && item.trim(),
      );
      if (typeof first === "string") {
        return first.trim();
      }
    }
  }
  return null;
}

function nestedRecord(
  record: Record<string, ToolCallArgumentValue>,
  key: string,
): Record<string, ToolCallArgumentValue> | null {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, ToolCallArgumentValue>;
}

function resolveWebSearchActionDetail(
  args: Record<string, ToolCallArgumentValue>,
): string | null {
  const action = nestedRecord(args, "action");
  const actionQuery = action
    ? readFirstString(action, ["query", "url", "pattern", "queries"])
    : null;
  const directQuery = readFirstString(args, [
    "query",
    "q",
    "pattern",
    "search",
    "url",
    "href",
    "queries",
  ]);
  return actionQuery || directQuery;
}

function isRunningToolLikeStatus(status?: ToolLikeStatus): boolean {
  return status === "running" || status === "in_progress";
}

function pushUniqueHint(target: string[], hint: string | null): void {
  if (!hint || target.includes(hint)) {
    return;
  }
  target.push(hint);
}

function resolveResultHints(output: string | null | undefined): string[] {
  return resolveSearchResultPreviewItemsFromText(output)
    .slice(0, 3)
    .map((item) => item.title || item.hostname || item.url)
    .filter((hint): hint is string => Boolean(hint?.trim()));
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function resolveBashLikeKind(command: string): ToolOperationKind {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    return "other";
  }

  if (
    /\b(rg|grep|findstr|ag|ack)\b/.test(normalized) ||
    /\bselect-string\b/.test(normalized)
  ) {
    return "search";
  }

  if (/\b(ls|tree|dir|fd|find)\b/.test(normalized)) {
    return "list";
  }

  if (/\b(cat|head|tail|sed|awk|more|less|wc)\b/.test(normalized)) {
    return "read";
  }

  return "other";
}

function resolveToolOperationKind(
  descriptor: ToolLikeDescriptor,
): ToolOperationKind {
  const factsOperationKind = resolveToolProcessFactsOperationKind(
    descriptor.metadata,
  );
  if (factsOperationKind) {
    return factsOperationKind;
  }

  const normalizedName = normalizeToolNameKey(descriptor.toolName);
  const args = asRecord(descriptor.argumentsValue);
  const mcpOperationKind = classifyMcpToolOperationKind(descriptor.toolName);

  if (
    normalizedName === "toolsearch" ||
    normalizedName === "repl" ||
    normalizedName === "listskills" ||
    normalizedName === "loadskill"
  ) {
    return "absorbed";
  }

  if (normalizedName === "resolvelibraryid") {
    return "search";
  }

  if (normalizedName === "querydocs") {
    return "read";
  }

  if (isUnifiedWebSearchToolName(descriptor.toolName)) {
    return "web_search";
  }

  if (isUnifiedWebFetchToolName(descriptor.toolName)) {
    return "web_fetch";
  }

  if (mcpOperationKind) {
    return mcpOperationKind;
  }

  if (isBrowserToolName(normalizedName)) {
    return "browser";
  }

  if (
    normalizedName.includes("search") ||
    normalizedName.includes("grep") ||
    normalizedName.includes("query") ||
    normalizedName.includes("find") ||
    normalizedName.includes("fetch") ||
    normalizedName === "web"
  ) {
    return "search";
  }

  if (
    normalizedName.includes("glob") ||
    normalizedName.includes("list") ||
    normalizedName.includes("dir")
  ) {
    return "list";
  }

  if (
    normalizedName.includes("read") ||
    normalizedName.includes("view") ||
    normalizedName.includes("cat") ||
    normalizedName.includes("open")
  ) {
    return "read";
  }

  if (
    normalizedName.includes("bash") ||
    normalizedName.includes("shell") ||
    normalizedName.includes("exec") ||
    normalizedName.includes("command")
  ) {
    const command =
      descriptor.command ||
      readString(args, ["command", "cmd", "script"]) ||
      "";
    return resolveBashLikeKind(command);
  }

  return "other";
}

function resolveLatestHint(
  descriptor: ToolLikeDescriptor,
  operationKind: ToolOperationKind,
): string | null {
  const args = asRecord(descriptor.argumentsValue);
  const factsSubject = resolveToolProcessFactsSubject(descriptor.metadata);
  if (operationKind === "search" || operationKind === "web_search") {
    const webSearchDetail =
      operationKind === "web_search"
        ? resolveWebSearchActionDetail(args)
        : null;
    return shorten(
      descriptor.query ||
        factsSubject ||
        webSearchDetail ||
        readString(args, [
          "query",
          "q",
          "pattern",
          "search",
          "url",
          "href",
          "libraryName",
          "library_name",
          "name",
        ]),
      56,
    );
  }

  if (operationKind === "web_fetch") {
    return formatShortSourceHint(
      descriptor.query ||
        factsSubject ||
        readString(args, ["query", "q", "pattern", "search", "url", "href"]),
    );
  }

  if (operationKind === "read" || operationKind === "list") {
    const filePath = resolveToolFilePath(args);
    if (filePath) {
      return shorten(fileNameFromPath(filePath), 48);
    }
    return shorten(
      factsSubject ||
        readString(args, [
          "path",
          "file_path",
          "directory",
          "query",
          "q",
          "libraryId",
          "library_id",
          "libraryName",
          "library_name",
        ]),
      48,
    );
  }

  if (operationKind === "browser") {
    return shorten(
      factsSubject ||
        readString(args, [
          "url",
          "pageUrl",
          "page_url",
          "selector",
          "target",
          "label",
        ]),
      56,
    );
  }

  const command =
    descriptor.command ||
    factsSubject ||
    readString(args, ["command", "cmd", "script"]);
  return shorten(command, 56);
}

function accumulateBatch(entries: ToolLikeDescriptor[]): ToolBatchAccumulator {
  const accumulator: ToolBatchAccumulator = {
    readCount: 0,
    searchCount: 0,
    webSearchCount: 0,
    webFetchCount: 0,
    listCount: 0,
    browserCount: 0,
    mutationCount: 0,
    webSearchFailedCount: 0,
    significantCount: 0,
    absorbedCount: 0,
    otherCount: 0,
    hasRunning: false,
    latestHint: null,
    latestWebSearchHint: null,
    webSearchHints: [],
    webFetchHints: [],
    searchHints: [],
    browserHints: [],
  };

  for (const entry of entries) {
    if (isRunningToolLikeStatus(entry.status)) {
      accumulator.hasRunning = true;
    }
    const operationKind = resolveToolOperationKind(entry);
    switch (operationKind) {
      case "read":
        accumulator.readCount += 1;
        accumulator.significantCount += 1;
        break;
      case "search":
        accumulator.searchCount += 1;
        accumulator.significantCount += 1;
        break;
      case "web_search":
        accumulator.webSearchCount += 1;
        accumulator.significantCount += 1;
        if (entry.status === "failed") {
          accumulator.webSearchFailedCount += 1;
        }
        break;
      case "web_fetch":
        accumulator.webFetchCount += 1;
        accumulator.searchCount += 1;
        accumulator.significantCount += 1;
        break;
      case "list":
        accumulator.listCount += 1;
        accumulator.significantCount += 1;
        break;
      case "browser":
        accumulator.browserCount += 1;
        accumulator.significantCount += 1;
        break;
      case "mutation":
        accumulator.mutationCount += 1;
        accumulator.significantCount += 1;
        accumulator.otherCount += 1;
        break;
      case "absorbed":
        accumulator.absorbedCount += 1;
        break;
      default:
        accumulator.otherCount += 1;
        break;
    }

    const hint = resolveLatestHint(entry, operationKind);
    if (hint) {
      accumulator.latestHint = hint;
      if (operationKind === "web_search") {
        accumulator.latestWebSearchHint = hint;
        pushUniqueHint(accumulator.webSearchHints, hint);
      }
      if (operationKind === "web_fetch") {
        pushUniqueHint(accumulator.webFetchHints, hint);
      }
      if (operationKind === "search") {
        pushUniqueHint(accumulator.searchHints, hint);
      }
      if (operationKind === "browser") {
        pushUniqueHint(accumulator.browserHints, hint);
      }
    }

    if (operationKind === "web_search") {
      for (const resultHint of resolveResultHints(entry.output)) {
        pushUniqueHint(accumulator.webSearchHints, resultHint);
      }
    }
  }

  return accumulator;
}

function buildWebSearchDescriptor(
  accumulator: ToolBatchAccumulator,
  entries: ToolLikeDescriptor[],
): ToolBatchSummaryDescriptor | null {
  const {
    readCount,
    searchCount,
    webSearchCount,
    listCount,
    browserCount,
    mutationCount,
    significantCount,
    otherCount,
  } = accumulator;
  const hasOnlyWebSearchCompanions =
    searchCount === accumulator.webFetchCount &&
    readCount === 0 &&
    listCount === 0 &&
    browserCount === 0 &&
    mutationCount === 0 &&
    otherCount === 0 &&
    significantCount === webSearchCount + accumulator.webFetchCount;
  if (webSearchCount < 1 || !hasOnlyWebSearchCompanions) {
    return null;
  }

  const webFetchCount = accumulator.webFetchCount;
  const hasRunningWebRetrieval = entries.some((entry) => {
    const operationKind = resolveToolOperationKind(entry);
    return (
      (operationKind === "web_search" || operationKind === "web_fetch") &&
      isRunningToolLikeStatus(entry.status)
    );
  });

  const supportingLines =
    accumulator.webSearchHints.length > 0 ||
    accumulator.webFetchHints.length > 0
      ? [...accumulator.webSearchHints, ...accumulator.webFetchHints].slice(
          0,
          7,
        )
      : [
          resolveWebSearchFallbackLine({
            webFetchCount,
            webSearchCount,
          }),
        ];
  const supportingSections: ToolBatchSummarySection[] = [];
  if (accumulator.webSearchHints.length > 0) {
    supportingSections.push({
      kind: "web_search_sources",
      lines: accumulator.webSearchHints.slice(0, 5),
    });
  }
  if (accumulator.webFetchHints.length > 0) {
    supportingSections.push({
      kind: "web_fetch_pages",
      lines: accumulator.webFetchHints.slice(0, 5),
    });
  }
  if (
    accumulator.latestWebSearchHint &&
    !supportingLines.some((line) =>
      line.includes(accumulator.latestWebSearchHint || ""),
    )
  ) {
    supportingLines.push(
      resolveWebSearchLatestHintLine(accumulator.latestWebSearchHint),
    );
  }

  return {
    kind: "web_search",
    title: resolveWebSearchTitle({
      hasRunning: hasRunningWebRetrieval,
      latestWebSearchHint: accumulator.latestWebSearchHint,
      webFetchCount,
      webSearchCount,
    }),
    supportingLines,
    supportingSections:
      supportingSections.length > 1 ? supportingSections : undefined,
    countLabel: resolveWebSearchCountLabel({
      webFetchCount,
      webSearchCount,
    }),
    rawDetailLabel: resolveWebSearchRawDetailLabel({
      hasRunning: hasRunningWebRetrieval,
      webFetchCount,
    }),
    hasRunning: hasRunningWebRetrieval,
    ...resolveToolSoulMetadataFromEntries(entries),
  };
}

function buildExplorationDescriptor(
  accumulator: ToolBatchAccumulator,
  entries: ToolLikeDescriptor[],
): ToolBatchSummaryDescriptor | null {
  const {
    readCount,
    searchCount,
    webSearchCount,
    listCount,
    significantCount,
    otherCount,
  } = accumulator;
  if (
    significantCount < 2 ||
    otherCount > 0 ||
    accumulator.browserCount > 0 ||
    accumulator.mutationCount > 0 ||
    webSearchCount > 0
  ) {
    return null;
  }

  const detailLine = resolveExplorationDetailLine({
    listCount,
    readCount,
    searchCount,
  });
  const supportingLines = detailLine ? [detailLine] : [];
  if (accumulator.latestHint) {
    supportingLines.push(
      resolveExplorationLatestHintLine(accumulator.latestHint),
    );
  }

  return {
    kind: "exploration",
    title: resolveExplorationTitle({
      readCount,
      searchCount,
    }),
    supportingLines,
    countLabel: resolveExplorationCountLabel({
      latestHint: accumulator.latestHint,
      listCount,
      readCount,
      searchCount,
      significantCount,
    }),
    rawDetailLabel: resolveExplorationRawDetailLabel(),
    hasRunning: accumulator.hasRunning,
    ...resolveToolSoulMetadataFromEntries(entries),
  };
}

function buildBrowserDescriptor(
  accumulator: ToolBatchAccumulator,
  entries: ToolLikeDescriptor[],
): ToolBatchSummaryDescriptor | null {
  if (
    accumulator.browserCount < 2 ||
    accumulator.otherCount > 0 ||
    accumulator.readCount > 0 ||
    accumulator.searchCount > 0 ||
    accumulator.webSearchCount > 0 ||
    accumulator.listCount > 0 ||
    accumulator.mutationCount > 0
  ) {
    return null;
  }

  const supportingLines =
    accumulator.browserHints.length > 0
      ? accumulator.browserHints.slice(0, 4)
      : [
          resolveBrowserFallbackLine({
            browserCount: accumulator.browserCount,
          }),
        ];
  if (
    accumulator.latestHint &&
    !supportingLines.some((line) => line.includes(accumulator.latestHint || ""))
  ) {
    supportingLines.push(resolveBrowserLatestHintLine(accumulator.latestHint));
  }

  return {
    kind: "browser",
    title: resolveBrowserTitle(),
    supportingLines,
    countLabel: resolveBrowserCountLabel({
      browserCount: accumulator.browserCount,
    }),
    rawDetailLabel: resolveBrowserRawDetailLabel(),
    hasRunning: accumulator.hasRunning,
    ...resolveToolSoulMetadataFromEntries(entries),
  };
}

function buildDescriptorFromEntries(
  entries: ToolLikeDescriptor[],
): ToolBatchSummaryDescriptor | null {
  entries = entries.map((entry) => ({
    ...entry,
    toolName: resolveToolDisplayName(entry.toolName, entry.metadata),
  }));
  if (entries.length < 1) {
    return null;
  }

  const accumulator = accumulateBatch(entries);
  const webSearchDescriptor = buildWebSearchDescriptor(accumulator, entries);
  if (webSearchDescriptor || entries.length < 2) {
    return webSearchDescriptor;
  }

  return (
    buildExplorationDescriptor(accumulator, entries) ||
    buildBrowserDescriptor(accumulator, entries)
  );
}

export function summarizeStreamingToolBatch(
  toolCalls: ToolCallState[],
): ToolBatchSummaryDescriptor | null {
  return buildDescriptorFromEntries(
    toolCalls.map((toolCall) => ({
      toolName: toolCall.name,
      argumentsValue: toolCall.arguments,
      metadata: mergeMetadata(toolCall.result?.metadata, toolCall.metadata),
      output: toolCall.result?.output || toolCall.result?.error || null,
      status: toolCall.status,
    })),
  );
}

function readThreadItemMetadata(item: AgentThreadItem): unknown {
  return "metadata" in item ? item.metadata : undefined;
}

export function summarizeThreadProcessBatch(
  items: AgentThreadItem[],
): ToolBatchSummaryDescriptor | null {
  const processItems = items.filter(isThreadProcessBatchItem);
  if (processItems.length < 1 || processItems.length !== items.length) {
    return null;
  }

  const descriptors: ToolLikeDescriptor[] = processItems.map((item) => {
    if (item.type === "command_execution") {
      const argumentsValue: Record<string, ToolCallArgumentValue> = {
        command: item.command,
        cwd: item.cwd,
      };
      return {
        toolName: "exec_command",
        command: item.command,
        argumentsValue,
        metadata: readThreadItemMetadata(item),
      };
    }

    if (item.type === "web_search") {
      const argumentsValue: Record<string, ToolCallArgumentValue> = {
        action: item.action || "",
        query: item.query || item.action || "",
      };
      return {
        toolName: "web_search",
        query: item.query || item.action || null,
        metadata: readThreadItemMetadata(item),
        output: item.output || null,
        argumentsValue,
        status: item.status,
      };
    }

    return {
      toolName: item.tool_name,
      argumentsValue:
        item.arguments && typeof item.arguments === "object"
          ? (item.arguments as Record<string, ToolCallArgumentValue>)
          : item.arguments === undefined
            ? undefined
            : String(item.arguments),
      metadata: item.metadata,
      output:
        typeof item.output === "string"
          ? item.output
          : typeof item.error === "string"
            ? item.error
            : null,
      status: item.status,
    };
  });

  return buildDescriptorFromEntries(descriptors);
}
