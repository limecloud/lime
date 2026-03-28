import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import {
  extractFilesystemEventLocationHintsFromValue,
  extractFilesystemEventPathsFromValue,
} from "@/lib/filesystem-event-protocol";
import type { AgentThreadItem, AgentThreadItemStatus } from "../types";
import { resolveInternalImageTaskDisplayName } from "./internalImagePlaceholder";
import { resolveToolDisplayLabel } from "./toolDisplayInfo";

export type AgentThreadGroupKind =
  | "thinking"
  | "approval"
  | "alert"
  | "browser"
  | "search"
  | "file"
  | "command"
  | "subagent"
  | "other";

export interface AgentThreadSummaryChip {
  kind: Exclude<AgentThreadGroupKind, "thinking" | "approval" | "alert" | "other">;
  label: string;
  count: number;
}

export interface AgentThreadOrderedBlock {
  id: string;
  kind: AgentThreadGroupKind;
  title: string;
  status: AgentThreadItemStatus;
  items: AgentThreadItem[];
  previewLines: string[];
  countLabel: string;
  rawDetailLabel: string;
  defaultExpanded: boolean;
  startedAt: string;
  completedAt?: string;
}

export interface AgentThreadSemanticGroup {
  id: string;
  kind: Exclude<AgentThreadGroupKind, "thinking">;
  title: string;
  status: AgentThreadItemStatus;
  items: AgentThreadItem[];
  previewLines: string[];
  countLabel: string;
  rawDetailLabel: string;
  defaultExpanded: boolean;
}

export interface AgentThreadDisplayModel {
  summaryText: string | null;
  thinkingItems: AgentThreadItem[];
  groups: AgentThreadSemanticGroup[];
  orderedBlocks: AgentThreadOrderedBlock[];
  summaryChips: AgentThreadSummaryChip[];
}

const STRUCTURED_CONTENT_HINT_RE = /<a2ui|```\s*a2ui/i;

function normalizeToolName(value: string | undefined): string {
  return (value || "").replace(/[\s_-]+/g, "").trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | null {
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

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function firstMeaningfulLine(text: string | undefined | null): string | null {
  const normalized = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return normalized || null;
}

function extractThinkingPreviewLine(text: string | undefined | null): string | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }

  if (!STRUCTURED_CONTENT_HINT_RE.test(normalized)) {
    return firstMeaningfulLine(normalized);
  }

  const parsed = parseAIResponse(normalized, false);
  for (const part of parsed.parts) {
    if (part.type === "pending_a2ui") {
      return "在整理表单";
    }

    if (part.type === "a2ui") {
      return "已整理成表单";
    }

    if (typeof part.content === "string") {
      const line = firstMeaningfulLine(part.content);
      if (line) {
        return line;
      }
    }
  }

  return firstMeaningfulLine(normalized);
}

function shortenText(value: string | null | undefined, maxLength = 72): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function startsWithAnyPrefix(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function prefixAction(
  value: string | null | undefined,
  prefix: string,
  knownPrefixes: string[],
  maxLength = 72,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (startsWithAnyPrefix(normalized, knownPrefixes)) {
    return shortenText(normalized, maxLength);
  }

  return shortenText(`${prefix}${normalized}`, maxLength);
}

function resolveItemTimestamp(item: AgentThreadItem): string {
  return item.completed_at || item.updated_at || item.started_at;
}

function compareItems(left: AgentThreadItem, right: AgentThreadItem): number {
  const leftTimestamp = resolveItemTimestamp(left);
  const rightTimestamp = resolveItemTimestamp(right);
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.id.localeCompare(right.id);
}

function mergeStatuses(statuses: AgentThreadItemStatus[]): AgentThreadItemStatus {
  if (statuses.some((status) => status === "in_progress")) {
    return "in_progress";
  }
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }
  return "completed";
}

function resolvePathFromItem(item: AgentThreadItem): string | null {
  if (item.type === "file_artifact") {
    return item.path;
  }

  if (item.type !== "tool_call") {
    return null;
  }

  const protocolPath =
    extractArtifactProtocolPathsFromValue(item.arguments)[0] ||
    extractArtifactProtocolPathsFromValue(item.metadata)[0];
  if (protocolPath) {
    return protocolPath;
  }

  return (
    extractFilesystemEventPathsFromValue(item.arguments)[0] ||
    extractFilesystemEventPathsFromValue(item.metadata)[0] ||
    extractFilesystemEventLocationHintsFromValue(item.arguments)[0] ||
    extractFilesystemEventLocationHintsFromValue(item.metadata)[0] ||
    null
  );
}

function resolveUrlFromItem(item: AgentThreadItem): string | null {
  if (item.type === "web_search") {
    return null;
  }

  if (item.type !== "tool_call") {
    return null;
  }

  const metadata = asRecord(item.metadata);
  const args = asRecord(item.arguments);
  return (
    readString(args, ["url", "pageUrl", "page_url"]) ||
    readString(metadata, ["url", "page_url", "pageUrl"])
  );
}

function isBrowserItem(item: AgentThreadItem): boolean {
  if (item.type !== "tool_call") {
    return false;
  }

  const normalized = normalizeToolName(item.tool_name);
  const metadata = asRecord(item.metadata);
  const toolFamily = readString(metadata, ["tool_family", "toolFamily"]);

  if (toolFamily === "browser") {
    return true;
  }

  return [
    "browser",
    "page",
    "runtime",
    "dom",
    "cdp",
    "playwright",
    "navigate",
    "screenshot",
    "snapshot",
    "click",
    "hover",
    "presskey",
    "type",
    "selectoption",
    "drag",
    "evaluate",
    "goto",
  ].some((marker) => normalized.includes(marker));
}

function isSearchItem(item: AgentThreadItem): boolean {
  if (item.type === "web_search") {
    return true;
  }

  if (item.type !== "tool_call") {
    return false;
  }

  const normalized = normalizeToolName(item.tool_name);
  return ["search", "websearch", "query", "find", "grep", "fetch"].some((marker) =>
    normalized.includes(marker),
  );
}

function isFileItem(item: AgentThreadItem): boolean {
  if (item.type === "file_artifact") {
    return true;
  }

  if (item.type !== "tool_call") {
    return false;
  }

  if (resolvePathFromItem(item)) {
    return true;
  }

  const normalized = normalizeToolName(item.tool_name);
  return [
    "write",
    "read",
    "edit",
    "patch",
    "file",
    "listdir",
    "mkdir",
    "create",
  ].some((marker) => normalized.includes(marker));
}

function isCommandItem(item: AgentThreadItem): boolean {
  if (item.type === "command_execution") {
    return true;
  }

  if (item.type !== "tool_call") {
    return false;
  }

  const normalized = normalizeToolName(item.tool_name);
  return ["exec", "bash", "shell", "terminal", "command"].some((marker) =>
    normalized.includes(marker),
  );
}

function classifyItemKind(item: AgentThreadItem): AgentThreadGroupKind {
  if (
    item.type === "plan" ||
    item.type === "reasoning" ||
    item.type === "turn_summary" ||
    item.type === "context_compaction"
  ) {
    return "thinking";
  }

  if (item.type === "approval_request" || item.type === "request_user_input") {
    return "approval";
  }

  if (item.type === "warning" || item.type === "error") {
    return "alert";
  }

  if (item.type === "subagent_activity") {
    return "subagent";
  }

  if (isBrowserItem(item)) {
    return "browser";
  }

  if (isSearchItem(item)) {
    return "search";
  }

  if (isFileItem(item)) {
    return "file";
  }

  if (isCommandItem(item)) {
    return "command";
  }

  return "other";
}

function resolveGroupTitle(kind: Exclude<AgentThreadGroupKind, "thinking">): string {
  switch (kind) {
    case "approval":
      return "等你确认";
    case "alert":
      return "提醒和错误";
    case "browser":
      return "页面操作";
    case "search":
      return "联网搜索";
    case "file":
      return "文件和产物";
    case "command":
      return "命令";
    case "subagent":
      return "协作成员";
    case "other":
    default:
      return "执行过程";
  }
}

function resolveBlockTitle(kind: AgentThreadGroupKind): string {
  if (kind === "thinking") {
    return "思考";
  }

  return resolveGroupTitle(kind);
}

function resolveCountLabel(kind: AgentThreadGroupKind, count: number): string {
  switch (kind) {
    case "thinking":
      return `${count} 项`;
    case "browser":
      return `${count} 步`;
    case "search":
      return `${count} 次`;
    case "subagent":
      return `${count} 个任务`;
    default:
      return `${count} 项`;
  }
}

function summarizeBrowserItem(item: AgentThreadItem): string | null {
  if (item.type !== "tool_call") {
    return null;
  }

  const normalized = normalizeToolName(item.tool_name);
  const url = resolveUrlFromItem(item);
  const args = asRecord(item.arguments);
  const target = readString(args, [
    "selector",
    "element",
    "target",
    "label",
    "text",
    "ref",
    "uid",
  ]);

  if (normalized.includes("navigate") || normalized.includes("goto")) {
    return shortenText(url ? `打开了 ${url}` : "打开了页面");
  }
  if (normalized.includes("click")) {
    return shortenText(target ? `点了 ${target}` : "点了页面元素");
  }
  if (
    normalized.includes("type") ||
    normalized.includes("presskey") ||
    normalized.includes("fill") ||
    normalized.includes("selectoption")
  ) {
    return shortenText(target ? `填了 ${target}` : "填了页面内容");
  }
  if (normalized.includes("screenshot") || normalized.includes("snapshot")) {
    return shortenText(url ? `抓了 ${url} 的快照` : "抓了页面快照");
  }
  if (normalized.includes("evaluate") || normalized.includes("runtime")) {
    return shortenText(url ? `看了 ${url} 的页面信息` : "看了页面信息");
  }
  return shortenText(url ? `做了 ${url} 的页面操作` : "做了页面操作");
}

function summarizeSearchItem(item: AgentThreadItem): string | null {
  if (item.type === "web_search") {
    return prefixAction(
      item.query || item.action || "联网搜索",
      "搜了 ",
      ["搜了 ", "查了 ", "搜索了 ", "检索了 "],
    );
  }

  if (item.type !== "tool_call") {
    return null;
  }

  const args = asRecord(item.arguments);
  return prefixAction(
    readString(args, ["query", "q", "pattern", "search", "url"]) ||
      resolveToolDisplayLabel(item.tool_name),
    "搜了 ",
    ["搜了 ", "查了 ", "搜索了 ", "检索了 "],
  );
}

function summarizeFileItem(item: AgentThreadItem): string | null {
  const path = resolvePathFromItem(item);
  const fileLabel = path ? fileNameFromPath(path) : null;

  if (item.type === "file_artifact") {
    return prefixAction(
      fileLabel || item.path,
      "产出了 ",
      ["产出了 ", "写了 ", "改了 ", "看了 ", "动了 "],
    );
  }

  if (item.type === "tool_call") {
    const normalized = normalizeToolName(item.tool_name);

    if (
      normalized.includes("read") ||
      normalized.includes("view") ||
      normalized.includes("cat") ||
      normalized.includes("open") ||
      normalized.includes("list")
    ) {
      return prefixAction(
        fileLabel || resolveToolDisplayLabel(item.tool_name),
        "看了 ",
        ["看了 ", "读了 ", "写了 ", "改了 ", "动了 ", "产出了 "],
      );
    }

    if (
      normalized.includes("write") ||
      normalized.includes("create") ||
      normalized.includes("mkdir") ||
      normalized.includes("save")
    ) {
      return prefixAction(
        fileLabel || resolveToolDisplayLabel(item.tool_name),
        "写了 ",
        ["看了 ", "读了 ", "写了 ", "改了 ", "动了 ", "产出了 "],
      );
    }

    if (
      normalized.includes("edit") ||
      normalized.includes("patch") ||
      normalized.includes("replace") ||
      normalized.includes("update")
    ) {
      return prefixAction(
        fileLabel || resolveToolDisplayLabel(item.tool_name),
        "改了 ",
        ["看了 ", "读了 ", "写了 ", "改了 ", "动了 ", "产出了 "],
      );
    }

    return prefixAction(
      fileLabel || resolveToolDisplayLabel(item.tool_name),
      "动了 ",
      ["看了 ", "读了 ", "写了 ", "改了 ", "动了 ", "产出了 "],
    );
  }

  return null;
}

function summarizeCommandItem(item: AgentThreadItem): string | null {
  if (item.type === "command_execution") {
    return prefixAction(
      item.command,
      "执行了 ",
      ["执行了 ", "跑了 ", "运行了 "],
      64,
    );
  }

  if (item.type === "tool_call") {
    const args = asRecord(item.arguments);
    return prefixAction(
      readString(args, ["command", "cmd", "script"]) ||
        resolveToolDisplayLabel(item.tool_name),
      "执行了 ",
      ["执行了 ", "跑了 ", "运行了 "],
      64,
    );
  }

  return null;
}

function summarizeSubagentItem(item: AgentThreadItem): string | null {
  if (item.type !== "subagent_activity") {
    return null;
  }
  return prefixAction(
    resolveInternalImageTaskDisplayName(item.title) ||
      item.summary ||
      item.status_label ||
      "协作任务",
    "分给协作成员处理 ",
    ["分给协作成员", "协作成员"],
  );
}

function summarizeAlertItem(item: AgentThreadItem): string | null {
  if (item.type === "warning") {
    return prefixAction(
      item.message,
      "收到提醒：",
      ["收到提醒：", "碰到错误："],
    );
  }
  if (item.type === "error") {
    return prefixAction(
      item.message,
      "碰到错误：",
      ["收到提醒：", "碰到错误："],
    );
  }
  return null;
}

function summarizeOtherItem(item: AgentThreadItem): string | null {
  if (item.type === "tool_call") {
    return prefixAction(
      resolveToolDisplayLabel(item.tool_name),
      "执行了 ",
      ["执行了 ", "跑了 ", "运行了 "],
    );
  }
  return null;
}

function summarizeThinkingItem(item: AgentThreadItem): string | null {
  if (item.type === "turn_summary") {
    const preview = extractThinkingPreviewLine(item.text);
    if (!preview) {
      return item.status === "in_progress" ? "思考中" : "已完成思考";
    }

    if (startsWithAnyPrefix(preview, ["在整理表单", "已整理成表单"])) {
      return preview;
    }

    return prefixAction(
      preview,
      "已决定：",
      ["已决定：", "决定了：", "思考中", "已完成思考"],
    );
  }

  if (item.type === "context_compaction") {
    return shortenText(
      item.detail ||
        (item.stage === "completed" ? "压了上下文" : "正在压上下文"),
    );
  }

  if (item.type === "reasoning") {
    return (
      extractThinkingPreviewLine(item.summary?.join("；") || item.text) ||
      (item.status === "in_progress" ? "思考中" : "已完成思考")
    );
  }

  if (item.type === "plan") {
    return item.status === "in_progress" ? "还在排步骤" : "定了执行步骤";
  }

  return null;
}

function summarizeGroupPreviewLine(
  kind: Exclude<AgentThreadGroupKind, "thinking">,
  item: AgentThreadItem,
): string | null {
  switch (kind) {
    case "browser":
      return summarizeBrowserItem(item);
    case "search":
      return summarizeSearchItem(item);
    case "file":
      return summarizeFileItem(item);
    case "command":
      return summarizeCommandItem(item);
    case "subagent":
      return summarizeSubagentItem(item);
    case "alert":
      return summarizeAlertItem(item);
    case "approval":
      if (item.type === "approval_request" || item.type === "request_user_input") {
        const fallback =
          item.action_type === "ask_user"
            ? "等你补充信息"
            : item.action_type === "elicitation"
              ? "等你进一步确认"
              : "等你确认这一步";
        const promptPrefix = item.action_type === "ask_user" ? "等你补充：" : "等你确认：";

        return prefixAction(
          item.prompt || fallback,
          promptPrefix,
          ["等你补充：", "等你确认：", "等你补充信息", "等你确认这一步"],
        );
      }
      return null;
    case "other":
    default:
      return summarizeOtherItem(item);
  }
}

function summarizeBlockPreviewLine(
  kind: AgentThreadGroupKind,
  item: AgentThreadItem,
): string | null {
  if (kind === "thinking") {
    return summarizeThinkingItem(item);
  }

  return summarizeGroupPreviewLine(kind, item);
}

function buildPreviewLines(kind: AgentThreadGroupKind, items: AgentThreadItem[]): string[] {
  const lines: string[] = [];

  for (const item of items) {
    const summary = summarizeBlockPreviewLine(kind, item);
    if (!summary || lines.includes(summary)) {
      continue;
    }
    lines.push(summary);
    if (lines.length >= 3) {
      break;
    }
  }

  return lines;
}

function shouldDefaultExpand(kind: AgentThreadGroupKind, status: AgentThreadItemStatus): boolean {
  if (kind === "approval" || kind === "alert") {
    return true;
  }
  return status !== "completed";
}

function buildSummaryText(items: AgentThreadItem[]): string | null {
  const sortedThinking = items
    .filter((item) => classifyItemKind(item) === "thinking")
    .sort(compareItems);

  for (let index = sortedThinking.length - 1; index >= 0; index -= 1) {
    const candidate = summarizeThinkingItem(sortedThinking[index]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function buildAgentThreadDisplayModel(
  items: AgentThreadItem[],
): AgentThreadDisplayModel {
  const sortedItems = [...items].sort(compareItems);
  const thinkingItems = sortedItems.filter(
    (item) => classifyItemKind(item) === "thinking",
  );
  const orderedBlocks: AgentThreadOrderedBlock[] = [];
  const groups: AgentThreadSemanticGroup[] = [];
  let current:
    | {
        kind: AgentThreadGroupKind;
        items: AgentThreadItem[];
      }
    | null = null;

  const pushCurrentBlock = () => {
    if (!current) {
      return;
    }

    const status = mergeStatuses(current.items.map((entry) => entry.status));
    const startedAt = current.items[0]?.started_at || current.items[0]?.updated_at || "";
    const completedAt = current.items[current.items.length - 1]?.completed_at;
    const block: AgentThreadOrderedBlock = {
      id: current.items.map((entry) => entry.id).join(":"),
      kind: current.kind,
      title: resolveBlockTitle(current.kind),
      status,
      items: current.items,
      previewLines: buildPreviewLines(current.kind, current.items),
      countLabel: resolveCountLabel(current.kind, current.items.length),
      rawDetailLabel:
        current.kind === "thinking"
          ? "查看处理思路"
          : current.kind === "approval"
            ? "查看待处理项"
            : "查看执行过程",
      defaultExpanded: shouldDefaultExpand(current.kind, status),
      startedAt,
      completedAt,
    };

    orderedBlocks.push(block);

    if (current.kind !== "thinking") {
      groups.push({
        id: block.id,
        kind: current.kind,
        title: block.title,
        status: block.status,
        items: block.items,
        previewLines: block.previewLines,
        countLabel: block.countLabel,
        rawDetailLabel: block.rawDetailLabel,
        defaultExpanded: block.defaultExpanded,
      });
    }
  };

  for (const item of sortedItems) {
    const kind = classifyItemKind(item);
    if (!current || current.kind !== kind) {
      pushCurrentBlock();
      current = { kind, items: [item] };
      continue;
    }

    current.items.push(item);
  }

  pushCurrentBlock();

  const summaryCounts = new Map<
    AgentThreadSummaryChip["kind"],
    AgentThreadSummaryChip
  >();

  for (const group of groups) {
    if (
      group.kind === "approval" ||
      group.kind === "alert" ||
      group.kind === "other"
    ) {
      continue;
    }

    const existing = summaryCounts.get(group.kind);
    if (existing) {
      existing.count += group.items.length;
      continue;
    }

    summaryCounts.set(group.kind, {
      kind: group.kind,
      label: group.title,
      count: group.items.length,
    });
  }

  return {
    summaryText: buildSummaryText(sortedItems),
    thinkingItems,
    groups,
    orderedBlocks,
    summaryChips: Array.from(summaryCounts.values()),
  };
}
