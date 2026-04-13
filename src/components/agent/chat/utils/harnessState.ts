import type {
  AgentContextTraceStep as ContextTraceStep,
  AgentThreadItem,
  AgentToolCallState as ToolCallState,
} from "@/lib/api/agentProtocol";
import type { ArtifactStatus } from "@/lib/artifact/types";
import {
  extractArtifactProtocolPathsFromValue,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import { extractFilesystemEventPathsFromValue } from "@/lib/filesystem-event-protocol";
import type { ActionRequired, AgentRuntimeStatus, Message } from "../types";
import { resolveUserFacingToolDisplayLabel } from "./toolDisplayInfo";
import { isInternalRoutingTurnSummaryText } from "./turnSummaryPresentation";
import {
  resolveArtifactPreviewText,
  resolveArtifactWritePhase,
} from "./messageArtifacts";

export type HarnessTodoStatus = "pending" | "in_progress" | "completed";
export type HarnessPlanPhase = "idle" | "planning" | "ready";

export interface HarnessTodoItem {
  id: string;
  content: string;
  status: HarnessTodoStatus;
}

type PersistedHarnessTodoLike = {
  id?: string;
  content?: string;
  status?: string;
};

export interface HarnessPlanState {
  phase: HarnessPlanPhase;
  items: HarnessTodoItem[];
  sourceToolCallId?: string;
  summaryText?: string;
}

export interface HarnessToolActivity {
  planning: number;
  filesystem: number;
  execution: number;
  web: number;
  skills: number;
  delegation: number;
}

export interface HarnessDelegatedTask {
  id: string;
  title: string;
  status: ToolCallState["status"];
  taskType?: string;
  role?: string;
  model?: string;
  summary?: string;
  startedAt?: Date;
}

export interface HarnessOutputSignal {
  id: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  preview?: string;
  content?: string;
  outputFile?: string;
  offloadFile?: string;
  artifactPath?: string;
  exitCode?: number;
  stdoutLength?: number;
  stderrLength?: number;
  sandboxed?: boolean;
  truncated?: boolean;
  offloaded?: boolean;
  offloadOriginalChars?: number;
  offloadOriginalTokens?: number;
  offloadTrigger?: string;
}

export type HarnessFileKind =
  | "document"
  | "code"
  | "log"
  | "artifact"
  | "offload"
  | "other";

export type HarnessFileAction =
  | "read"
  | "write"
  | "edit"
  | "offload"
  | "persist";

export interface HarnessFileEvent {
  id: string;
  toolCallId: string;
  path: string;
  displayName: string;
  kind: HarnessFileKind;
  action: HarnessFileAction;
  sourceToolName: string;
  timestamp?: Date;
  preview?: string;
  content?: string;
  clickable: boolean;
}

export interface HarnessActiveFileWrite {
  id: string;
  path: string;
  displayName: string;
  phase: NonNullable<ReturnType<typeof resolveArtifactWritePhase>>;
  status: ArtifactStatus;
  source?: string;
  updatedAt?: Date;
  preview?: string;
  latestChunk?: string;
  content?: string;
}

export interface HarnessSessionState {
  runtimeStatus: AgentRuntimeStatus | null;
  pendingApprovals: ActionRequired[];
  latestContextTrace: ContextTraceStep[];
  plan: HarnessPlanState;
  activity: HarnessToolActivity;
  delegatedTasks: HarnessDelegatedTask[];
  outputSignals: HarnessOutputSignal[];
  activeFileWrites: HarnessActiveFileWrite[];
  recentFileEvents: HarnessFileEvent[];
  hasSignals: boolean;
}

interface ToolCallEntry {
  toolCall: ToolCallState;
  messageTimestamp: Date;
}

function extractLatestRuntimeStatus(
  messages: Message[],
): AgentRuntimeStatus | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.runtimeStatus) {
      return message.runtimeStatus;
    }
  }

  return null;
}

const PLANNING_TOOL_NAMES = new Set([
  "taskcreate",
  "tasklist",
  "taskget",
  "taskupdate",
  "enterplanmode",
  "exitplanmode",
]);
const TODO_SNAPSHOT_TOOL_NAMES = new Set([
  "taskcreate",
  "tasklist",
  "taskupdate",
]);

const FILESYSTEM_TOOL_NAMES = new Set([
  "read",
  "readfile",
  "write",
  "writefile",
  "edit",
  "editfile",
  "multiedit",
  "glob",
  "grep",
  "ls",
  "list",
  "listdirectory",
  "createfile",
]);

const WEB_TOOL_RE = /^(websearch|webfetch)|browser|playwright/i;
const HARNESS_OUTPUT_SIGNAL_LIMIT = 8;
const SKILL_TOOL_NAMES = new Set(["skill", "threestageworkflow"]);
const LIME_TOOL_METADATA_BEGIN = "[Lime 工具元数据开始]";
const LIME_TOOL_METADATA_END = "[Lime 工具元数据结束]";

function normalizeToolName(value: string): string {
  const normalized = value
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
  if (normalized === "task") {
    return "bash";
  }
  if (normalized === "killshell") {
    return "taskstop";
  }
  if (normalized === "todowrite" || normalized === "writetodos") {
    return "taskupdate";
  }
  return normalized;
}

function parseJsonValue(raw?: string): unknown {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const normalized = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function resolveTimestamp(...values: unknown[]): number {
  for (const value of values) {
    const normalized = normalizeDate(value);
    if (normalized) {
      return normalized.getTime();
    }
  }
  return 0;
}

function normalizeTodoStatus(value: unknown): HarnessTodoStatus {
  if (value === true) return "completed";

  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : undefined;
  if (!normalized) return "pending";

  if (normalized === "completed" || normalized === "done") {
    return "completed";
  }
  if (
    normalized === "in_progress" ||
    normalized === "inprogress" ||
    normalized === "active" ||
    normalized === "running"
  ) {
    return "in_progress";
  }
  return "pending";
}

function extractTodoCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = asRecord(value);
  if (!record) return [];

  for (const key of [
    "todos",
    "items",
    "tasks",
    "todo_list",
    "todoList",
    "task_list",
    "taskList",
  ]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeTodoItem(
  value: unknown,
  index: number,
): HarnessTodoItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content =
    (typeof record.content === "string" && record.content.trim()) ||
    (typeof record.text === "string" && record.text.trim()) ||
    (typeof record.title === "string" && record.title.trim()) ||
    (typeof record.task === "string" && record.task.trim()) ||
    (typeof record.label === "string" && record.label.trim()) ||
    "";

  if (!content) return null;

  return {
    id:
      (typeof record.id === "string" && record.id.trim()) ||
      `todo-${index + 1}`,
    content,
    status: normalizeTodoStatus(
      record.status ?? record.done ?? record.completed ?? record.state,
    ),
  };
}

function normalizePersistedTodoItems(
  items?: readonly PersistedHarnessTodoLike[],
): HarnessTodoItem[] {
  return (items || [])
    .map((item, index) => normalizeTodoItem(item, index))
    .filter((item): item is HarnessTodoItem => item !== null);
}

function extractTodoSnapshot(toolCall: ToolCallState): HarnessTodoItem[] {
  const fromMetadata = extractTodoCandidates(extractMetadata(toolCall))
    .map(normalizeTodoItem)
    .filter((item): item is HarnessTodoItem => item !== null);
  if (fromMetadata.length > 0) {
    return fromMetadata;
  }

  const fromArguments = extractTodoCandidates(
    parseJsonValue(toolCall.arguments),
  )
    .map(normalizeTodoItem)
    .filter((item): item is HarnessTodoItem => item !== null);
  if (fromArguments.length > 0) {
    return fromArguments;
  }

  return extractTodoCandidates(parseJsonValue(toolCall.result?.output))
    .map(normalizeTodoItem)
    .filter((item): item is HarnessTodoItem => item !== null);
}

function collectToolCalls(messages: Message[]): ToolCallEntry[] {
  return messages
    .flatMap((message) =>
      (message.toolCalls || []).map((toolCall) => ({
        toolCall,
        messageTimestamp: message.timestamp,
      })),
    )
    .sort((left, right) => {
      const leftTime = resolveTimestamp(
        left.toolCall.startTime,
        left.messageTimestamp,
      );
      const rightTime = resolveTimestamp(
        right.toolCall.startTime,
        right.messageTimestamp,
      );
      return leftTime - rightTime;
    });
}

function summarizeToolOutput(toolCall: ToolCallState): string | undefined {
  const value =
    toolCall.result?.output?.trim() || toolCall.result?.error?.trim();
  if (!value) return undefined;
  return value.length > 160 ? `${value.slice(0, 160)}...` : value;
}

function stripAuxiliaryOutput(raw?: string): string {
  if (!raw) return "";

  let normalized = raw;
  const beginIndex = normalized.lastIndexOf(LIME_TOOL_METADATA_BEGIN);
  const endIndex = normalized.lastIndexOf(LIME_TOOL_METADATA_END);

  if (beginIndex >= 0 && endIndex >= beginIndex) {
    normalized =
      normalized.slice(0, beginIndex) +
      normalized.slice(endIndex + LIME_TOOL_METADATA_END.length);
  }

  normalized = normalized.replace(
    /^\[Lime Offload\]\s*完整输出已转存到文件：.+$/gm,
    "",
  );

  return normalized.trim();
}

function buildTextPreview(
  raw?: string,
  options?: {
    maxLines?: number;
    maxChars?: number;
  },
): string | undefined {
  const normalized = stripAuxiliaryOutput(raw);
  if (!normalized) {
    return undefined;
  }

  const maxLines = options?.maxLines ?? 8;
  const maxChars = options?.maxChars ?? 480;
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || all.length === 1)
    .slice(0, maxLines);

  const preview = lines.join("\n").trim();
  if (!preview) {
    return undefined;
  }

  return preview.length > maxChars
    ? `${preview.slice(0, maxChars).trimEnd()}…`
    : preview;
}

function maybeKeepTextContent(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = stripAuxiliaryOutput(raw);
  if (!normalized || normalized.length > 64 * 1024) {
    return undefined;
  }

  return normalized;
}

function extractActiveFileWrites(
  messages: Message[],
): HarnessActiveFileWrite[] {
  const activeWrites = new Map<string, HarnessActiveFileWrite>();

  for (const message of messages) {
    for (const artifact of message.artifacts || []) {
      const phase = resolveArtifactWritePhase(artifact);
      if (!phase || phase === "completed") {
        continue;
      }

      const path = resolveArtifactProtocolFilePath(artifact);
      if (!path) {
        continue;
      }

      const updatedAt =
        Number.isFinite(artifact.updatedAt) && artifact.updatedAt > 0
          ? new Date(artifact.updatedAt)
          : undefined;
      const preview = buildTextPreview(
        typeof artifact.meta.previewText === "string"
          ? artifact.meta.previewText
          : resolveArtifactPreviewText(artifact),
        {
          maxLines: 4,
          maxChars: 240,
        },
      );
      const latestChunk = buildTextPreview(
        typeof artifact.meta.latestChunk === "string"
          ? artifact.meta.latestChunk
          : undefined,
        {
          maxLines: 3,
          maxChars: 180,
        },
      );
      const nextWrite: HarnessActiveFileWrite = {
        id: artifact.id,
        path,
        displayName: fileNameFromPath(path),
        phase,
        status: artifact.status,
        source:
          typeof artifact.meta.lastUpdateSource === "string"
            ? artifact.meta.lastUpdateSource
            : typeof artifact.meta.source === "string"
              ? artifact.meta.source
              : undefined,
        updatedAt,
        preview,
        latestChunk,
        content: maybeKeepTextContent(artifact.content),
      };
      const previous = activeWrites.get(nextWrite.id);
      if (!previous) {
        activeWrites.set(nextWrite.id, nextWrite);
        continue;
      }

      const previousTime = previous.updatedAt?.getTime() ?? 0;
      const nextTime = nextWrite.updatedAt?.getTime() ?? 0;
      if (nextTime >= previousTime) {
        activeWrites.set(nextWrite.id, nextWrite);
      }
    }
  }

  return Array.from(activeWrites.values())
    .sort((left, right) => {
      const leftTime = left.updatedAt?.getTime() ?? 0;
      const rightTime = right.updatedAt?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 5);
}

function extractMetadata(
  toolCall: ToolCallState,
): Record<string, unknown> | null {
  const direct = asRecord(toolCall.result?.metadata);
  if (direct) return direct;

  const output = toolCall.result?.output;
  if (!output) return null;
  const beginIndex = output.lastIndexOf(LIME_TOOL_METADATA_BEGIN);
  const endIndex = output.lastIndexOf(LIME_TOOL_METADATA_END);
  if (beginIndex < 0 || endIndex < beginIndex) {
    return null;
  }

  const raw = output
    .slice(beginIndex + LIME_TOOL_METADATA_BEGIN.length, endIndex)
    .trim();
  if (!raw) return null;

  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

function extractRegexValue(pattern: RegExp, text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(pattern);
  const value = match?.[1]?.trim();
  return value || undefined;
}

function parseNumberFromText(
  pattern: RegExp,
  text?: string,
): number | undefined {
  const value = extractRegexValue(pattern, text);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBooleanFromText(
  pattern: RegExp,
  text?: string,
): boolean | undefined {
  const value = extractRegexValue(pattern, text);
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function extractContentFromRecord(
  record: Record<string, unknown> | null,
): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of [
    "content",
    "new_str",
    "newText",
    "text",
    "body",
    "value",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function extractSearchQuery(
  record: Record<string, unknown> | null,
): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of [
    "q",
    "query",
    "question",
    "search",
    "keywords",
    "keyword",
    "url",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolveFileKind(
  path: string,
  preferred?: HarnessFileKind,
): HarnessFileKind {
  if (preferred) {
    return preferred;
  }

  const extension = fileNameFromPath(path).split(".").pop()?.toLowerCase();
  if (!extension) {
    return "other";
  }

  if (["log", "out", "err"].includes(extension)) {
    return "log";
  }

  if (
    [
      "rs",
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "go",
      "java",
      "c",
      "cpp",
      "h",
      "json",
      "yaml",
      "yml",
      "toml",
      "sql",
      "sh",
      "bash",
      "zsh",
      "html",
      "css",
      "scss",
      "xml",
    ].includes(extension)
  ) {
    return "code";
  }

  if (
    ["md", "markdown", "txt", "pdf", "doc", "docx", "csv", "rtf"].includes(
      extension,
    )
  ) {
    return "document";
  }

  return "other";
}

function extractArtifactPath(toolCall: ToolCallState): string | undefined {
  const output = toolCall.result?.output;
  return extractArtifactProtocolPathsFromValue(parseJsonValue(output))[0];
}

function extractOutputSignal(
  toolCall: ToolCallState,
): HarnessOutputSignal | null {
  if (!toolCall.result) return null;

  const metadata = extractMetadata(toolCall);
  const argumentsRecord = asRecord(parseJsonValue(toolCall.arguments));
  const normalizedName = normalizeToolName(toolCall.name);
  const output = toolCall.result.output;
  const outputFile =
    normalizeString(metadata?.output_file) ||
    extractRegexValue(/^输出文件:\s*(.+)$/m, output);
  const offloadFile =
    normalizeString(metadata?.offload_file) ||
    extractRegexValue(
      /^\[Lime Offload\]\s*完整输出已转存到文件：(.+)$/m,
      output,
    );
  const artifactPath =
    extractArtifactProtocolPathsFromValue(metadata)[0] ||
    extractArtifactPath(toolCall);
  const exitCode =
    normalizeNumber(metadata?.exit_code) ||
    parseNumberFromText(/^退出码:\s*(-?\d+)$/m, output) ||
    parseNumberFromText(/^exit_code:\s*(-?\d+)$/m, output) ||
    parseNumberFromText(/Command exited with code (-?\d+)/, output);
  const stdoutLength =
    normalizeNumber(metadata?.stdout_length) ||
    parseNumberFromText(/^stdout_length:\s*(\d+)$/m, output);
  const stderrLength =
    normalizeNumber(metadata?.stderr_length) ||
    parseNumberFromText(/^stderr_length:\s*(\d+)$/m, output);
  const sandboxed =
    normalizeBoolean(metadata?.sandboxed) ||
    parseBooleanFromText(/^sandboxed:\s*(true|false)$/m, output);
  const outputTruncatedFromSummary = parseBooleanFromText(
    /^output_truncated:\s*(true|false)$/m,
    output,
  );
  const truncated =
    output.includes("[event_converter] 工具输出已截断") ||
    output.includes("[output truncated:") ||
    outputTruncatedFromSummary === true;
  const offloaded =
    normalizeBoolean(metadata?.lime_offloaded) === true ||
    !!offloadFile ||
    output.includes("[Lime Offload]");
  const offloadOriginalChars = normalizeNumber(
    metadata?.offload_original_chars,
  );
  const offloadOriginalTokens = normalizeNumber(
    metadata?.offload_original_tokens,
  );
  const offloadTrigger = normalizeString(metadata?.offload_trigger);
  const preview = buildTextPreview(output);
  const content = maybeKeepTextContent(output);
  const searchQuery =
    extractSearchQuery(argumentsRecord) ||
    extractSearchQuery(metadata) ||
    extractRegexValue(/^(?:query|q|搜索词|检索词):\s*(.+)$/im, output);

  if (
    !outputFile &&
    !offloadFile &&
    !artifactPath &&
    exitCode === undefined &&
    stdoutLength === undefined &&
    stderrLength === undefined &&
    sandboxed === undefined &&
    !truncated &&
    !offloaded
  ) {
    if (WEB_TOOL_RE.test(normalizedName) && (preview || content)) {
      const queryLabel = searchQuery || toolCall.name;
      const searchLike = !/^https?:\/\//i.test(queryLabel);
      return {
        id: `${toolCall.id}:output-signal`,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        title: searchLike ? "联网检索摘要" : "网页访问摘要",
        summary: queryLabel,
        preview,
        content,
      };
    }
    return null;
  }

  const summaryParts: string[] = [];
  let title = "工具输出信号";

  if (outputFile) {
    title = "任务输出已落盘";
    summaryParts.push(fileNameFromPath(outputFile));
  }

  if (offloadFile) {
    title = outputFile ? title : "工具输出已转存";
    summaryParts.push(fileNameFromPath(offloadFile));
  }

  if (artifactPath) {
    title = outputFile || offloadFile ? title : "产物已写入";
    summaryParts.push(fileNameFromPath(artifactPath));
  }

  if (exitCode !== undefined) {
    title = outputFile || offloadFile || artifactPath ? title : "命令执行摘要";
    summaryParts.push(`退出码 ${exitCode}`);
  }

  if (stdoutLength !== undefined) {
    summaryParts.push(`stdout ${stdoutLength}`);
  }

  if (stderrLength !== undefined) {
    summaryParts.push(`stderr ${stderrLength}`);
  }

  if (sandboxed !== undefined) {
    summaryParts.push(sandboxed ? "已隔离执行" : "普通执行");
  }

  if (truncated) {
    title =
      outputFile || offloadFile || artifactPath ? title : "工具输出已截断";
    summaryParts.push("输出已截断");
  }

  if (offloaded) {
    title =
      outputFile || offloadFile || artifactPath ? title : "工具输出已转存";
    summaryParts.push("完整输出已转存");
  }

  if (offloadOriginalChars !== undefined) {
    summaryParts.push(`原始 ${offloadOriginalChars} 字符`);
  }
  if (offloadOriginalTokens !== undefined) {
    summaryParts.push(`约 ${offloadOriginalTokens} tokens`);
  }
  if (offloadTrigger) {
    summaryParts.push(
      offloadTrigger === "history_context_pressure"
        ? "上下文压力触发"
        : offloadTrigger === "token_limit_before_evict"
          ? "token 阈值触发"
          : offloadTrigger === "payload_bytes"
            ? "字节阈值触发"
            : offloadTrigger === "payload_chars"
              ? "字符阈值触发"
              : offloadTrigger,
    );
  }

  return {
    id: `${toolCall.id}:output-signal`,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    title,
    summary: summaryParts.join(" / ") || "存在可观测输出信号",
    preview,
    content,
    outputFile,
    offloadFile,
    artifactPath,
    exitCode,
    stdoutLength,
    stderrLength,
    sandboxed,
    truncated,
    offloaded,
    offloadOriginalChars,
    offloadOriginalTokens,
    offloadTrigger,
  };
}

function extractFileEventFromToolCall(
  toolCall: ToolCallState,
  normalizedName: string,
): HarnessFileEvent | null {
  if (
    !FILESYSTEM_TOOL_NAMES.has(normalizedName) &&
    normalizedName !== "read_file" &&
    normalizedName !== "write_file" &&
    normalizedName !== "edit_file"
  ) {
    return null;
  }

  const args = asRecord(parseJsonValue(toolCall.arguments));
  const metadata = extractMetadata(toolCall);
  const path =
    extractArtifactProtocolPathsFromValue(args)[0] ||
    extractArtifactProtocolPathsFromValue(metadata)[0] ||
    // 非 artifact 协议文件工具仍可能只暴露通用文件参数，这里保留事件级 fallback。
    extractFilesystemEventPathsFromValue(args)[0] ||
    extractFilesystemEventPathsFromValue(metadata)[0];
  if (!path) {
    return null;
  }

  const timestamp =
    normalizeDate(toolCall.endTime) ??
    normalizeDate(toolCall.startTime) ??
    undefined;
  const action: HarnessFileAction = normalizedName.startsWith("read")
    ? "read"
    : normalizedName.includes("edit")
      ? "edit"
      : "write";
  const sourceContent =
    action === "read"
      ? toolCall.result?.output
      : extractContentFromRecord(args) ||
        normalizeString(metadata?.content) ||
        toolCall.result?.output;
  const content = maybeKeepTextContent(sourceContent);
  const preview = buildTextPreview(sourceContent);

  return {
    id: `${toolCall.id}:file:${action}:${path}`,
    toolCallId: toolCall.id,
    path,
    displayName: fileNameFromPath(path),
    kind: resolveFileKind(path),
    action,
    sourceToolName: toolCall.name,
    timestamp,
    preview,
    content,
    clickable: true,
  };
}

function extractFileEventsFromOutputSignal(
  signal: HarnessOutputSignal,
  toolCall: ToolCallState,
): HarnessFileEvent[] {
  const timestamp =
    normalizeDate(toolCall.endTime) ??
    normalizeDate(toolCall.startTime) ??
    undefined;
  const events: HarnessFileEvent[] = [];

  if (signal.outputFile) {
    events.push({
      id: `${signal.id}:output-file`,
      toolCallId: toolCall.id,
      path: signal.outputFile,
      displayName: fileNameFromPath(signal.outputFile),
      kind: resolveFileKind(signal.outputFile, "log"),
      action: "persist",
      sourceToolName: signal.toolName,
      timestamp,
      preview: signal.preview,
      clickable: true,
    });
  }

  if (signal.offloadFile) {
    events.push({
      id: `${signal.id}:offload-file`,
      toolCallId: toolCall.id,
      path: signal.offloadFile,
      displayName: fileNameFromPath(signal.offloadFile),
      kind: "offload",
      action: "offload",
      sourceToolName: signal.toolName,
      timestamp,
      preview: signal.preview,
      clickable: true,
    });
  }

  if (signal.artifactPath) {
    events.push({
      id: `${signal.id}:artifact-file`,
      toolCallId: toolCall.id,
      path: signal.artifactPath,
      displayName: fileNameFromPath(signal.artifactPath),
      kind: resolveFileKind(signal.artifactPath, "artifact"),
      action: "persist",
      sourceToolName: signal.toolName,
      timestamp,
      preview: signal.preview,
      clickable: true,
    });
  }

  return events;
}

function mergeFileEvent(
  previous: HarnessFileEvent | undefined,
  next: HarnessFileEvent,
): HarnessFileEvent {
  if (!previous) {
    return next;
  }

  return {
    ...previous,
    ...next,
    preview: next.preview || previous.preview,
    content: next.content || previous.content,
    timestamp: next.timestamp || previous.timestamp,
    clickable: previous.clickable || next.clickable,
  };
}

function isPlanningTool(name: string): boolean {
  return PLANNING_TOOL_NAMES.has(name);
}

function classifyToolActivity(
  activity: HarnessToolActivity,
  name: string,
): void {
  if (isPlanningTool(name)) {
    activity.planning += 1;
    return;
  }

  if (name === "subagenttask") {
    activity.delegation += 1;
    return;
  }

  if (name === "taskoutput" || name === "taskstop" || name === "bash") {
    activity.execution += 1;
    return;
  }

  if (FILESYSTEM_TOOL_NAMES.has(name)) {
    activity.filesystem += 1;
    return;
  }

  if (WEB_TOOL_RE.test(name)) {
    activity.web += 1;
    return;
  }

  if (SKILL_TOOL_NAMES.has(name)) {
    activity.skills += 1;
  }
}

function extractDelegatedTask(toolCall: ToolCallState): HarnessDelegatedTask {
  const args = asRecord(parseJsonValue(toolCall.arguments));
  const title =
    (typeof args?.description === "string" && args.description.trim()) ||
    (typeof args?.prompt === "string" && args.prompt.trim()) ||
    "子任务委派";

  return {
    id: toolCall.id,
    title,
    status: toolCall.status,
    taskType:
      typeof args?.taskType === "string"
        ? args.taskType
        : typeof args?.task_type === "string"
          ? args.task_type
          : undefined,
    role: typeof args?.role === "string" ? args.role : undefined,
    model: typeof args?.model === "string" ? args.model : undefined,
    summary: summarizeToolOutput(toolCall),
    startedAt: normalizeDate(toolCall.startTime) ?? undefined,
  };
}

function parsePlanTextToTodoItems(text: string): HarnessTodoItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(\d+\.\s+|[-*]\s+|\[[ xX]\]\s+)/.test(line))
    .map((line, index) => {
      const completed = /^\[[xX]\]/.test(line);
      return {
        id: `plan-${index + 1}`,
        content: line.replace(/^(\d+\.\s+|[-*]\s+|\[[ xX]\]\s+)/, "").trim(),
        status: completed ? "completed" : "pending",
      } as HarnessTodoItem;
    })
    .filter((item) => item.content.length > 0);
}

function itemTimestamp(item: AgentThreadItem): number {
  return resolveTimestamp(item.completed_at, item.updated_at, item.started_at);
}

function pickItemPath(item: AgentThreadItem): string | undefined {
  if (item.type === "file_artifact") {
    return item.path;
  }

  if (item.type === "tool_call") {
    return extractArtifactProtocolPathsFromValue(item.metadata)[0];
  }

  return undefined;
}

function toActionRequired(item: AgentThreadItem): ActionRequired | null {
  if (item.type === "approval_request") {
    return {
      requestId: item.request_id,
      actionType: item.action_type as ActionRequired["actionType"],
      prompt: item.prompt,
      toolName: item.tool_name,
      arguments: asRecord(item.arguments) || undefined,
      status: item.status === "completed" ? "submitted" : "pending",
      submittedUserData: item.response,
      submittedResponse:
        typeof item.response === "string" ? item.response : undefined,
    };
  }

  if (item.type === "request_user_input") {
    return {
      requestId: item.request_id,
      actionType: item.action_type as ActionRequired["actionType"],
      prompt: item.prompt,
      questions: item.questions?.map((question) => ({
        question: question.question,
        header: question.header,
        options: question.options?.map((option) => ({
          label: option.label,
          description: option.description,
        })),
        multiSelect: question.multi_select,
      })),
      status: item.status === "completed" ? "submitted" : "pending",
      submittedUserData: item.response,
      submittedResponse:
        typeof item.response === "string" ? item.response : undefined,
    };
  }

  return null;
}

function summarizePlanDecisionText(text?: string): string | undefined {
  if (isInternalRoutingTurnSummaryText(text)) {
    return undefined;
  }

  return buildTextPreview(text, {
    maxLines: 4,
    maxChars: 240,
  });
}

function deriveHarnessSessionStateFromItems(
  messages: Message[],
  pendingApprovals: ActionRequired[],
  items: AgentThreadItem[],
  persistedTodoItems: HarnessTodoItem[],
): HarnessSessionState {
  const safePendingApprovals = Array.isArray(pendingApprovals)
    ? pendingApprovals
    : [];
  const sortedItems = [...items].sort(
    (left, right) => itemTimestamp(left) - itemTimestamp(right),
  );
  const latestContextTrace =
    [...messages]
      .reverse()
      .find(
        (message) =>
          Array.isArray(message.contextTrace) &&
          message.contextTrace.length > 0,
      )?.contextTrace || [];
  const runtimeStatus = extractLatestRuntimeStatus(messages);
  const activeFileWrites = extractActiveFileWrites(messages);

  const activity: HarnessToolActivity = {
    planning: 0,
    filesystem: 0,
    execution: 0,
    web: 0,
    skills: 0,
    delegation: 0,
  };
  const delegatedTasks: HarnessDelegatedTask[] = [];
  const outputSignals: HarnessOutputSignal[] = [];
  const recentFileEvents: HarnessFileEvent[] = [];
  const derivedApprovalMap = new Map<string, ActionRequired>();
  let latestPlanItem: AgentThreadItem | null = null;
  let latestTurnSummaryItem: Extract<
    AgentThreadItem,
    { type: "turn_summary" }
  > | null = null;

  for (const item of sortedItems) {
    switch (item.type) {
      case "plan":
        activity.planning += 1;
        latestPlanItem = item;
        break;
      case "file_artifact": {
        activity.filesystem += 1;
        recentFileEvents.push({
          id: item.id,
          toolCallId: item.id,
          path: item.path,
          displayName: fileNameFromPath(item.path),
          kind: resolveFileKind(item.path, "artifact"),
          action: "persist",
          sourceToolName: "Artifact",
          timestamp:
            normalizeDate(item.completed_at || item.updated_at) ?? undefined,
          preview: buildTextPreview(item.content),
          content: maybeKeepTextContent(item.content),
          clickable: true,
        });
        outputSignals.push({
          id: `${item.id}:artifact`,
          toolCallId: item.id,
          toolName: "artifact",
          title: "产物已写入",
          summary: fileNameFromPath(item.path),
          preview: buildTextPreview(item.content),
          content: maybeKeepTextContent(item.content),
          artifactPath: item.path,
        });
        break;
      }
      case "command_execution":
        activity.execution += 1;
        outputSignals.push({
          id: `${item.id}:command`,
          toolCallId: item.id,
          toolName: "command_execution",
          title: "命令执行摘要",
          summary: item.command,
          preview: buildTextPreview(item.aggregated_output),
          content: maybeKeepTextContent(item.aggregated_output),
          exitCode: item.exit_code,
        });
        break;
      case "web_search":
        activity.web += 1;
        outputSignals.push({
          id: `${item.id}:web`,
          toolCallId: item.id,
          toolName: item.action || "web_search",
          title: "联网检索摘要",
          summary: item.query || "联网检索",
          preview: buildTextPreview(item.output),
          content: maybeKeepTextContent(item.output),
        });
        break;
      case "turn_summary":
        activity.planning += 1;
        latestTurnSummaryItem = item;
        outputSignals.push({
          id: `${item.id}:summary`,
          toolCallId: item.id,
          toolName: "turn_summary",
          title: "当前任务摘要",
          summary: item.text.split(/\r?\n/)[0] || "当前进展",
          preview: buildTextPreview(item.text),
          content: maybeKeepTextContent(item.text),
        });
        break;
      case "tool_call": {
        const normalizedName = normalizeToolName(item.tool_name);
        classifyToolActivity(activity, normalizedName);
        const artifactPath = pickItemPath(item);
        const argumentRecord = asRecord(item.arguments);
        const queryLabel = extractSearchQuery(argumentRecord);
        const searchLike = WEB_TOOL_RE.test(normalizedName);
        outputSignals.push({
          id: `${item.id}:tool`,
          toolCallId: item.id,
          toolName: item.tool_name,
          title: artifactPath
            ? "产物已写入"
            : searchLike
              ? /^https?:\/\//i.test(queryLabel || "")
                ? "网页访问摘要"
                : "联网检索摘要"
              : "处理摘要",
          summary:
            artifactPath ||
            queryLabel ||
            resolveUserFacingToolDisplayLabel(item.tool_name),
          preview: buildTextPreview(item.output),
          content: maybeKeepTextContent(item.output),
          artifactPath,
        });
        if (artifactPath) {
          recentFileEvents.push({
            id: `${item.id}:tool-file`,
            toolCallId: item.id,
            path: artifactPath,
            displayName: fileNameFromPath(artifactPath),
            kind: resolveFileKind(artifactPath, "artifact"),
            action: "persist",
            sourceToolName: item.tool_name,
            timestamp:
              normalizeDate(item.completed_at || item.updated_at) ?? undefined,
            preview: buildTextPreview(item.output),
            content: maybeKeepTextContent(item.output),
            clickable: true,
          });
        }
        break;
      }
      case "subagent_activity":
        activity.delegation += 1;
        delegatedTasks.push({
          id: item.id,
          title: item.title || "子任务",
          status:
            item.status === "failed"
              ? "failed"
              : item.status === "completed"
                ? "completed"
                : "running",
          role: item.role,
          model: item.model,
          summary: item.summary,
          startedAt: normalizeDate(item.started_at) ?? undefined,
        });
        break;
      case "approval_request":
      case "request_user_input": {
        const derived = toActionRequired(item);
        if (derived) {
          derivedApprovalMap.set(derived.requestId, derived);
        }
        break;
      }
      default:
        break;
    }
  }

  const derivedPlanItems =
    latestPlanItem && latestPlanItem.type === "plan"
      ? parsePlanTextToTodoItems(latestPlanItem.text)
      : [];
  const planItems =
    derivedPlanItems.length > 0 ? derivedPlanItems : persistedTodoItems;
  const planSummaryText =
    planItems.length > 0
      ? undefined
      : summarizePlanDecisionText(latestTurnSummaryItem?.text);
  const mergedApprovals = [...safePendingApprovals];
  for (const derived of derivedApprovalMap.values()) {
    if (!mergedApprovals.some((item) => item.requestId === derived.requestId)) {
      mergedApprovals.push(derived);
    }
  }

  const planPhase: HarnessPlanPhase = !latestPlanItem
    ? planSummaryText
      ? "ready"
      : "idle"
    : latestPlanItem.status === "completed"
      ? "ready"
      : "planning";
  const hasSignals =
    runtimeStatus !== null ||
    mergedApprovals.length > 0 ||
    latestContextTrace.length > 0 ||
    planItems.length > 0 ||
    delegatedTasks.length > 0 ||
    outputSignals.length > 0 ||
    activeFileWrites.length > 0 ||
    recentFileEvents.length > 0 ||
    Object.values(activity).some((count) => count > 0);

  return {
    runtimeStatus,
    pendingApprovals: mergedApprovals,
    latestContextTrace,
    plan: {
      phase: planPhase,
      items: planItems,
      sourceToolCallId: latestPlanItem?.id || latestTurnSummaryItem?.id,
      summaryText: planSummaryText,
    },
    activity,
    delegatedTasks: delegatedTasks.slice(-5).reverse(),
    outputSignals: outputSignals.slice(-HARNESS_OUTPUT_SIGNAL_LIMIT).reverse(),
    activeFileWrites,
    recentFileEvents: recentFileEvents
      .sort((left, right) => {
        const leftTime = left.timestamp?.getTime() ?? 0;
        const rightTime = right.timestamp?.getTime() ?? 0;
        return rightTime - leftTime;
      })
      .slice(0, 5),
    hasSignals,
  };
}

function deriveHarnessSessionStateFromMessages(
  messages: Message[],
  pendingApprovals: ActionRequired[],
  persistedTodoItems: HarnessTodoItem[],
): HarnessSessionState {
  const safePendingApprovals = Array.isArray(pendingApprovals)
    ? pendingApprovals
    : [];
  const runtimeStatus = extractLatestRuntimeStatus(messages);
  const activeFileWrites = extractActiveFileWrites(messages);
  const toolCalls = collectToolCalls(messages);
  const activity: HarnessToolActivity = {
    planning: 0,
    filesystem: 0,
    execution: 0,
    web: 0,
    skills: 0,
    delegation: 0,
  };

  let latestTodoItems: HarnessTodoItem[] = [];
  let latestTodoSourceToolCallId: string | undefined;
  let latestPlanningTimestamp = 0;
  let latestExitPlanTimestamp = 0;
  let latestDecisionSummaryText: string | undefined;
  const delegatedTasks: HarnessDelegatedTask[] = [];
  const outputSignals: HarnessOutputSignal[] = [];
  const recentFileEventMap = new Map<string, HarnessFileEvent>();

  for (const entry of toolCalls) {
    const normalizedName = normalizeToolName(entry.toolCall.name);
    const timestamp = resolveTimestamp(
      entry.toolCall.endTime,
      entry.toolCall.startTime,
      entry.messageTimestamp,
    );

    classifyToolActivity(activity, normalizedName);

    if (TODO_SNAPSHOT_TOOL_NAMES.has(normalizedName)) {
      latestPlanningTimestamp = Math.max(latestPlanningTimestamp, timestamp);
      const snapshot = extractTodoSnapshot(entry.toolCall);
      if (snapshot.length > 0) {
        latestTodoItems = snapshot;
        latestTodoSourceToolCallId = entry.toolCall.id;
      }
      continue;
    }

    if (normalizedName === "enterplanmode") {
      latestPlanningTimestamp = Math.max(latestPlanningTimestamp, timestamp);
      continue;
    }

    if (
      normalizedName === "exitplanmode" &&
      entry.toolCall.status === "completed"
    ) {
      latestExitPlanTimestamp = Math.max(latestExitPlanTimestamp, timestamp);
      continue;
    }

    if (normalizedName === "subagenttask") {
      delegatedTasks.push(extractDelegatedTask(entry.toolCall));
    }

    const fileEvent = extractFileEventFromToolCall(
      entry.toolCall,
      normalizedName,
    );
    if (fileEvent) {
      recentFileEventMap.set(
        fileEvent.id,
        mergeFileEvent(recentFileEventMap.get(fileEvent.id), fileEvent),
      );
    }

    const outputSignal = extractOutputSignal(entry.toolCall);
    if (outputSignal) {
      outputSignals.push(outputSignal);
      const outputFileEvents = extractFileEventsFromOutputSignal(
        outputSignal,
        entry.toolCall,
      );
      outputFileEvents.forEach((event) => {
        recentFileEventMap.set(
          event.id,
          mergeFileEvent(recentFileEventMap.get(event.id), event),
        );
      });
    }
  }

  const recentFileEvents = [...recentFileEventMap.values()]
    .sort((left, right) => {
      const leftTime = left.timestamp?.getTime() ?? 0;
      const rightTime = right.timestamp?.getTime() ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, 5);

  const latestContextTrace =
    [...messages]
      .reverse()
      .find(
        (message) =>
          Array.isArray(message.contextTrace) &&
          message.contextTrace.length > 0,
      )?.contextTrace || [];

  if (latestTodoItems.length === 0) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") {
        continue;
      }
      latestDecisionSummaryText = summarizePlanDecisionText(message.content);
      if (latestDecisionSummaryText) {
        break;
      }
    }
  }

  if (latestTodoItems.length === 0 && persistedTodoItems.length > 0) {
    latestTodoItems = persistedTodoItems;
  }

  const planPhase: HarnessPlanPhase =
    latestPlanningTimestamp === 0 &&
    latestExitPlanTimestamp === 0 &&
    latestTodoItems.length === 0 &&
    !latestDecisionSummaryText
      ? "idle"
      : latestTodoItems.length === 0 &&
          latestPlanningTimestamp === 0 &&
          latestExitPlanTimestamp === 0 &&
          latestDecisionSummaryText
        ? "ready"
        : latestExitPlanTimestamp > 0 &&
            latestExitPlanTimestamp >= latestPlanningTimestamp
          ? "ready"
          : "planning";

  const hasSignals =
    runtimeStatus !== null ||
    safePendingApprovals.length > 0 ||
    latestContextTrace.length > 0 ||
    latestTodoItems.length > 0 ||
    delegatedTasks.length > 0 ||
    outputSignals.length > 0 ||
    activeFileWrites.length > 0 ||
    recentFileEvents.length > 0 ||
    Object.values(activity).some((count) => count > 0);

  return {
    runtimeStatus,
    pendingApprovals: safePendingApprovals,
    latestContextTrace,
    plan: {
      phase: planPhase,
      items: latestTodoItems,
      sourceToolCallId: latestTodoSourceToolCallId,
      summaryText:
        latestTodoItems.length === 0 ? latestDecisionSummaryText : undefined,
    },
    activity,
    delegatedTasks: delegatedTasks.slice(-5).reverse(),
    outputSignals: outputSignals.slice(-HARNESS_OUTPUT_SIGNAL_LIMIT).reverse(),
    activeFileWrites,
    recentFileEvents,
    hasSignals,
  };
}

export function deriveHarnessSessionState(
  messages: Message[],
  pendingApprovals: ActionRequired[],
  threadItems?: AgentThreadItem[],
  persistedTodoItems?: readonly PersistedHarnessTodoLike[],
): HarnessSessionState {
  const normalizedPersistedTodoItems =
    normalizePersistedTodoItems(persistedTodoItems);
  if (Array.isArray(threadItems) && threadItems.length > 0) {
    return deriveHarnessSessionStateFromItems(
      messages,
      pendingApprovals,
      threadItems,
      normalizedPersistedTodoItems,
    );
  }

  return deriveHarnessSessionStateFromMessages(
    messages,
    pendingApprovals,
    normalizedPersistedTodoItems,
  );
}
