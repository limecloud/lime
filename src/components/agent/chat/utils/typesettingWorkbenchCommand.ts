export type TypesettingWorkbenchCommandTrigger = "@排版" | "@typesetting";

export interface ParsedTypesettingWorkbenchCommand {
  rawText: string;
  trigger: TypesettingWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  targetPlatform?: string;
}

const TYPESETTING_COMMAND_PREFIX_REGEX =
  /^\s*(@排版|@typesetting)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_TARGET_PLATFORM_REGEX =
  /(?:平台|platform)\s*[:：=]?\s*(微信公众号|公众号|微信视频号|视频号|小红书|抖音|微博|知乎|快手|B站|b站|bilibili|Instagram|YouTube|TikTok|Twitter|X)(?=$|[\s,，。；;:：])/i;
const LEADING_TARGET_PLATFORM_REGEX =
  /^(微信公众号|公众号|微信视频号|视频号|小红书|抖音|微博|知乎|快手|B站|b站|bilibili|Instagram|YouTube|TikTok|Twitter|X)(?=$|[\s,，。；;:：])/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(排版|整理排版|优化排版|调整排版|typesetting|typeset|format(?:ting)?|整理成|整理为)(?:\s|$|[:：])*/i;

function normalizeTrigger(value: string): TypesettingWorkbenchCommandTrigger {
  return value.trim().toLowerCase() === "@typesetting"
    ? "@typesetting"
    : "@排版";
}

function normalizePlatform(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const aliasMap: Record<string, string> = {
    微信公众号: "公众号",
    公众号: "公众号",
    微信视频号: "视频号",
    视频号: "视频号",
    小红书: "小红书",
    抖音: "抖音",
    微博: "微博",
    知乎: "知乎",
    快手: "快手",
    b站: "B站",
    bilibili: "B站",
    instagram: "Instagram",
    youtube: "YouTube",
    tiktok: "TikTok",
    twitter: "X",
    x: "X",
  };

  return aliasMap[normalized] || value?.trim();
}

function stripPromptDecorations(body: string, targetPlatform?: string): string {
  return body
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(EXPLICIT_TARGET_PLATFORM_REGEX, "")
    .replace(
      targetPlatform
        ? new RegExp(
            `^${targetPlatform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
            "i",
          )
        : /^$/,
      "",
    )
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .trim();
}

export function parseTypesettingWorkbenchCommand(
  text: string,
): ParsedTypesettingWorkbenchCommand | null {
  const matched = text.match(TYPESETTING_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const explicitPlatform = body
    .match(EXPLICIT_TARGET_PLATFORM_REGEX)?.[1]
    ?.trim();
  const leadingPlatform = body
    .match(LEADING_TARGET_PLATFORM_REGEX)?.[1]
    ?.trim();
  const targetPlatform = normalizePlatform(explicitPlatform || leadingPlatform);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: stripPromptDecorations(body, targetPlatform),
    targetPlatform,
  };
}
