import type {
  AgentToolCallState as ToolCallState,
  AgentToolResultImage as ToolResultImage,
} from "@/lib/api/agentProtocol";

import { isUnifiedWebSearchToolName } from "../utils/searchResultPreview";
import { stripTerminalControlSequences } from "../utils/terminalOutputText";
import type { ToolCallArgumentValue } from "../utils/toolDisplayInfo";
import {
  buildToolGroupHeadline as buildToolGroupHeadlineFromInfo,
  getToolDisplayInfo as getToolDisplayInfoFromInfo,
  normalizeToolNameKey as normalizeToolNameKeyFromInfo,
  parseToolCallArguments as parseToolCallArgumentsFromInfo,
  resolveToolFilePath as resolveToolFilePathFromInfo,
  resolveToolPrimarySubject as resolveToolPrimarySubjectFromInfo,
} from "../utils/toolDisplayInfo";

export interface ToolResultNotice {
  key: string;
  text: string;
  tone: "neutral" | "success" | "warning" | "error";
}

export interface SkillInvocationContentInfo {
  isSkillInvocation: boolean;
  skillName: string | null;
  displayName: string | null;
  snapshotContent: string | null;
  markdownContentBytes: number | null;
  isSnapshotStandard: boolean | null;
}

export interface CommandToolSummary {
  command: string | null;
  cwd: string | null;
  exitCode: number | null;
  stdoutLength: number | null;
  stderrLength: number | null;
  sandboxed: boolean | null;
  sandboxType: string | null;
  outputTruncated: boolean | null;
  shell: string | null;
  executionSurface: string | null;
  encoding: string | null;
  stderrEncoding: string | null;
  decodedWith: string | null;
}

export interface CommandOutputStream {
  key: "stdout" | "stderr";
  content: string;
  tone: "neutral" | "error";
}

export type ToolResultMetaNoticeKey = "truncatedPreview" | "commandFailed";

export interface ToolResultPathPresentation {
  value: string;
  displayValue: string;
}

export type ToolCallDisplayGroup =
  | {
      type: "search";
      id: string;
      items: ToolCallState[];
    }
  | {
      type: "work";
      id: string;
      items: ToolCallState[];
    }
  | {
      type: "single";
      id: string;
      item: ToolCallState;
    };

export function inferCodeLanguageFromPath(path?: string | null): string | null {
  if (!path) return null;
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "html":
      return "html";
    case "css":
      return "css";
    default:
      return null;
  }
}

export const looksLikeMarkdown = (value: string): boolean =>
  /(^|\n)(#{1,6}\s|\d+\.\s|[-*]\s|>\s|\|.+\|)|```/.test(value);

export const looksLikeStructuredCode = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // 结果不是 JSON 时继续用代码启发式判断。
    }
  }

  return /(^|\n)\s*(import |export |const |let |var |function |class |interface |type )/.test(
    value,
  );
};

export function shouldRenderResultAsCodeBlock(params: {
  toolCall: ToolCallState;
  content: string;
  language?: string | null;
}): boolean {
  const { toolCall, content, language } = params;
  if (language) {
    return true;
  }
  if (content.includes("```")) {
    return false;
  }
  if (looksLikeStructuredCode(content)) {
    return true;
  }

  const normalizedName = normalizeToolNameKeyFromInfo(toolCall.name);
  if (
    getToolDisplayInfoFromInfo(
      toolCall.name,
      toolCall.status,
      toolCall.metadata,
    ).family !== "browser" &&
    (normalizedName.includes("bash") ||
      normalizedName.includes("shell") ||
      normalizedName.includes("exec"))
  ) {
    return true;
  }

  return content.split("\n").length >= 4 && !looksLikeMarkdown(content);
}

export function buildRenderedToolResultContent(params: {
  toolCall: ToolCallState;
  content: string;
  filePath?: string | null;
  resultPath?: string | null;
  emptyOutputLabel: string;
}): string {
  const { toolCall, filePath, resultPath, emptyOutputLabel } = params;
  const content =
    getToolDisplayInfoFromInfo(
      toolCall.name,
      toolCall.status,
      toolCall.metadata,
    ).family === "command"
      ? stripTerminalControlSequences(params.content)
      : params.content;
  if (!content.trim() || content === emptyOutputLabel) {
    return `\`\`\`text\n${emptyOutputLabel}\n\`\`\``;
  }
  if (content.includes("```")) {
    return content;
  }

  const language = inferCodeLanguageFromPath(resultPath || filePath);
  if (
    shouldRenderResultAsCodeBlock({
      toolCall,
      content,
      language,
    })
  ) {
    return `\`\`\`${language ?? "text"}\n${content}\n\`\`\``;
  }

  return content;
}

export function resolveUserFacingPathName(
  path: string | null | undefined,
): string | null {
  const trimmed = path?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) || trimmed;
}

export function buildToolResultMetaNoticeKeys(params: {
  metadata?: Record<string, unknown>;
  isResultFailure: boolean;
}): ToolResultMetaNoticeKey[] {
  const { metadata, isResultFailure } = params;
  if (!metadata) return [];

  const items: ToolResultMetaNoticeKey[] = [];
  if (metadata.lime_offloaded === true || metadata.output_truncated === true) {
    items.push("truncatedPreview");
  }
  if (typeof metadata.exit_code === "number" && isResultFailure) {
    items.push("commandFailed");
  }
  return items;
}

export function resolveToolResultPath(
  metadata?: Record<string, unknown>,
): ToolResultPathPresentation | null {
  if (!metadata) return null;

  for (const key of ["offload_file", "output_file", "path"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      const fullPath = value.trim();
      return {
        value: fullPath,
        displayValue: resolveUserFacingPathName(fullPath) || fullPath,
      };
    }
  }
  return null;
}

export function isGroupableToolCall(toolCall: ToolCallState): boolean {
  if (isUnifiedWebSearchToolName(toolCall.name)) {
    return true;
  }

  return toolCall.status === "completed" || toolCall.status === "failed";
}

export function resolveToolGroupKey(toolCall: ToolCallState): string {
  if (isUnifiedWebSearchToolName(toolCall.name)) {
    return "search";
  }

  const info = getToolDisplayInfoFromInfo(
    toolCall.name,
    toolCall.status,
    toolCall.metadata,
  );
  return `${info.groupTitle}:${toolCall.status}`;
}

export function buildToolGroupPreview(
  toolCalls: ToolCallState[],
  formatHiddenCount: (count: number) => string,
): string {
  const previews = toolCalls
    .slice(0, 2)
    .map((toolCall) => {
      const args = parseToolCallArgumentsFromInfo(toolCall.arguments);
      const filePath = resolveToolFilePathFromInfo(args);
      return (
        resolveToolPrimarySubjectFromInfo(
          toolCall.name,
          args,
          filePath,
          toolCall.metadata,
        ) || toolCall.name
      );
    })
    .filter(Boolean);

  const hiddenCount = Math.max(toolCalls.length - previews.length, 0);
  return hiddenCount > 0
    ? `${previews.join(" · ")} ${formatHiddenCount(hiddenCount)}`
    : previews.join(" · ");
}

export function buildToolCallDisplayGroups(
  toolCalls: ToolCallState[],
): ToolCallDisplayGroup[] {
  const groups: ToolCallDisplayGroup[] = [];

  for (const toolCall of toolCalls) {
    const isSearch = isUnifiedWebSearchToolName(toolCall.name);
    const lastGroup = groups[groups.length - 1];
    if (isSearch && lastGroup && lastGroup.type === "search") {
      lastGroup.items.push(toolCall);
      continue;
    }

    if (isSearch) {
      groups.push({
        type: "search",
        id: `search-group:${toolCall.id}`,
        items: [toolCall],
      });
      continue;
    }

    if (
      isGroupableToolCall(toolCall) &&
      lastGroup &&
      lastGroup.type === "work" &&
      resolveToolGroupKey(lastGroup.items[0]!) === resolveToolGroupKey(toolCall)
    ) {
      lastGroup.items.push(toolCall);
      continue;
    }

    if (isGroupableToolCall(toolCall)) {
      groups.push({
        type: "work",
        id: `work-group:${toolCall.id}`,
        items: [toolCall],
      });
      continue;
    }

    groups.push({
      type: "single",
      id: toolCall.id,
      item: toolCall,
    });
  }

  return groups;
}

export function buildToolSearchGroupQueryPreview(params: {
  toolCalls: ToolCallState[];
  extractSearchQueryLabel: (toolCall: ToolCallState) => string;
  formatHiddenCount: (count: number) => string;
}): string {
  const queryPreview = params.toolCalls
    .slice(0, 2)
    .map(params.extractSearchQueryLabel)
    .join(" · ");
  const hiddenCount = Math.max(params.toolCalls.length - 2, 0);
  return hiddenCount > 0
    ? `${queryPreview}${params.formatHiddenCount(hiddenCount)}`
    : queryPreview;
}

export function buildToolGroupHeadline(toolCalls: ToolCallState[]): string {
  return buildToolGroupHeadlineFromInfo(toolCalls);
}

export function isToolSearchToolName(toolName: string): boolean {
  return normalizeToolNameKeyFromInfo(toolName) === "toolsearch";
}

function parseMimeTypeFromDataUrl(rawUrl: string): string | undefined {
  const normalized = rawUrl.trim();
  if (!normalized.startsWith("data:image/")) return undefined;
  const commaIndex = normalized.indexOf(",");
  if (commaIndex <= 5) return undefined;
  const meta = normalized.slice(5, commaIndex);
  const mimeType = meta.split(";")[0]?.trim();
  return mimeType?.startsWith("image/") ? mimeType : undefined;
}

function extractDataImageUrlsFromText(text?: string): string[] {
  if (!text?.trim()) return [];
  return Array.from(
    new Set(text.match(/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g) || []),
  );
}

export function normalizeToolResultImages(
  rawImages: unknown,
  fallbackText?: string,
  metadata?: unknown,
): ToolResultImage[] {
  const normalized: ToolResultImage[] = [];
  const seen = new Set<string>();

  const appendImage = (
    rawSrc: string,
    mimeType?: string,
    origin?: ToolResultImage["origin"],
  ) => {
    const src = rawSrc.trim();
    if (!src || seen.has(src)) return;
    seen.add(src);
    normalized.push({ src, mimeType, origin });
  };

  const imageItems = Array.isArray(rawImages) ? rawImages : [];
  for (const item of imageItems) {
    if (typeof item === "string") {
      appendImage(item, parseMimeTypeFromDataUrl(item), "data_url");
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const src = typeof record.src === "string" ? record.src.trim() : "";
    if (!src) continue;
    const mimeType =
      (typeof record.mimeType === "string" && record.mimeType) ||
      (typeof record.mime_type === "string" && record.mime_type) ||
      undefined;
    const origin =
      record.origin === "data_url" ||
      record.origin === "tool_payload" ||
      record.origin === "file_path"
        ? record.origin
        : undefined;
    appendImage(src, mimeType, origin);
  }

  if (normalized.length === 0 && metadata && typeof metadata === "object") {
    const record = metadata as Record<string, unknown>;
    const modelVisibleImage =
      record.model_visible_image === true || record.modelVisibleImage === true;
    const rawImageUrl = record.image_url ?? record.imageUrl;
    const imageUrl = typeof rawImageUrl === "string" ? rawImageUrl.trim() : "";
    if (modelVisibleImage && imageUrl.startsWith("data:image/")) {
      const mimeType =
        (typeof record.mime_type === "string" && record.mime_type.trim()) ||
        (typeof record.mimeType === "string" && record.mimeType.trim()) ||
        parseMimeTypeFromDataUrl(imageUrl);
      appendImage(imageUrl, mimeType, "tool_payload");
    }
  }

  if (normalized.length === 0) {
    for (const dataUrl of extractDataImageUrlsFromText(fallbackText)) {
      appendImage(dataUrl, parseMimeTypeFromDataUrl(dataUrl), "data_url");
    }
  }

  return normalized;
}

export function normalizeToolResultMetadata(
  rawMetadata: unknown,
): Record<string, unknown> | undefined {
  if (
    !rawMetadata ||
    typeof rawMetadata !== "object" ||
    Array.isArray(rawMetadata)
  ) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(rawMetadata));
}

export function readRecordString(
  record: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

export function readRecordNumber(
  record: Record<string, unknown> | undefined,
  keys: string[],
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function readRecordBoolean(
  record: Record<string, unknown> | undefined,
  keys: string[],
): boolean | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

export function resolveCommandToolSummary(params: {
  toolName: string;
  args: Record<string, ToolCallArgumentValue>;
  metadata?: Record<string, unknown>;
}): CommandToolSummary | null {
  const { toolName, args, metadata } = params;
  const normalizedName = normalizeToolNameKeyFromInfo(toolName);
  const command = readRecordString(args, [
    "command",
    "cmd",
    "script",
    "input",
    "code",
  ]);
  const cwd =
    readRecordString(metadata, [
      "cwd",
      "working_directory",
      "workingDirectory",
    ]) ||
    readRecordString(args, ["cwd", "working_directory", "workingDirectory"]);
  const exitCode = readRecordNumber(metadata, ["exit_code", "exitCode"]);
  const stdoutLength = readRecordNumber(metadata, [
    "stdout_length",
    "stdoutLength",
    "stdout_bytes",
    "stdoutBytes",
  ]);
  const stderrLength = readRecordNumber(metadata, [
    "stderr_length",
    "stderrLength",
    "stderr_bytes",
    "stderrBytes",
  ]);
  const sandboxed = readRecordBoolean(metadata, ["sandboxed"]);
  const sandboxType = readRecordString(metadata, [
    "sandbox_type",
    "sandboxType",
  ]);
  const outputTruncated = readRecordBoolean(metadata, [
    "output_truncated",
    "outputTruncated",
  ]);
  const shell = readRecordString(metadata, ["shell"]);
  const executionSurface = readRecordString(metadata, [
    "execution_surface",
    "executionSurface",
  ]);
  const encoding = readRecordString(metadata, [
    "encoding",
    "stdout_encoding",
    "stdoutEncoding",
  ]);
  const stderrEncoding = readRecordString(metadata, [
    "stderr_encoding",
    "stderrEncoding",
  ]);
  const decodedWith = readRecordString(metadata, [
    "decoded_with",
    "decodedWith",
  ]);
  const hasCommandFact =
    command !== null ||
    cwd !== null ||
    exitCode !== null ||
    stdoutLength !== null ||
    stderrLength !== null ||
    sandboxed !== null ||
    sandboxType !== null ||
    outputTruncated !== null ||
    shell !== null ||
    executionSurface !== null ||
    encoding !== null ||
    stderrEncoding !== null ||
    decodedWith !== null;

  if (!hasCommandFact) {
    return null;
  }

  const isCommandLike =
    normalizedName.includes("bash") ||
    normalizedName.includes("shell") ||
    normalizedName.includes("exec") ||
    normalizedName.includes("powershell") ||
    normalizedName.includes("terminal") ||
    normalizedName.includes("command") ||
    exitCode !== null;

  if (!isCommandLike) {
    return null;
  }

  return {
    command,
    cwd,
    exitCode,
    stdoutLength,
    stderrLength,
    sandboxed,
    sandboxType,
    outputTruncated,
    shell,
    executionSurface,
    encoding,
    stderrEncoding,
    decodedWith,
  };
}

export function parseJsonRecord(
  value: string | null | undefined,
): Record<string, unknown> | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 结果不是 JSON 时继续走聚合输出渲染。
  }

  return undefined;
}

export function formatCommandEncoding(
  summary: CommandToolSummary,
): string | null {
  if (!summary.encoding && !summary.stderrEncoding) {
    return null;
  }
  if (!summary.stderrEncoding || summary.stderrEncoding === summary.encoding) {
    return summary.encoding || summary.stderrEncoding;
  }
  return `${summary.encoding || "-"} / ${summary.stderrEncoding}`;
}

export function resolveCommandOutputStreams(params: {
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}): CommandOutputStream[] {
  const outputRecord = parseJsonRecord(params.output);
  const errorRecord = parseJsonRecord(params.error);
  const stdoutKeys = [
    "stdout",
    "stdout_text",
    "stdoutText",
    "standard_output",
    "standardOutput",
  ];
  const stderrKeys = [
    "stderr",
    "stderr_text",
    "stderrText",
    "standard_error",
    "standardError",
  ];

  const stdout =
    readRecordString(params.metadata, stdoutKeys) ||
    readRecordString(outputRecord, stdoutKeys) ||
    readRecordString(errorRecord, stdoutKeys);
  const stderr =
    readRecordString(params.metadata, stderrKeys) ||
    readRecordString(outputRecord, stderrKeys) ||
    readRecordString(errorRecord, stderrKeys);

  const streams: CommandOutputStream[] = [];
  if (stdout) {
    const content = stripTerminalControlSequences(stdout);
    if (content.trim())
      streams.push({ key: "stdout", content, tone: "neutral" });
  }
  if (stderr) {
    const content = stripTerminalControlSequences(stderr);
    if (content.trim()) streams.push({ key: "stderr", content, tone: "error" });
  }

  return streams;
}

export function resolveSkillInvocationContentInfo(params: {
  toolCall: ToolCallState;
  args: Record<string, ToolCallArgumentValue>;
  metadata?: Record<string, unknown>;
}): SkillInvocationContentInfo {
  const { toolCall, args, metadata } = params;
  const normalizedToolName = normalizeToolNameKeyFromInfo(toolCall.name);
  const normalizedSource =
    readRecordString(metadata, ["skill_source", "skillSource"]) ||
    (typeof args.source === "string" ? args.source : null);
  const isSkillInvocation =
    normalizedToolName === "skill" ||
    normalizedToolName === "loadskill" ||
    metadata?.tool_family === "skill" ||
    normalizedSource === "SKILL.md";

  const skillName =
    readRecordString(metadata, ["skill_name", "skillName"]) ||
    (typeof args.skill === "string" ? args.skill : null) ||
    (typeof args.name === "string" ? args.name : null);
  const displayName =
    readRecordString(metadata, ["skill_display_name", "skillDisplayName"]) ||
    (typeof args.display_name === "string" ? args.display_name : null) ||
    (typeof args.displayName === "string" ? args.displayName : null) ||
    skillName;
  const snapshotContent = readRecordString(metadata, [
    "skill_markdown_content",
    "skillMarkdownContent",
    "markdown_content",
    "markdownContent",
  ]);
  const markdownContentBytes = readRecordNumber(metadata, [
    "markdown_content_bytes",
    "markdownContentBytes",
  ]);
  const isSnapshotStandard = readRecordBoolean(metadata, [
    "agent_skills_standard",
    "agentSkillsStandard",
  ]);

  return {
    isSkillInvocation,
    skillName,
    displayName,
    snapshotContent,
    markdownContentBytes,
    isSnapshotStandard,
  };
}
