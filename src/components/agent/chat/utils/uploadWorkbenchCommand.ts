import {
  parseContentPostPlatform,
  stripContentPostPromptDecorations,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type UploadWorkbenchCommandTrigger =
  | "@上传"
  | "@upload"
  | "@上架";

export type UploadPlatformType = ContentPostPlatformType;

export interface ParsedUploadWorkbenchCommand {
  rawText: string;
  trigger: UploadWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  dispatchBody: string;
  platformType?: UploadPlatformType;
  platformLabel?: string;
}

const UPLOAD_COMMAND_PREFIX_REGEX =
  /^\s*(@上传|@upload|@上架)(?:\s+|$)([\s\S]*)$/i;

function normalizeTrigger(value: string): UploadWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@upload") {
    return "@upload";
  }
  if (normalized === "@上架") {
    return "@上架";
  }
  return "@上传";
}

function buildDispatchBody(input: {
  prompt: string;
  platformLabel?: string;
}): string {
  const uploadInstruction = input.platformLabel
    ? `请基于当前内容整理一份适用于${input.platformLabel}直接上传的上传稿与素材清单，优先输出标题、正文、封面说明、标签建议和上传前检查`
    : "请基于当前内容整理一份可直接上传的上传稿与素材清单，优先输出标题、正文、封面说明、标签建议和上传前检查";

  return [
    input.platformLabel ? `平台:${input.platformLabel}` : undefined,
    uploadInstruction,
    input.prompt.trim() || undefined,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function parseUploadWorkbenchCommand(
  text: string,
): ParsedUploadWorkbenchCommand | null {
  const matched = text.match(UPLOAD_COMMAND_PREFIX_REGEX);
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
