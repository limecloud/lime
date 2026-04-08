export const CONTENT_POST_SKILL_KEY = "content_post_with_cover";
export const CONTENT_POST_OUTPUT_DIR = "content-posts";

const CONTENT_POST_PRIMARY_ARTIFACT_PATH_PATTERN =
  /^content-posts\/.+\.(md|markdown|txt)$/i;

export type ContentPostPublishIntent = "preview" | "upload" | "publish";

export interface ContentPostArtifactPresentation {
  intent: ContentPostPublishIntent;
  label: string;
  platformLabel?: string;
  entrySource?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readTrimmedString(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isContentPostPrimaryArtifactPath(filePath: string): boolean {
  return CONTENT_POST_PRIMARY_ARTIFACT_PATH_PATTERN.test(filePath.trim());
}

export function resolveContentPostIntentLabel(
  intent: ContentPostPublishIntent,
): string {
  switch (intent) {
    case "preview":
      return "渠道预览稿";
    case "upload":
      return "上传稿";
    case "publish":
    default:
      return "发布稿";
  }
}

export function resolveContentPostIntent(
  input: unknown,
  entrySource?: string | null,
): ContentPostPublishIntent | null {
  const normalizedIntent =
    typeof input === "string" ? input.trim().toLowerCase() : "";
  if (normalizedIntent === "preview" || normalizedIntent === "upload") {
    return normalizedIntent;
  }

  if (
    entrySource === "at_publish_command" ||
    entrySource === "at_channel_preview_command" ||
    entrySource === "at_upload_command"
  ) {
    if (entrySource === "at_channel_preview_command") {
      return "preview";
    }
    if (entrySource === "at_upload_command") {
      return "upload";
    }
    return "publish";
  }

  return null;
}

export function resolveContentPostPresentationFromRequestMetadata(
  requestMetadata?: Record<string, unknown>,
): ContentPostArtifactPresentation | null {
  const harness = asRecord(requestMetadata?.harness);
  const publishCommand = asRecord(harness?.publish_command);
  if (!publishCommand) {
    return null;
  }

  const entrySource = readTrimmedString(publishCommand, "entry_source");
  const intent = resolveContentPostIntent(
    readTrimmedString(publishCommand, "intent"),
    entrySource,
  );
  if (!intent) {
    return null;
  }

  return {
    intent,
    label: resolveContentPostIntentLabel(intent),
    platformLabel:
      readTrimmedString(publishCommand, "platform_label") || undefined,
    entrySource: entrySource || undefined,
  };
}

export function mergeContentPostArtifactMetadata(params: {
  filePath: string;
  metadata?: Record<string, unknown>;
  requestMetadata?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const { filePath, metadata, requestMetadata } = params;
  const existing = metadata ? { ...metadata } : undefined;

  if (!isContentPostPrimaryArtifactPath(filePath)) {
    return existing;
  }

  const presentation =
    resolveContentPostPresentationFromRequestMetadata(requestMetadata);
  if (!presentation) {
    return existing;
  }

  return {
    ...(existing || {}),
    contentPostIntent: presentation.intent,
    contentPostLabel: presentation.label,
    contentPostPlatformLabel: presentation.platformLabel,
    contentPostEntrySource: presentation.entrySource,
  };
}

export function resolveContentPostArtifactDisplayTitle(params: {
  title: string;
  filePath: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const { title, filePath, metadata } = params;
  if (!isContentPostPrimaryArtifactPath(filePath)) {
    return title;
  }

  const label = readTrimmedString(metadata, "contentPostLabel");
  if (label) {
    return label;
  }

  const intent = resolveContentPostIntent(
    readTrimmedString(metadata, "contentPostIntent"),
    readTrimmedString(metadata, "contentPostEntrySource"),
  );
  return intent ? resolveContentPostIntentLabel(intent) : title;
}
