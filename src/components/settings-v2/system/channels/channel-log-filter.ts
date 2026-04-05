import type { LogEntry } from "@/lib/api/logs";

export type ChannelLogPreset =
  | "all"
  | "telegram"
  | "wechat"
  | "rpc"
  | "feishu"
  | "custom";

const PRESET_PATTERNS: Record<
  Exclude<ChannelLogPreset, "all" | "custom">,
  string
> = {
  telegram: "TelegramGateway",
  wechat: "WechatGateway",
  rpc: "\\bRPC\\b|agent\\.run|cron\\.run",
  feishu: "FeishuGateway",
};

interface BuildRegexResult {
  regex: RegExp | null;
  error: string | null;
}

export function buildChannelLogRegex(
  preset: ChannelLogPreset,
  customPattern: string,
): BuildRegexResult {
  if (preset === "all") {
    return { regex: null, error: null };
  }

  const pattern =
    preset === "custom" ? customPattern.trim() : PRESET_PATTERNS[preset];
  if (!pattern) {
    return { regex: null, error: null };
  }

  try {
    return { regex: new RegExp(pattern), error: null };
  } catch {
    return { regex: null, error: "正则表达式无效，已回退为不过滤" };
  }
}

export function filterChannelLogs(
  entries: LogEntry[],
  regex: RegExp | null,
): LogEntry[] {
  if (!regex) {
    return entries;
  }
  return entries.filter((entry) => regex.test(entry.message));
}
