import type { ContextTraceStep, ToolCallState } from "@/lib/api/agentStream";
import type { ActionRequired, Message } from "../types";

export type HarnessTodoStatus = "pending" | "in_progress" | "completed";
export type HarnessPlanPhase = "idle" | "planning" | "ready";

export interface HarnessTodoItem {
  id: string;
  content: string;
  status: HarnessTodoStatus;
}

export interface HarnessPlanState {
  phase: HarnessPlanPhase;
  items: HarnessTodoItem[];
  sourceToolCallId?: string;
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

export interface HarnessSessionState {
  pendingApprovals: ActionRequired[];
  latestContextTrace: ContextTraceStep[];
  plan: HarnessPlanState;
  activity: HarnessToolActivity;
  delegatedTasks: HarnessDelegatedTask[];
  outputSignals: HarnessOutputSignal[];
  recentFileEvents: HarnessFileEvent[];
  hasSignals: boolean;
}

interface ToolCallEntry {
  toolCall: ToolCallState;
  messageTimestamp: Date;
}

const PLANNING_TOOL_NAMES = new Set([
  "todowrite",
  "writetodos",
  "enterplanmode",
  "exitplanmode",
]);
const TODO_SNAPSHOT_TOOL_NAMES = new Set(["todowrite", "writetodos"]);

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
const SKILL_TOOL_NAMES = new Set(["skill", "threestageworkflow"]);
const PROXYCAST_TOOL_METADATA_BEGIN = "[ProxyCast 工具元数据开始]";
const PROXYCAST_TOOL_METADATA_END = "[ProxyCast 工具元数据结束]";

function normalizeToolName(value: string): string {
  return value
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
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

function extractTodoSnapshot(toolCall: ToolCallState): HarnessTodoItem[] {
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
  const beginIndex = normalized.lastIndexOf(PROXYCAST_TOOL_METADATA_BEGIN);
  const endIndex = normalized.lastIndexOf(PROXYCAST_TOOL_METADATA_END);

  if (beginIndex >= 0 && endIndex >= beginIndex) {
    normalized =
      normalized.slice(0, beginIndex) +
      normalized.slice(endIndex + PROXYCAST_TOOL_METADATA_END.length);
  }

  normalized = normalized.replace(
    /^\[ProxyCast Offload\]\s*完整输出已转存到文件：.+$/gm,
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

function extractMetadata(
  toolCall: ToolCallState,
): Record<string, unknown> | null {
  const direct = asRecord(toolCall.result?.metadata);
  if (direct) return direct;

  const output = toolCall.result?.output;
  if (!output) return null;
  const beginIndex = output.lastIndexOf(PROXYCAST_TOOL_METADATA_BEGIN);
  const endIndex = output.lastIndexOf(PROXYCAST_TOOL_METADATA_END);
  if (beginIndex < 0 || endIndex < beginIndex) {
    return null;
  }

  const raw = output
    .slice(beginIndex + PROXYCAST_TOOL_METADATA_BEGIN.length, endIndex)
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

function pickFirstPath(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
  }

  return undefined;
}

function extractPathFromRecord(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined;
  }

  for (const key of [
    "path",
    "file_path",
    "filePath",
    "file_name",
    "fileName",
    "filename",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
    "absolute_path",
    "absolutePath",
    "new_path",
    "newPath",
    "paths",
    "files",
  ]) {
    const value = pickFirstPath(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
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
    [
      "md",
      "markdown",
      "txt",
      "pdf",
      "doc",
      "docx",
      "csv",
      "rtf",
    ].includes(extension)
  ) {
    return "document";
  }

  return "other";
}

function extractArtifactPath(toolCall: ToolCallState): string | undefined {
  const output = toolCall.result?.output;
  const parsed = asRecord(parseJsonValue(output));
  return (
    normalizeString(parsed?.absolute_path) ||
    normalizeString(parsed?.path) ||
    normalizeString(parsed?.output_path)
  );
}

function extractOutputSignal(
  toolCall: ToolCallState,
): HarnessOutputSignal | null {
  if (!toolCall.result) return null;

  const metadata = extractMetadata(toolCall);
  const output = toolCall.result.output;
  const outputFile =
    normalizeString(metadata?.output_file) ||
    extractRegexValue(/^输出文件:\s*(.+)$/m, output);
  const offloadFile =
    normalizeString(metadata?.offload_file) ||
    extractRegexValue(
      /^\[ProxyCast Offload\]\s*完整输出已转存到文件：(.+)$/m,
      output,
    );
  const artifactPath =
    normalizeString(metadata?.path) || extractArtifactPath(toolCall);
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
    normalizeBoolean(metadata?.proxycast_offloaded) === true ||
    !!offloadFile ||
    output.includes("[ProxyCast Offload]");
  const offloadOriginalChars = normalizeNumber(
    metadata?.offload_original_chars,
  );
  const offloadOriginalTokens = normalizeNumber(
    metadata?.offload_original_tokens,
  );
  const offloadTrigger = normalizeString(metadata?.offload_trigger);
  const preview = buildTextPreview(output);

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
  const path = extractPathFromRecord(args) || extractPathFromRecord(metadata);
  if (!path) {
    return null;
  }

  const timestamp =
    normalizeDate(toolCall.endTime) ?? normalizeDate(toolCall.startTime) ?? undefined;
  const action: HarnessFileAction =
    normalizedName.startsWith("read")
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
    normalizeDate(toolCall.endTime) ?? normalizeDate(toolCall.startTime) ?? undefined;
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

  if (
    name === "task" ||
    name === "taskoutput" ||
    name === "killshell" ||
    name === "bash"
  ) {
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

export function deriveHarnessSessionState(
  messages: Message[],
  pendingApprovals: ActionRequired[],
): HarnessSessionState {
  const safePendingApprovals = Array.isArray(pendingApprovals)
    ? pendingApprovals
    : [];
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

  const planPhase: HarnessPlanPhase =
    latestPlanningTimestamp === 0 &&
    latestExitPlanTimestamp === 0 &&
    latestTodoItems.length === 0
      ? "idle"
      : latestExitPlanTimestamp > 0 &&
          latestExitPlanTimestamp >= latestPlanningTimestamp
        ? "ready"
        : "planning";

  const hasSignals =
    safePendingApprovals.length > 0 ||
    latestContextTrace.length > 0 ||
    latestTodoItems.length > 0 ||
    delegatedTasks.length > 0 ||
    outputSignals.length > 0 ||
    recentFileEvents.length > 0 ||
    Object.values(activity).some((count) => count > 0);

  return {
    pendingApprovals: safePendingApprovals,
    latestContextTrace,
    plan: {
      phase: planPhase,
      items: latestTodoItems,
      sourceToolCallId: latestTodoSourceToolCallId,
    },
    activity,
    delegatedTasks: delegatedTasks.slice(-5).reverse(),
    outputSignals: outputSignals.slice(-5).reverse(),
    recentFileEvents,
    hasSignals,
  };
}
