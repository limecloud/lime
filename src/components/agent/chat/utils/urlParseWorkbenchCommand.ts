export type UrlParseWorkbenchCommandTrigger =
  | "@链接解析"
  | "@链接"
  | "@url_parse"
  | "@url";

export type UrlParseExtractGoal =
  | "summary"
  | "key_points"
  | "full_text"
  | "quotes";

export interface ParsedUrlParseWorkbenchCommand {
  rawText: string;
  trigger: UrlParseWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  url?: string;
  extractGoal?: UrlParseExtractGoal;
}

const URL_PARSE_COMMAND_PREFIX_REGEX =
  /^\s*(@链接解析|@链接|@url_parse|@url)(?:\s+|$)([\s\S]*)$/i;
const URL_REGEX = /https?:\/\/[^\s"'，。；;]+/i;
const SUMMARY_GOAL_REGEX =
  /(?:摘要|总结|概括|summary|summarize)(?=[\s,，。；;:：]|$)/i;
const KEY_POINTS_GOAL_REGEX =
  /(?:要点|重点|关键点|提炼重点|key(?:[_\s-]?points?))(?:\s|$|[，,。；;:：])/i;
const FULL_TEXT_GOAL_REGEX =
  /(?:全文|正文|原文|full(?:[_\s-]?text)?|clean(?:ed)?\s+text)(?:\s|$|[，,。；;:：])/i;
const QUOTES_GOAL_REGEX =
  /(?:引用|引文|金句|quote|quotes)(?:\s|$|[，,。；;:：])/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(解析|读取|提取|抓取|总结|extract|parse|read|fetch)(?:\s|$|[:：])*/i;
const LEADING_SUMMARY_GOAL_REGEX =
  /^(?:输出|生成|整理成|整理为)?\s*(?:摘要|总结|概括|summary|summarize)(?:\s|$|[，,。；;:：])*/i;
const LEADING_KEY_POINTS_GOAL_REGEX =
  /^(?:提取|输出|生成|整理成|整理为)?\s*(?:要点|重点|关键点|提炼重点|key(?:[_\s-]?points?))(?:\s|$|[，,。；;:：])*/i;
const LEADING_FULL_TEXT_GOAL_REGEX =
  /^(?:提取|输出|生成|整理成|整理为)?\s*(?:全文|正文|原文|full(?:[_\s-]?text)?|clean(?:ed)?\s+text)(?:\s|$|[，,。；;:：])*/i;
const LEADING_QUOTES_GOAL_REGEX =
  /^(?:提取|输出|生成|整理成|整理为)?\s*(?:引用|引文|金句|quote|quotes)(?:\s|$|[，,。；;:：])*/i;

function normalizeTrigger(value: string): UrlParseWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@链接") {
    return "@链接";
  }
  if (normalized === "@url_parse") {
    return "@url_parse";
  }
  if (normalized === "@url") {
    return "@url";
  }
  return "@链接解析";
}

function resolveExtractGoal(body: string): UrlParseExtractGoal | undefined {
  if (KEY_POINTS_GOAL_REGEX.test(body)) {
    return "key_points";
  }
  if (FULL_TEXT_GOAL_REGEX.test(body)) {
    return "full_text";
  }
  if (QUOTES_GOAL_REGEX.test(body)) {
    return "quotes";
  }
  if (SUMMARY_GOAL_REGEX.test(body)) {
    return "summary";
  }
  return undefined;
}

function stripPromptDecorations(body: string, url?: string): string {
  return body
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(
      url ? new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : /^$/,
      "",
    )
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(/^[,\s，。；;:：]+/, "")
    .replace(LEADING_KEY_POINTS_GOAL_REGEX, "")
    .replace(LEADING_FULL_TEXT_GOAL_REGEX, "")
    .replace(LEADING_QUOTES_GOAL_REGEX, "")
    .replace(LEADING_SUMMARY_GOAL_REGEX, "")
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseUrlParseWorkbenchCommand(
  text: string,
): ParsedUrlParseWorkbenchCommand | null {
  const matched = text.match(URL_PARSE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const url = body.match(URL_REGEX)?.[0]?.trim();

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: stripPromptDecorations(body, url),
    url,
    extractGoal: resolveExtractGoal(body),
  };
}
