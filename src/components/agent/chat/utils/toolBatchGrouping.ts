import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import type { AgentThreadItem } from "../types";
import {
  classifyMcpToolOperationKind,
  isBrowserToolName,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveToolFilePath,
  type ToolCallArgumentValue,
} from "./toolDisplayInfo";

export type ToolBatchKind = "exploration" | "browser";

export interface ToolBatchSummaryDescriptor {
  kind: ToolBatchKind;
  title: string;
  supportingLines: string[];
  countLabel: string;
  rawDetailLabel: string;
}

type ToolOperationKind =
  | "read"
  | "search"
  | "list"
  | "browser"
  | "absorbed"
  | "other";

interface ToolBatchAccumulator {
  readCount: number;
  searchCount: number;
  listCount: number;
  browserCount: number;
  significantCount: number;
  absorbedCount: number;
  otherCount: number;
  latestHint: string | null;
}

interface ToolLikeDescriptor {
  toolName: string;
  argumentsValue?: string | Record<string, ToolCallArgumentValue>;
  command?: string | null;
  query?: string | null;
}

type ThreadProcessBatchItem = Extract<
  AgentThreadItem,
  { type: "tool_call" | "command_execution" | "web_search" }
>;

function shorten(value: string | null | undefined, maxLength = 72): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
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
  if (operationKind === "search") {
    return shorten(
      descriptor.query ||
        readString(args, ["query", "q", "pattern", "search", "url"]),
      56,
    );
  }

  if (operationKind === "read" || operationKind === "list") {
    const filePath = resolveToolFilePath(args);
    if (filePath) {
      return shorten(fileNameFromPath(filePath), 48);
    }
    return shorten(readString(args, ["path", "file_path", "directory"]), 48);
  }

  if (operationKind === "browser") {
    return shorten(
      readString(args, ["url", "pageUrl", "page_url", "selector", "target", "label"]),
      56,
    );
  }

  const command =
    descriptor.command || readString(args, ["command", "cmd", "script"]);
  return shorten(command, 56);
}

function accumulateBatch(
  entries: ToolLikeDescriptor[],
): ToolBatchAccumulator {
  const accumulator: ToolBatchAccumulator = {
    readCount: 0,
    searchCount: 0,
    listCount: 0,
    browserCount: 0,
    significantCount: 0,
    absorbedCount: 0,
    otherCount: 0,
    latestHint: null,
  };

  for (const entry of entries) {
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
      case "list":
        accumulator.listCount += 1;
        accumulator.significantCount += 1;
        break;
      case "browser":
        accumulator.browserCount += 1;
        accumulator.significantCount += 1;
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
    }
  }

  return accumulator;
}

function buildExplorationDescriptor(
  accumulator: ToolBatchAccumulator,
): ToolBatchSummaryDescriptor | null {
  const { readCount, searchCount, listCount, significantCount, otherCount } =
    accumulator;
  if (significantCount < 2 || otherCount > 0 || accumulator.browserCount > 0) {
    return null;
  }

  const title =
    readCount > 0 && searchCount > 0
      ? "已探索项目"
      : readCount > 0
        ? "已查看关键文件"
        : searchCount > 0
          ? "已搜索关键线索"
          : "已查看目录结构";

  const detailParts: string[] = [];
  if (readCount > 0) {
    detailParts.push(`查看了 ${readCount} 个文件`);
  }
  if (searchCount > 0) {
    detailParts.push(`搜索 ${searchCount} 次`);
  }
  if (listCount > 0) {
    detailParts.push(`列了 ${listCount} 个目录`);
  }

  const countParts: string[] = [];
  if (readCount > 0) {
    countParts.push(`读 ${readCount}`);
  }
  if (searchCount > 0) {
    countParts.push(`搜 ${searchCount}`);
  }
  if (listCount > 0) {
    countParts.push(`列 ${listCount}`);
  }

  const supportingLines = detailParts.length > 0 ? [detailParts.join("，")] : [];
  if (accumulator.latestHint) {
    supportingLines.push(`最新线索：${accumulator.latestHint}`);
  }

  return {
    kind: "exploration",
    title,
    supportingLines,
    countLabel: countParts.join(" / ") || `${significantCount} 步`,
    rawDetailLabel: "展开查看探索明细",
  };
}

function buildBrowserDescriptor(
  accumulator: ToolBatchAccumulator,
): ToolBatchSummaryDescriptor | null {
  if (
    accumulator.browserCount < 2 ||
    accumulator.otherCount > 0 ||
    accumulator.readCount > 0 ||
    accumulator.searchCount > 0 ||
    accumulator.listCount > 0
  ) {
    return null;
  }

  const supportingLines = [`检查了 ${accumulator.browserCount} 个页面步骤`];
  if (accumulator.latestHint) {
    supportingLines.push(`最近目标：${accumulator.latestHint}`);
  }

  return {
    kind: "browser",
    title: "已检查页面",
    supportingLines,
    countLabel: `${accumulator.browserCount} 步`,
    rawDetailLabel: "展开查看页面操作明细",
  };
}

function buildDescriptorFromEntries(
  entries: ToolLikeDescriptor[],
): ToolBatchSummaryDescriptor | null {
  if (entries.length < 2) {
    return null;
  }

  const accumulator = accumulateBatch(entries);
  return (
    buildExplorationDescriptor(accumulator) ||
    buildBrowserDescriptor(accumulator)
  );
}

export function summarizeStreamingToolBatch(
  toolCalls: ToolCallState[],
): ToolBatchSummaryDescriptor | null {
  return buildDescriptorFromEntries(
    toolCalls.map((toolCall) => ({
      toolName: toolCall.name,
      argumentsValue: toolCall.arguments,
    })),
  );
}

export function summarizeThreadProcessBatch(
  items: AgentThreadItem[],
): ToolBatchSummaryDescriptor | null {
  const processItems = items.filter(isThreadProcessBatchItem);
  if (processItems.length < 2 || processItems.length !== items.length) {
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
      };
    }

    if (item.type === "web_search") {
      const argumentsValue: Record<string, ToolCallArgumentValue> = {
        query: item.query || item.action || "",
      };
      return {
        toolName: item.action || "web_search",
        query: item.query || item.action || null,
        argumentsValue,
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
    };
  });

  return buildDescriptorFromEntries(descriptors);
}
