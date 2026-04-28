import { extractExplicitUrlFromText } from "./browserAssistIntent";
import type { BrowserTaskRequirement } from "../types";

interface BrowserPlatformHint {
  label: string;
  launchUrl: string;
  patterns: RegExp[];
}

export interface BrowserTaskRequirementMatch {
  requirement: BrowserTaskRequirement;
  reason: string;
  launchUrl: string;
  platformLabel?: string;
}

const PLATFORM_HINTS: BrowserPlatformHint[] = [
  {
    label: "微信公众号后台",
    launchUrl: "https://mp.weixin.qq.com/",
    patterns: [
      /微信公众平台|微信公众号|公众号后台|公众号|mp\.weixin\.qq\.com/i,
    ],
  },
  {
    label: "小红书创作服务平台",
    launchUrl: "https://creator.xiaohongshu.com/",
    patterns: [/小红书|xiaohongshu|creator\.xiaohongshu\.com/i],
  },
  {
    label: "知乎创作中心",
    launchUrl: "https://www.zhihu.com/creator",
    patterns: [/知乎|zhihu|zhihu\.com\/creator/i],
  },
  {
    label: "抖音创作者中心",
    launchUrl: "https://creator.douyin.com/",
    patterns: [/抖音|douyin|creator\.douyin\.com/i],
  },
  {
    label: "B 站创作中心",
    launchUrl: "https://member.bilibili.com/",
    patterns: [/b站|bilibili|member\.bilibili\.com/i],
  },
  {
    label: "Instagram",
    launchUrl: "https://www.instagram.com/",
    patterns: [/instagram|instagram\.com/i],
  },
  {
    label: "TikTok",
    launchUrl: "https://www.tiktok.com/upload",
    patterns: [/tiktok|tiktok\.com/i],
  },
  {
    label: "YouTube Studio",
    launchUrl: "https://studio.youtube.com/",
    patterns: [/youtube|studio\.youtube\.com|youtube\.com/i],
  },
  {
    label: "X / Twitter",
    launchUrl: "https://x.com/compose/post",
    patterns: [
      /twitter|x\s*\/\s*twitter|x\.com/i,
      /(?:^|[^a-z])x(?:$|[^a-z])/i,
    ],
  },
];

const REQUIRED_ACTION_PATTERN =
  /发布文章|发布内容|发文|发表|提交|上传|登录|登陆|扫码|验证码|授权|填写|点击|勾选|切换|保存|创建草稿|提交表单|群发/i;
const ADMIN_SURFACE_PATTERN =
  /后台|管理台|控制台|创作中心|创作者中心|管理后台|仪表盘|设置页|草稿箱|发布页|编辑器|表单/i;
const USER_STEP_PATTERN =
  /登录|登陆|扫码|验证码|短信验证|授权|人工接管|手动|确认登录|二次验证/i;

function normalizeInput(input: string): string {
  return input.trim();
}

function matchPlatform(input: string): BrowserPlatformHint | null {
  for (const platform of PLATFORM_HINTS) {
    if (platform.patterns.some((pattern) => pattern.test(input))) {
      return platform;
    }
  }
  return null;
}

export function detectBrowserTaskRequirement(
  input: string,
): BrowserTaskRequirementMatch | null {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return null;
  }

  const explicitUrl = extractExplicitUrlFromText(normalized);
  const platform = matchPlatform(normalized);
  const hasRequiredAction = REQUIRED_ACTION_PATTERN.test(normalized);
  const hasAdminSurface = ADMIN_SURFACE_PATTERN.test(normalized);
  const hasUserStep = USER_STEP_PATTERN.test(normalized);

  if (!platform && !hasRequiredAction && !hasAdminSurface) {
    return null;
  }

  if (!platform && !(hasRequiredAction && hasAdminSurface)) {
    return null;
  }

  const requirement: BrowserTaskRequirement =
    platform || hasUserStep ? "required_with_user_step" : "required";
  const reason =
    requirement === "required_with_user_step"
      ? platform
        ? `该任务需要在${platform.label}完成发布、登录或提交流程，必须先建立真实浏览器会话，并通常需要你先完成登录、扫码或验证码。`
        : "该任务涉及受保护网页操作，必须先建立真实浏览器会话，并通常需要你先完成登录、扫码或验证码。"
      : "该任务涉及真实网页交互与后台/表单操作，必须使用浏览器执行，不能直接退化成联网检索。";

  return {
    requirement,
    reason,
    launchUrl: explicitUrl || platform?.launchUrl || "https://www.google.com",
    platformLabel: platform?.label,
  };
}
