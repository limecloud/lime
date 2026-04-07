export type PublishWorkbenchCommandTrigger =
  | "@发布"
  | "@publish"
  | "@发文"
  | "@投稿";

export type PublishPlatformType =
  | "wechat_official_account"
  | "xiaohongshu"
  | "zhihu"
  | "douyin"
  | "bilibili";

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
const EXPLICIT_PLATFORM_REGEX =
  /(?:平台|渠道|platform|channel)\s*[:：=]?\s*(微信公众号后台|微信公众平台|公众号后台|公众号|小红书|知乎|抖音|B站|bilibili|wechat|wechat official account|xiaohongshu|zhihu|douyin)(?=$|[\s,，。；;:：])/i;
const LEADING_PLATFORM_REGEX =
  /^(微信公众号后台|微信公众平台|公众号后台|公众号|小红书|知乎|抖音|B站|bilibili|wechat|wechat official account|xiaohongshu|zhihu|douyin)(?=$|[\s,，。；;:：])/i;

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

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

function normalizePlatform(value?: string): {
  platformType?: PublishPlatformType;
  platformLabel?: string;
} {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return {};
  }

  if (
    normalized === "微信公众号后台" ||
    normalized === "微信公众平台" ||
    normalized === "公众号后台" ||
    normalized === "公众号" ||
    normalized === "wechat" ||
    normalized === "wechat official account"
  ) {
    return {
      platformType: "wechat_official_account",
      platformLabel: "微信公众号后台",
    };
  }
  if (normalized === "小红书" || normalized === "xiaohongshu") {
    return {
      platformType: "xiaohongshu",
      platformLabel: "小红书",
    };
  }
  if (normalized === "知乎" || normalized === "zhihu") {
    return {
      platformType: "zhihu",
      platformLabel: "知乎",
    };
  }
  if (normalized === "抖音" || normalized === "douyin") {
    return {
      platformType: "douyin",
      platformLabel: "抖音",
    };
  }
  if (normalized === "b站" || normalized === "bilibili") {
    return {
      platformType: "bilibili",
      platformLabel: "B站",
    };
  }
  return {};
}

function stripPromptDecorations(body: string, platformText?: string): string {
  const leadingPlatformRegex = platformText
    ? new RegExp(
        `^${platformText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimDecorations(
    body
      .replace(EXPLICIT_PLATFORM_REGEX, " ")
      .trimStart()
      .replace(leadingPlatformRegex, "")
      .replace(/\s+/g, " "),
  );
}

export function parsePublishWorkbenchCommand(
  text: string,
): ParsedPublishWorkbenchCommand | null {
  const matched = text.match(PUBLISH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const explicitPlatform = body.match(EXPLICIT_PLATFORM_REGEX)?.[1]?.trim();
  const leadingPlatform = body.match(LEADING_PLATFORM_REGEX)?.[1]?.trim();
  const { platformType, platformLabel } = normalizePlatform(
    explicitPlatform || leadingPlatform,
  );
  const prompt = stripPromptDecorations(
    body,
    explicitPlatform || leadingPlatform,
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
