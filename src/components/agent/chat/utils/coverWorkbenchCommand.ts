export type CoverWorkbenchCommandTrigger = "@封面" | "@cover";

export interface ParsedCoverWorkbenchCommand {
  rawText: string;
  trigger: CoverWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  title?: string;
  platform?: string;
  size?: string;
  style?: string;
}

const COVER_COMMAND_PREFIX_REGEX = /^\s*(@封面|@cover)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_TITLE_REGEX =
  /(?:标题|title)\s*[:：=]?\s*([^\n,，；;]+?)(?=\s+(?:(?:风格|style|平台|platform)\s*[:：=]|\d{3,4}x\d{3,4}|1:1|16:9|9:16|4:3|3:4|4:5|5:4|3:2|2:3|21:9|生成|制作|设计|做|create|generate|design)|$|[，,；;])/i;
const EXPLICIT_PLATFORM_REGEX =
  /(?:平台|platform)\s*[:：=]?\s*(微信公众号|公众号|微信视频号|视频号|小红书|抖音|微博|知乎|快手|B站|b站|bilibili|Instagram|YouTube|TikTok|Twitter|X)(?=$|[\s,，。；;:：])/i;
const LEADING_PLATFORM_REGEX =
  /^(微信公众号|公众号|微信视频号|视频号|小红书|抖音|微博|知乎|快手|B站|b站|bilibili|Instagram|YouTube|TikTok|Twitter|X)(?=$|[\s,，。；;:：])/i;
const SIZE_REGEX =
  /\b(\d{3,4}x\d{3,4}|1:1|16:9|9:16|4:3|3:4|4:5|5:4|3:2|2:3|21:9)\b/i;
const EXPLICIT_STYLE_REGEX =
  /(?:风格|style)\s*[:：=]?\s*([^\n,，；;]+?)(?=\s+(?:\d{3,4}x\d{3,4}|1:1|16:9|9:16|4:3|3:4|4:5|5:4|3:2|2:3|21:9|生成|制作|设计|做|create|generate|design)\b|$|[，,；;])/i;

function normalizeTrigger(value: string): CoverWorkbenchCommandTrigger {
  return value.trim().toLowerCase() === "@cover" ? "@cover" : "@封面";
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

function stripPromptDecorations(
  body: string,
  platform?: string,
  size?: string,
): string {
  return body
    .replace(/^(生成|制作|设计|做|create|generate|design)(?:\s|$|[:：])*/i, "")
    .replace(EXPLICIT_TITLE_REGEX, "")
    .replace(EXPLICIT_PLATFORM_REGEX, "")
    .replace(
      platform
        ? new RegExp(
            `^${platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
            "i",
          )
        : /^$/,
      "",
    )
    .replace(EXPLICIT_STYLE_REGEX, "")
    .replace(
      size
        ? new RegExp(size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
        : /^$/,
      "",
    )
    .replace(
      /^[,\s，。；;:：]*(生成|制作|设计|做|create|generate|design)(?:\s|$|[:：])*/i,
      "",
    )
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCoverWorkbenchCommand(
  text: string,
): ParsedCoverWorkbenchCommand | null {
  const matched = text.match(COVER_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const title = body.match(EXPLICIT_TITLE_REGEX)?.[1]?.trim();
  const explicitPlatform = body.match(EXPLICIT_PLATFORM_REGEX)?.[1]?.trim();
  const leadingPlatform = body.match(LEADING_PLATFORM_REGEX)?.[1]?.trim();
  const platform = normalizePlatform(explicitPlatform || leadingPlatform);
  const size = body.match(SIZE_REGEX)?.[1]?.trim();
  const style = body.match(EXPLICIT_STYLE_REGEX)?.[1]?.trim();
  const prompt = stripPromptDecorations(body, platform, size);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    title,
    platform,
    size,
    style,
  };
}
