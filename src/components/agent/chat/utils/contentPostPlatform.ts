export type ContentPostPlatformType =
  | "wechat_official_account"
  | "xiaohongshu"
  | "zhihu"
  | "douyin"
  | "bilibili"
  | "instagram"
  | "youtube"
  | "tiktok";

export interface ParsedContentPostPlatform {
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
  explicitPlatformText?: string;
  leadingPlatformText?: string;
}

export const CONTENT_POST_EXPLICIT_PLATFORM_REGEX =
  /(?:平台|渠道|platform|channel)\s*[:：=]?\s*(微信公众号后台|微信公众平台|公众号后台|公众号|小红书|知乎|抖音|B站|b站|bilibili|Instagram|YouTube|TikTok|wechat|wechat official account|xiaohongshu|zhihu|douyin)(?=$|[\s,，。；;:：])/i;
export const CONTENT_POST_LEADING_PLATFORM_REGEX =
  /^(微信公众号后台|微信公众平台|公众号后台|公众号|小红书|知乎|抖音|B站|b站|bilibili|Instagram|YouTube|TikTok|wechat|wechat official account|xiaohongshu|zhihu|douyin)(?=$|[\s,，。；;:：])/i;

export function trimCommandDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

export function normalizeContentPostPlatform(value?: string): {
  platformType?: ContentPostPlatformType;
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
  if (normalized === "instagram") {
    return {
      platformType: "instagram",
      platformLabel: "Instagram",
    };
  }
  if (normalized === "youtube") {
    return {
      platformType: "youtube",
      platformLabel: "YouTube",
    };
  }
  if (normalized === "tiktok") {
    return {
      platformType: "tiktok",
      platformLabel: "TikTok",
    };
  }
  return {};
}

export function parseContentPostPlatform(
  body: string,
): ParsedContentPostPlatform {
  const explicitPlatformText = body.match(
    CONTENT_POST_EXPLICIT_PLATFORM_REGEX,
  )?.[1]?.trim();
  const leadingPlatformText = body.match(
    CONTENT_POST_LEADING_PLATFORM_REGEX,
  )?.[1]?.trim();
  const { platformType, platformLabel } = normalizeContentPostPlatform(
    explicitPlatformText || leadingPlatformText,
  );

  return {
    platformType,
    platformLabel,
    explicitPlatformText,
    leadingPlatformText,
  };
}

export function stripContentPostPromptDecorations(
  body: string,
  platformText?: string,
): string {
  const leadingPlatformRegex = platformText
    ? new RegExp(
        `^${platformText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimCommandDecorations(
    body
      .replace(CONTENT_POST_EXPLICIT_PLATFORM_REGEX, " ")
      .trimStart()
      .replace(leadingPlatformRegex, "")
      .replace(/\s+/g, " "),
  );
}
