import type { ContentPart, Message } from "../types";
import { stripAssistantProtocolResidue } from "./protocolResidue";
import { formatRuntimePeerMessageText } from "./runtimePeerMessageDisplay";

const BRACKET_IMAGE_PLACEHOLDER_RE = /\[\s*Image\s*#\d+\s*\]/gi;
const BARE_IMAGE_PLACEHOLDER_RE =
  /(^|[\s,，;；])Image\s*#\d+(?=$|[\s,，;；])/gi;
const ONLY_IMAGE_PLACEHOLDERS_RE =
  /^\s*(?:(?:\[\s*Image\s*#\d+\s*\]|Image\s*#\d+)\s*[,，;；]?\s*)+$/i;
const BRACKET_IMAGE_PLACEHOLDER_TEST_RE = /\[\s*Image\s*#\d+\s*\]/i;
const BARE_IMAGE_PLACEHOLDER_TEST_RE =
  /(^|[\s,，;；])Image\s*#\d+(?=$|[\s,，;；])/i;
const EXACT_IMAGE_TASK_LABEL_RE = /^\[?\s*Image\s*#(\d+)\s*\]?$/i;
const TOOL_NARRATION_TOOL_NAME_RE =
  /\b(?:ToolSearch|WebSearch|WebFetch|Read|Write|Edit|Glob|Grep|Bash|StructuredOutput|webReader)\b|(?:mcp__[\w-]+(?:__[\w-]+)?|lime_[\w-]+)/i;
const TOOL_NARRATION_ACTION_RE =
  /调用|使用|执行|检索|搜索|读取|抓取|访问|打开|分析|查找|扩搜|筛选|切换|转去|改为|尝试/i;
const TOOL_NARRATION_SELF_PROCESS_RE =
  /让我|我将|我会|接下来|现在|继续|直接|先|然后|随后|改为|转去|尝试|开始/i;
const TOOL_NARRATION_SCHEDULING_RE =
  /只返回了元数据|未命中|没有返回|改为|转去|切换到|直接调用/i;
const TOOL_NARRATION_NAVIGATION_TARGET_RE =
  /搜索页|结果页|网页|页面|链接|文件|目录|仓库|日志|结果/i;
const TOOL_NARRATION_NAVIGATION_RE =
  /已经打开|已打开|打开了|开始筛选|继续筛选|开始查看|继续查看|开始检索|继续检索|开始分析|继续分析|开始整理|继续整理/i;
const TOOL_NARRATION_RESULT_RE =
  /结果如下|结论|我发现|发现了|查到|查到了|显示|表明|说明|意味着|共有|共计|\d+\s*(?:个|条|项|篇|页|处)/i;
const TOOL_NARRATION_MAX_LENGTH = 120;
const ASSISTANT_PHASE_SUMMARY_HEADING_RE = /^\s{0,3}#{1,6}\s*阶段结论\s*$/;
const ASSISTANT_PHASE_SUMMARY_INLINE_RE = /^\s*阶段结论[:：]\s*/;

function collapseDisplayWhitespace(value: string): string {
  return value
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1")
    .replace(/([（【《“‘([<])\s+/g, "$1")
    .replace(/\s+([）】》”’)\]>])/g, "$1")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceImagePlaceholders(text: string, replacement: string): string {
  const withBracketPlaceholders = text.replace(
    BRACKET_IMAGE_PLACEHOLDER_RE,
    ` ${replacement} `,
  );
  return withBracketPlaceholders.replace(
    BARE_IMAGE_PLACEHOLDER_RE,
    (_match, prefix: string) => `${prefix}${replacement}`,
  );
}

function hasAdjacentToolUse(
  parts: ContentPart[],
  index: number,
): boolean {
  return (
    parts[index - 1]?.type === "tool_use" || parts[index + 1]?.type === "tool_use"
  );
}

function shouldStripAssistantToolNarration(text: string): boolean {
  const normalized = collapseDisplayWhitespace(text);
  if (!normalized || normalized.length > TOOL_NARRATION_MAX_LENGTH) {
    return false;
  }

  if (TOOL_NARRATION_RESULT_RE.test(normalized)) {
    return false;
  }

  const hasToolName = TOOL_NARRATION_TOOL_NAME_RE.test(normalized);
  const hasAction = TOOL_NARRATION_ACTION_RE.test(normalized);
  const hasSelfProcess = TOOL_NARRATION_SELF_PROCESS_RE.test(normalized);
  const hasSchedulingCue = TOOL_NARRATION_SCHEDULING_RE.test(normalized);

  if (hasToolName && hasAction && (hasSelfProcess || hasSchedulingCue)) {
    return true;
  }

  return (
    hasSelfProcess &&
    TOOL_NARRATION_NAVIGATION_RE.test(normalized) &&
    TOOL_NARRATION_NAVIGATION_TARGET_RE.test(normalized)
  );
}

function stripAssistantPhaseSummaryTitle(text: string): string {
  const strippedLines: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const trimmed = line.trim();

    if (ASSISTANT_PHASE_SUMMARY_HEADING_RE.test(trimmed) || trimmed === "阶段结论") {
      while (index + 1 < lines.length && !(lines[index + 1] || "").trim()) {
        index += 1;
      }
      continue;
    }

    if (ASSISTANT_PHASE_SUMMARY_INLINE_RE.test(trimmed)) {
      const stripped = line.replace(ASSISTANT_PHASE_SUMMARY_INLINE_RE, "");
      if (!stripped.trim()) {
        continue;
      }
      strippedLines.push(stripped);
      continue;
    }

    strippedLines.push(line);
  }

  return strippedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function containsInternalImagePlaceholder(text: string): boolean {
  return (
    BRACKET_IMAGE_PLACEHOLDER_TEST_RE.test(text) ||
    BARE_IMAGE_PLACEHOLDER_TEST_RE.test(text)
  );
}

export function isOnlyInternalImagePlaceholderText(text: string): boolean {
  return ONLY_IMAGE_PLACEHOLDERS_RE.test(text.trim());
}

export function resolveInternalImageTaskDisplayName(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(EXACT_IMAGE_TASK_LABEL_RE);
  if (!match) {
    return normalized;
  }

  const index = match[1]?.trim();
  return index ? `图片任务 ${index}` : "图片任务";
}

interface SanitizeMessageTextOptions {
  role: Message["role"];
  hasImages?: boolean;
}

export function sanitizeMessageTextForDisplay(
  text: string,
  options: SanitizeMessageTextOptions,
): string {
  const normalized =
    options.role === "assistant"
      ? stripAssistantPhaseSummaryTitle(stripAssistantProtocolResidue(text))
      : text.trim();
  const formattedRuntimePeerMessage = formatRuntimePeerMessageText(normalized);
  if (!formattedRuntimePeerMessage) {
    return "";
  }

  if (!containsInternalImagePlaceholder(formattedRuntimePeerMessage)) {
    return formattedRuntimePeerMessage;
  }

  if (
    isOnlyInternalImagePlaceholderText(formattedRuntimePeerMessage) &&
    ((options.role === "user" && options.hasImages) ||
      options.role === "assistant")
  ) {
    return "";
  }

  return collapseDisplayWhitespace(
    replaceImagePlaceholders(formattedRuntimePeerMessage, "图片"),
  );
}

export function sanitizeMessageTextForPreview(
  text: string,
  options: SanitizeMessageTextOptions,
): string {
  const sanitized = sanitizeMessageTextForDisplay(text, options);
  if (sanitized) {
    return sanitized;
  }

  if (options.role === "user" && options.hasImages) {
    return "已附加图片";
  }

  if (
    options.role === "assistant" &&
    isOnlyInternalImagePlaceholderText(text)
  ) {
    return "图片处理中";
  }

  return "";
}

export function sanitizeContentPartsForDisplay(
  parts: ContentPart[] | undefined,
  options: SanitizeMessageTextOptions,
): ContentPart[] | undefined {
  if (!parts || parts.length === 0) {
    return parts;
  }

  const sanitizedParts = parts.flatMap<ContentPart>((part, index) => {
    if (part.type !== "text") {
      return [part];
    }

    const sanitizedText = sanitizeMessageTextForDisplay(part.text, options);
    if (!sanitizedText) {
      return [];
    }

    if (
      options.role === "assistant" &&
      hasAdjacentToolUse(parts, index) &&
      shouldStripAssistantToolNarration(sanitizedText)
    ) {
      return [];
    }

    return [
      {
        ...part,
        text: sanitizedText,
      },
    ];
  });

  return sanitizedParts.length > 0 ? sanitizedParts : undefined;
}
