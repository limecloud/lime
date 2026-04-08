export type ChannelPreviewWorkbenchCommandTrigger =
  | "@渠道预览"
  | "@预览"
  | "@preview";

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
  /^\s*(@渠道预览|@预览|@preview)(?:\s+|$)([\s\S]*)$/i;
function normalizeTrigger(
  value: string,
): ChannelPreviewWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@preview") {
    return "@preview";
  }
  if (normalized === "@预览") {
    return "@预览";
  }
  return "@渠道预览";
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
  const { platformType, platformLabel, explicitPlatformText, leadingPlatformText } =
    parseContentPostPlatform(body);
  const prompt = stripContentPostPromptDecorations(
    body,
    explicitPlatformText || leadingPlatformText,
  );

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
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
