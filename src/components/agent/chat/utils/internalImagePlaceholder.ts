import type { ContentPart, Message } from "../types";

const BRACKET_IMAGE_PLACEHOLDER_RE = /\[\s*Image\s*#\d+\s*\]/gi;
const BARE_IMAGE_PLACEHOLDER_RE = /(^|[\s,，;；])Image\s*#\d+(?=$|[\s,，;；])/gi;
const ONLY_IMAGE_PLACEHOLDERS_RE =
  /^\s*(?:(?:\[\s*Image\s*#\d+\s*\]|Image\s*#\d+)\s*[,，;；]?\s*)+$/i;
const BRACKET_IMAGE_PLACEHOLDER_TEST_RE = /\[\s*Image\s*#\d+\s*\]/i;
const BARE_IMAGE_PLACEHOLDER_TEST_RE =
  /(^|[\s,，;；])Image\s*#\d+(?=$|[\s,，;；])/i;
const EXACT_IMAGE_TASK_LABEL_RE = /^\[?\s*Image\s*#(\d+)\s*\]?$/i;

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
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  if (!containsInternalImagePlaceholder(normalized)) {
    return normalized;
  }

  if (
    isOnlyInternalImagePlaceholderText(normalized) &&
    ((options.role === "user" && options.hasImages) ||
      options.role === "assistant")
  ) {
    return "";
  }

  return collapseDisplayWhitespace(replaceImagePlaceholders(normalized, "图片"));
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

  const sanitizedParts = parts.flatMap((part) => {
    if (part.type !== "text") {
      return [part];
    }

    const sanitizedText = sanitizeMessageTextForDisplay(part.text, options);
    if (!sanitizedText) {
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
