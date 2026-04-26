import {
  parseContentPostPlatform,
  stripContentPostPromptDecorations,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type PublishWorkbenchCommandTrigger =
  | "@发布"
  | "@publish"
  | "@发文"
  | "@投稿"
  | "@TikTok Publish"
  | "@Twitter Publish"
  | "@YouTube Publish";

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
  /^\s*(@发布|@publish|@发文|@投稿|@TikTok Publish|@Twitter Publish|@YouTube Publish)(?:\s+|$)([\s\S]*)$/i;
function normalizeTrigger(value: string): PublishWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@tiktok publish") {
    return "@TikTok Publish";
  }
  if (normalized === "@twitter publish") {
    return "@Twitter Publish";
  }
  if (normalized === "@youtube publish") {
    return "@YouTube Publish";
  }
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

function resolveDefaultPlatformFromTrigger(
  trigger: PublishWorkbenchCommandTrigger,
): {
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
} {
  switch (trigger) {
    case "@TikTok Publish":
      return {
        platformType: "tiktok",
        platformLabel: "TikTok",
      };
    case "@Twitter Publish":
      return {
        platformType: "x",
        platformLabel: "X / Twitter",
      };
    case "@YouTube Publish":
      return {
        platformType: "youtube",
        platformLabel: "YouTube",
      };
    default:
      return {};
  }
}

export function parsePublishWorkbenchCommand(
  text: string,
): ParsedPublishWorkbenchCommand | null {
  const matched = text.match(PUBLISH_COMMAND_PREFIX_REGEX);
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
    platformType,
    platformLabel,
  };
}
