export type PosterWorkbenchCommandTrigger =
  | "@海报"
  | "@poster"
  | "@Flyer 3";

export interface ParsedPosterWorkbenchCommand {
  rawText: string;
  trigger: PosterWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  platform?: string;
  style?: string;
  size?: string;
  aspectRatio?: string;
}

const POSTER_COMMAND_PREFIX_REGEX =
  /^\s*(@海报|@poster|@Flyer 3)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_PLATFORM_REGEX =
  /(?:平台|platform)\s*[:：=]?\s*(微信公众号|公众号|视频号|小红书|抖音|微博|知乎|B站|b站|bilibili|Instagram|YouTube|TikTok)(?=$|[\s,，。；;:：])/i;
const LEADING_PLATFORM_REGEX =
  /^(微信公众号|公众号|视频号|小红书|抖音|微博|知乎|B站|b站|bilibili|Instagram|YouTube|TikTok)(?=$|[\s,，。；;:：])/i;
const EXPLICIT_STYLE_REGEX =
  /(?:风格|style)\s*[:：=]?\s*([^\n,，；;]+?)(?=\s+(?:\d{3,4}x\d{3,4}|1:1|16:9|9:16|4:3|3:4|4:5|5:4|3:2|2:3|21:9|生成|制作|设计|做|create|generate|design)\b|$|[，,；;])/i;
const SIZE_REGEX =
  /\b(\d{3,4}x\d{3,4}|1:1|16:9|9:16|4:3|3:4|4:5|5:4|3:2|2:3|21:9)\b/i;

function normalizeTrigger(value: string): PosterWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@poster") {
    return "@poster";
  }
  if (normalized === "@flyer 3") {
    return "@Flyer 3";
  }
  return "@海报";
}

function normalizePlatform(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const aliasMap: Record<string, string> = {
    微信公众号: "公众号",
    公众号: "公众号",
    视频号: "视频号",
    小红书: "小红书",
    抖音: "抖音",
    微博: "微博",
    知乎: "知乎",
    b站: "B站",
    bilibili: "B站",
    instagram: "Instagram",
    youtube: "YouTube",
    tiktok: "TikTok",
  };

  return aliasMap[normalized] || value?.trim();
}

function resolveSize(body: string): { size?: string; aspectRatio?: string } {
  const matched = body.match(SIZE_REGEX)?.[1]?.trim();
  if (!matched) {
    return {
      size: "864x1152",
      aspectRatio: "4:5",
    };
  }
  if (matched.includes("x")) {
    return { size: matched };
  }

  const mappedSizes: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "21:9": "1792x1024",
    "4:3": "1152x864",
    "3:2": "1344x768",
    "5:4": "1152x864",
    "9:16": "1024x1792",
    "3:4": "864x1152",
    "2:3": "768x1344",
    "4:5": "864x1152",
  };

  return {
    size: mappedSizes[matched],
    aspectRatio: matched,
  };
}

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function stripPromptDecorations(
  body: string,
  platform?: string,
  size?: string,
): string {
  return trimDecorations(
    body
      .replace(/^(生成|制作|设计|做|create|generate|design)(?:\s|$|[:：])*/i, "")
      .replace(EXPLICIT_PLATFORM_REGEX, " ")
      .replace(
        platform
          ? new RegExp(
              `^${platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
              "i",
            )
          : /^$/,
        "",
      )
      .replace(EXPLICIT_STYLE_REGEX, " ")
      .replace(
        size
          ? new RegExp(size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
          : /^$/,
        "",
      )
      .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
      .replace(/\s+/g, " "),
  );
}

function buildPosterPrompt(input: {
  prompt: string;
  platform?: string;
  style?: string;
}): string {
  const fragments = [
    input.platform ? `适用于${input.platform}` : undefined,
    input.style ? `${input.style}风格` : undefined,
    "海报设计",
    input.prompt,
  ].filter(Boolean);

  return fragments.join("，").trim();
}

function normalizeStyleAndPrompt(input: {
  style?: string;
  prompt: string;
}): { style?: string; prompt: string } {
  const normalizedStyle = input.style?.trim();
  const normalizedPrompt = input.prompt.trim();
  if (!normalizedStyle || normalizedPrompt) {
    return {
      style: normalizedStyle,
      prompt: normalizedPrompt,
    };
  }

  const separatorIndex = normalizedStyle.indexOf(" ");
  if (separatorIndex < 0) {
    return {
      style: normalizedStyle,
      prompt: normalizedPrompt,
    };
  }

  const style = normalizedStyle.slice(0, separatorIndex).trim();
  const prompt = normalizedStyle.slice(separatorIndex + 1).trim();
  return {
    style: style || normalizedStyle,
    prompt,
  };
}

export function parsePosterWorkbenchCommand(
  text: string,
): ParsedPosterWorkbenchCommand | null {
  const matched = text.match(POSTER_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const explicitPlatform = body.match(EXPLICIT_PLATFORM_REGEX)?.[1]?.trim();
  const leadingPlatform = body.match(LEADING_PLATFORM_REGEX)?.[1]?.trim();
  const platform = normalizePlatform(explicitPlatform || leadingPlatform);
  const styleMatch = body.match(EXPLICIT_STYLE_REGEX)?.[1]?.trim();
  const { size, aspectRatio } = resolveSize(body);
  const normalizedPrompt = normalizeStyleAndPrompt({
    style: styleMatch,
    prompt: stripPromptDecorations(body, platform, body.match(SIZE_REGEX)?.[1]),
  });
  const prompt = buildPosterPrompt({
    prompt: normalizedPrompt.prompt,
    platform,
    style: normalizedPrompt.style,
  });

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    platform,
    style: normalizedPrompt.style,
    size,
    aspectRatio,
  };
}
