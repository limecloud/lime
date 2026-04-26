export type ChannelPreviewWorkbenchCommandTrigger =
  | "@渠道预览"
  | "@预览"
  | "@preview"
  | "@Instagram Preview"
  | "@TikTok Preview"
  | "@Twitter Preview"
  | "@YouTube Preview";

import {
  parseContentPostPlatform,
  stripContentPostPromptDecorations,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type ChannelPreviewPlatformType = ContentPostPlatformType;

export interface ParsedChannelPreviewWorkbenchCommand {
  rawText: string;
  trigger: ChannelPreviewWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  dispatchBody: string;
  platformType?: ChannelPreviewPlatformType;
  platformLabel?: string;
}

const CHANNEL_PREVIEW_COMMAND_PREFIX_REGEX =
  /^\s*(@渠道预览|@预览|@preview|@Instagram Preview|@TikTok Preview|@Twitter Preview|@YouTube Preview)(?:\s+|$)([\s\S]*)$/i;
function normalizeTrigger(
  value: string,
): ChannelPreviewWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@instagram preview") {
    return "@Instagram Preview";
  }
  if (normalized === "@tiktok preview") {
    return "@TikTok Preview";
  }
  if (normalized === "@twitter preview") {
    return "@Twitter Preview";
  }
  if (normalized === "@youtube preview") {
    return "@YouTube Preview";
  }
  if (normalized === "@preview") {
    return "@preview";
  }
  if (normalized === "@预览") {
    return "@预览";
  }
  return "@渠道预览";
}

function resolveDefaultPlatformFromTrigger(
  trigger: ChannelPreviewWorkbenchCommandTrigger,
): {
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
} {
  switch (trigger) {
    case "@Instagram Preview":
      return {
        platformType: "instagram",
        platformLabel: "Instagram",
      };
    case "@TikTok Preview":
      return {
        platformType: "tiktok",
        platformLabel: "TikTok",
      };
    case "@Twitter Preview":
      return {
        platformType: "x",
        platformLabel: "X / Twitter",
      };
    case "@YouTube Preview":
      return {
        platformType: "youtube",
        platformLabel: "YouTube",
      };
    default:
      return {};
  }
}

function buildDispatchBody(input: {
  prompt: string;
  platformLabel?: string;
}): string {
  const previewInstruction = input.platformLabel
    ? `请基于当前内容生成一份适用于${input.platformLabel}的渠道预览稿，突出标题、首屏摘要、排版层级和封面建议`
    : "请基于当前内容生成一份渠道预览稿，突出标题、首屏摘要、排版层级和封面建议";

  return [
    input.platformLabel ? `平台:${input.platformLabel}` : undefined,
    previewInstruction,
    input.prompt.trim() || undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function parseChannelPreviewWorkbenchCommand(
  text: string,
): ParsedChannelPreviewWorkbenchCommand | null {
  const matched = text.match(CHANNEL_PREVIEW_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const trigger = normalizeTrigger(matched[1] || "");
  const {
    platformType: parsedPlatformType,
    platformLabel: parsedPlatformLabel,
    explicitPlatformText,
    leadingPlatformText,
  } = parseContentPostPlatform(body);
  const defaultPlatform = resolveDefaultPlatformFromTrigger(trigger);
  const prompt = stripContentPostPromptDecorations(
    body,
    explicitPlatformText || leadingPlatformText,
  );
  const platformType = parsedPlatformType ?? defaultPlatform.platformType;
  const platformLabel = parsedPlatformLabel ?? defaultPlatform.platformLabel;

  return {
    rawText: text,
    trigger,
    body,
    prompt: prompt || body,
    dispatchBody: buildDispatchBody({
      prompt: prompt || body,
      platformLabel,
    }),
    platformType,
    platformLabel,
  };
}
