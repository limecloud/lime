import { parseAIResponse } from "@/lib/workspace/a2ui";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import {
  extractFilesystemEventLocationHintsFromValue,
  extractFilesystemEventPathsFromValue,
} from "@/lib/filesystem-event-protocol";
import type { AgentThreadItem, AgentThreadItemStatus } from "../types";
import { resolveInternalImageTaskDisplayName } from "./internalImagePlaceholder";
import { resolveUserFacingToolDisplayLabel } from "./toolDisplayInfo";
import { isInternalRoutingTurnSummaryText } from "./turnSummaryPresentation";
import { summarizeThreadProcessBatch } from "./toolBatchGrouping";
import { resolveAgentThreadToolProcessPreview } from "./toolProcessSummary";
import { normalizeProcessDisplayText } from "./processDisplayText";

export type AgentThreadGroupKind =
  | "process"
  | "approval"
  | "alert"
  | "artifact"
  | "subagent"
  | "other";

export interface AgentThreadSummaryChip {
  kind: Exclude<AgentThreadGroupKind, "approval" | "alert" | "other">;
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
  kind: Exclude<AgentThreadGroupKind, "other">;
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
  return (value || "")
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
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

function extractThinkingPreviewLine(
  text: string | undefined | null,
): string | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }

  if (!STRUCTURED_CONTENT_HINT_RE.test(normalized)) {
    return firstMeaningfulLine(normalizeProcessDisplayText(normalized));
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

  return firstMeaningfulLine(normalizeProcessDisplayText(normalized));
}

function shortenText(
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

function mergeStatuses(
  statuses: AgentThreadItemStatus[],
): AgentThreadItemStatus {
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
  if (item.type === "web_search" || item.type === "command_execution") {
    return false;
  }

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
  return ["search", "websearch", "query", "find", "grep", "fetch"].some(
    (marker) => normalized.includes(marker),
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
  if (item.type === "approval_request" || item.type === "request_user_input") {
    return "approval";
  }

  if (item.type === "warning" || item.type === "error") {
    return "alert";
  }

  if (item.type === "subagent_activity") {
    return "subagent";
  }

  if (item.type === "file_artifact") {
    return "artifact";
  }

  return "process";
}

function resolveGroupTitle(
  kind: Exclude<AgentThreadGroupKind, "other">,
): string {
  switch (kind) {
    case "process":
      return "执行过程";
    case "approval":
      return "等你确认";
    case "alert":
      return "提醒和错误";
    case "artifact":
      return "文件和产物";
    case "subagent":
      return "子任务";
    default:
      return "执行过程";
  }
}

function resolveBlockTitle(kind: AgentThreadGroupKind): string {
  if (kind === "other") {
    return "执行过程";
  }
  return resolveGroupTitle(kind);
}

function resolveCountLabel(kind: AgentThreadGroupKind, count: number): string {
  switch (kind) {
    case "process":
      return `${count} 步`;
    case "artifact":
      return `${count} 份`;
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
    return prefixAction(item.query || item.action || "联网搜索", "搜了 ", [
      "搜了 ",
      "查了 ",
      "搜索了 ",
      "检索了 ",
    ]);
  }

  if (item.type !== "tool_call") {
    return null;
  }

  const args = asRecord(item.arguments);
  return prefixAction(
    readString(args, ["query", "q", "pattern", "search", "url"]) ||
      resolveUserFacingToolDisplayLabel(item.tool_name),
    "搜了 ",
    ["搜了 ", "查了 ", "搜索了 ", "检索了 "],
  );
}

function summarizeFileItem(item: AgentThreadItem): string | null {
  const path = resolvePathFromItem(item);
  const fileLabel = path ? fileNameFromPath(path) : null;

  if (item.type === "file_artifact") {
    return prefixAction(fileLabel || item.path, "生成了 ", [
      "生成了 ",
      "产出了 ",
      "保存了 ",
      "修改了 ",
      "查看了 ",
      "处理了 ",
    ]);
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
        fileLabel || resolveUserFacingToolDisplayLabel(item.tool_name),
        "查看了 ",
        ["查看了 ", "看了 ", "读了 ", "保存了 ", "修改了 ", "处理了 "],
      );
    }

    if (
      normalized.includes("write") ||
      normalized.includes("create") ||
      normalized.includes("mkdir") ||
      normalized.includes("save")
    ) {
      return prefixAction(
        fileLabel || resolveUserFacingToolDisplayLabel(item.tool_name),
        "保存了 ",
        ["保存了 ", "写了 ", "查看了 ", "修改了 ", "处理了 "],
      );
    }

    if (
      normalized.includes("edit") ||
      normalized.includes("patch") ||
      normalized.includes("replace") ||
      normalized.includes("update")
    ) {
      return prefixAction(
        fileLabel || resolveUserFacingToolDisplayLabel(item.tool_name),
        "修改了 ",
        ["修改了 ", "改了 ", "查看了 ", "保存了 ", "处理了 "],
      );
    }

    return prefixAction(
      fileLabel || resolveUserFacingToolDisplayLabel(item.tool_name),
      "处理了 ",
      ["处理了 ", "查看了 ", "保存了 ", "修改了 ", "生成了 "],
    );
  }

  return null;
}

function summarizeCommandItem(item: AgentThreadItem): string | null {
  if (item.type === "command_execution") {
    return prefixAction(
      item.command,
      "运行了 ",
      ["执行了 ", "跑了 ", "运行了 "],
      64,
    );
  }

  if (item.type === "tool_call") {
    const args = asRecord(item.arguments);
    return prefixAction(
      readString(args, ["command", "cmd", "script"]) ||
        resolveUserFacingToolDisplayLabel(item.tool_name),
      "运行了 ",
      ["执行了 ", "跑了 ", "运行了 "],
      64,
    );
  }

  return null;
}

function summarizeCollaborationItem(item: AgentThreadItem): string | null {
  if (item.type !== "tool_call") {
    return null;
  }

  const normalized = normalizeToolName(item.tool_name);
  const args = asRecord(item.arguments);

  if (normalized === "agent") {
    return prefixAction(
      readString(args, [
        "description",
        "task",
        "taskType",
        "role",
        "agent_type",
      ]) || "子任务",
      "分给子任务处理 ",
      [
        "分给子任务",
        "子任务处理中 ",
        "分给协作成员",
        "协作中 ",
        "邀请 ",
        "已邀请 ",
      ],
    );
  }

  if (normalized === "sendmessage") {
    return prefixAction(
      readString(args, ["id", "agent_id", "message"]) || "目标子任务",
      "补充说明 ",
      ["补充说明 ", "已补充说明 ", "发送给 "],
    );
  }

  if (normalized === "teamcreate") {
    return prefixAction(
      readString(args, ["team_name", "teamName"]) || "当前团队",
      "已创建 ",
      ["已创建 ", "创建了 "],
    );
  }

  if (normalized === "teamdelete") {
    return prefixAction(
      readString(args, ["team_name", "teamName"]) || "当前团队",
      "已删除 ",
      ["已删除 ", "删除了 "],
    );
  }

  if (normalized === "listpeers") {
    return prefixAction(
      readString(args, ["team_name", "teamName"]) || "当前团队",
      "已查看 ",
      ["已查看 ", "查看了 ", "已列出 ", "列出了 "],
    );
  }

  if (normalized === "waitagent") {
    return prefixAction(
      readString(args, ["id", "ids", "session_id"]) || "任务进展",
      "已查看 ",
      ["已查看 ", "查看了 "],
    );
  }

  if (normalized === "resumeagent") {
    return prefixAction(
      readString(args, ["id", "ids", "session_id"]) || "当前任务",
      "已继续 ",
      ["已继续 ", "继续了 "],
    );
  }

  if (normalized === "closeagent") {
    return prefixAction(
      readString(args, ["id", "ids", "session_id"]) || "当前任务",
      "已暂停 ",
      ["已暂停 ", "暂停了 "],
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
      "子任务",
    "分给子任务处理 ",
    ["分给子任务", "子任务", "分给协作成员", "协作成员"],
  );
}

function summarizeAlertItem(item: AgentThreadItem): string | null {
  if (item.type === "warning") {
    return prefixAction(item.message, "收到提醒：", [
      "收到提醒：",
      "碰到错误：",
    ]);
  }
  if (item.type === "error") {
    return prefixAction(item.message, "碰到错误：", [
      "收到提醒：",
      "碰到错误：",
    ]);
  }
  return null;
}

function summarizeOtherItem(item: AgentThreadItem): string | null {
  if (item.type === "tool_call") {
    const normalized = normalizeToolName(item.tool_name);
    const args = asRecord(item.arguments);

    if (normalized === "askuserquestion") {
      return prefixAction(
        readString(args, ["question", "prompt", "header"]) || "等你确认这一步",
        "等你确认：",
        ["等你确认：", "等你补充："],
      );
    }

    if (normalized === "taskoutput") {
      return prefixAction(
        readString(args, ["task_id", "taskId", "subject"]) || "任务结果",
        "已查看结果 ",
        ["已查看结果 ", "查看了 "],
      );
    }

    if (normalized === "listskills") {
      return "已查看技能列表";
    }

    if (normalized === "loadskill") {
      return prefixAction(
        readString(args, ["name", "skill", "path"]) || "技能",
        "已加载 ",
        ["已加载 ", "加载了 "],
      );
    }

    if (normalized === "skill") {
      return prefixAction(
        readString(args, ["name", "skill", "path", "command"]) || "技能",
        "已使用 ",
        ["已使用 ", "用了 "],
      );
    }

    if (normalized === "sendusermessage" || normalized === "brief") {
      return prefixAction(
        readString(args, ["message"]) ||
          resolveUserFacingToolDisplayLabel(item.tool_name),
        "已发送 ",
        ["已发送 ", "发送了 "],
      );
    }

    return prefixAction(
      resolveUserFacingToolDisplayLabel(item.tool_name),
      "处理了 ",
      ["处理了 ", "执行了 ", "跑了 ", "运行了 "],
    );
  }
  return null;
}

function summarizeThinkingItem(item: AgentThreadItem): string | null {
  if (item.type === "turn_summary") {
    if (isInternalRoutingTurnSummaryText(item.text)) {
      return null;
    }

    const preview = extractThinkingPreviewLine(item.text);
    if (!preview) {
      return item.status === "in_progress" ? "处理中" : "当前进展";
    }

    return shortenText(preview);
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
  kind: Exclude<AgentThreadGroupKind, "other">,
  item: AgentThreadItem,
): string | null {
  switch (kind) {
    case "process":
      if (
        item.type === "tool_call" ||
        item.type === "command_execution" ||
        item.type === "web_search"
      ) {
        const processPreview = resolveAgentThreadToolProcessPreview(item);
        if (processPreview) {
          return processPreview;
        }
      }
      if (
        item.type === "plan" ||
        item.type === "reasoning" ||
        item.type === "turn_summary" ||
        item.type === "context_compaction"
      ) {
        return summarizeThinkingItem(item);
      }
      {
        const collaborationSummary = summarizeCollaborationItem(item);
        if (collaborationSummary) {
          return collaborationSummary;
        }
      }
      if (isBrowserItem(item)) {
        return summarizeBrowserItem(item);
      }
      if (isSearchItem(item)) {
        return summarizeSearchItem(item);
      }
      if (isFileItem(item)) {
        return summarizeFileItem(item);
      }
      if (isCommandItem(item)) {
        return summarizeCommandItem(item);
      }
      return summarizeOtherItem(item);
    case "artifact":
      return summarizeFileItem(item);
    case "subagent":
      return summarizeSubagentItem(item);
    case "alert":
      return summarizeAlertItem(item);
    case "approval":
      if (
        item.type === "approval_request" ||
        item.type === "request_user_input"
      ) {
        const fallback =
          item.action_type === "ask_user"
            ? "等你补充信息"
            : item.action_type === "elicitation"
              ? "等你进一步确认"
              : "等你确认这一步";
        const promptPrefix =
          item.action_type === "ask_user" ? "等你补充：" : "等你确认：";

        return prefixAction(item.prompt || fallback, promptPrefix, [
          "等你补充：",
          "等你确认：",
          "等你补充信息",
          "等你确认这一步",
        ]);
      }
      return null;
    default:
      return summarizeOtherItem(item);
  }
}

function summarizeBlockPreviewLine(
  kind: AgentThreadGroupKind,
  item: AgentThreadItem,
): string | null {
  if (kind === "other") {
    return summarizeOtherItem(item);
  }

  return summarizeGroupPreviewLine(kind, item);
}

function buildPreviewLines(
  kind: AgentThreadGroupKind,
  items: AgentThreadItem[],
): string[] {
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

function shouldDefaultExpand(
  kind: AgentThreadGroupKind,
  status: AgentThreadItemStatus,
): boolean {
  if (kind === "approval" || kind === "alert") {
    return true;
  }
  return status !== "completed";
}

function buildSummaryText(items: AgentThreadItem[]): string | null {
  const sortedThinking = items
    .filter(
      (item) =>
        item.type === "plan" ||
        item.type === "reasoning" ||
        item.type === "turn_summary" ||
        item.type === "context_compaction",
    )
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
    (item) =>
      item.type === "plan" ||
      item.type === "reasoning" ||
      item.type === "turn_summary" ||
      item.type === "context_compaction",
  );
  const orderedBlocks: AgentThreadOrderedBlock[] = [];
  const groups: AgentThreadSemanticGroup[] = [];
  let current: {
    kind: AgentThreadGroupKind;
    items: AgentThreadItem[];
  } | null = null;

  const pushCurrentBlock = () => {
    if (!current) {
      return;
    }

    const status = mergeStatuses(current.items.map((entry) => entry.status));
    const processBatchSummary =
      current.kind === "process"
        ? summarizeThreadProcessBatch(current.items)
        : null;
    const startedAt =
      current.items[0]?.started_at || current.items[0]?.updated_at || "";
    const completedAt = current.items[current.items.length - 1]?.completed_at;
    const block: AgentThreadOrderedBlock = {
      id: current.items.map((entry) => entry.id).join(":"),
      kind: current.kind,
      title: processBatchSummary?.title || resolveBlockTitle(current.kind),
      status,
      items: current.items,
      previewLines:
        processBatchSummary?.supportingLines ||
        buildPreviewLines(current.kind, current.items),
      countLabel:
        processBatchSummary?.countLabel ||
        resolveCountLabel(current.kind, current.items.length),
      rawDetailLabel:
        processBatchSummary?.rawDetailLabel ||
        (current.kind === "approval"
          ? "查看待处理项"
          : current.kind === "artifact"
            ? "查看产物"
            : current.kind === "subagent"
              ? "查看子任务详情"
              : "查看执行过程"),
      defaultExpanded: shouldDefaultExpand(current.kind, status),
      startedAt,
      completedAt,
    };

    orderedBlocks.push(block);

    if (current.kind !== "other") {
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
    if (group.kind === "approval" || group.kind === "alert") {
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
