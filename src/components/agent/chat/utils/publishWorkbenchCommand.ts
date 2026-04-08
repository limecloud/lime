import {
  parseContentPostPlatform,
  stripContentPostPromptDecorations,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type PublishWorkbenchCommandTrigger =
  | "@发布"
  | "@publish"
  | "@发文"
  | "@投稿";

export type PublishPlatformType = ContentPostPlatformType;

export interface ParsedPublishWorkbenchCommand {
  rawText: string;
  trigger: PublishWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  platformType?: PublishPlatformType;
  platformLabel?: string;
}

const PUBLISH_COMMAND_PREFIX_REGEX =
  /^\s*(@发布|@publish|@发文|@投稿)(?:\s+|$)([\s\S]*)$/i;
function normalizeTrigger(value: string): PublishWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@publish") {
    return "@publish";
  }
  if (normalized === "@发文") {
    return "@发文";
  }
  if (normalized === "@投稿") {
    return "@投稿";
  }
  return "@发布";
}

export function parsePublishWorkbenchCommand(
  text: string,
): ParsedPublishWorkbenchCommand | null {
  const matched = text.match(PUBLISH_COMMAND_PREFIX_REGEX);
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
    platformType,
    platformLabel,
  };
}
