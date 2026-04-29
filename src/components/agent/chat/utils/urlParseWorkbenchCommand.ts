export type UrlParseWorkbenchCommandTrigger =
  | "@链接解析"
  | "@链接"
  | "@抓取"
  | "@Fetch"
  | "@网页读取"
  | "@URL Summarize"
  | "@Read Webpage"
  | "@Get Homepage"
  | "@web_scrape"
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
  /^\s*(@链接解析|@链接|@抓取|@Fetch|@网页读取|@URL Summarize|@Read Webpage|@Get Homepage|@web_scrape|@url_parse|@url)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(链接|网址|地址|url|link|source)|(提取|目标|模式|goal|extract(?:[_\s-]?goal)?|extract)|(要求|提示|说明|prompt|instruction))\s*[:：=]\s*/gi;
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

type UrlParseFieldKey = "url" | "extractGoal" | "prompt";

interface UrlParseFieldMatch {
  key: UrlParseFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedUrlParseFields {
  url?: string;
  extractGoal?: UrlParseExtractGoal;
  prompt?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): UrlParseWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@url summarize") {
    return "@URL Summarize";
  }
  if (normalized === "@read webpage") {
    return "@Read Webpage";
  }
  if (normalized === "@get homepage") {
    return "@Get Homepage";
  }
  if (normalized === "@链接") {
    return "@链接";
  }
  if (normalized === "@抓取") {
    return "@抓取";
  }
  if (normalized === "@fetch") {
    return "@Fetch";
  }
  if (normalized === "@网页读取") {
    return "@网页读取";
  }
  if (normalized === "@web_scrape") {
    return "@web_scrape";
  }
  if (normalized === "@url_parse") {
    return "@url_parse";
  }
  if (normalized === "@url") {
    return "@url";
  }
  return "@链接解析";
}

export function isUrlParseScrapeTrigger(
  trigger: UrlParseWorkbenchCommandTrigger,
): boolean {
  return (
    trigger === "@抓取" || trigger === "@Fetch" || trigger === "@web_scrape"
  );
}

export function isUrlParseReadTrigger(
  trigger: UrlParseWorkbenchCommandTrigger,
): boolean {
  return (
    trigger === "@网页读取" ||
    trigger === "@URL Summarize" ||
    trigger === "@Read Webpage" ||
    trigger === "@Get Homepage"
  );
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveFieldKey(matched: RegExpExecArray): UrlParseFieldKey | null {
  if (matched[1]) {
    return "url";
  }
  if (matched[2]) {
    return "extractGoal";
  }
  if (matched[3]) {
    return "prompt";
  }
  return null;
}

function collectFieldMatches(text: string): UrlParseFieldMatch[] {
  const baseMatches: Omit<UrlParseFieldMatch, "end">[] = [];
  FIELD_LABEL_REGEX.lastIndex = 0;
  let matched = FIELD_LABEL_REGEX.exec(text);
  while (matched) {
    const key = resolveFieldKey(matched);
    if (key) {
      baseMatches.push({
        key,
        start: matched.index,
        valueStart: FIELD_LABEL_REGEX.lastIndex,
      });
    }
    matched = FIELD_LABEL_REGEX.exec(text);
  }

  return baseMatches.map((match, index) => ({
    ...match,
    end:
      index + 1 < baseMatches.length
        ? baseMatches[index + 1]!.start
        : text.length,
  }));
}

function stripExplicitFields(
  text: string,
  matches: UrlParseFieldMatch[],
): string {
  if (matches.length === 0) {
    return text;
  }

  let cursor = 0;
  const segments: string[] = [];
  matches.forEach((match) => {
    if (cursor < match.start) {
      segments.push(text.slice(cursor, match.start));
    }
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return segments.join(" ");
}

function stripDetectedUrl(text: string, url?: string): string {
  if (!url) {
    return trimDecorations(text);
  }

  return trimDecorations(
    text.replace(new RegExp(escapeRegExp(url), "gi"), " "),
  );
}

function resolveDefaultExtractGoal(
  trigger: UrlParseWorkbenchCommandTrigger,
  extractGoal: UrlParseExtractGoal | undefined,
): UrlParseExtractGoal | undefined {
  if (isUrlParseScrapeTrigger(trigger)) {
    return extractGoal === "key_points" || extractGoal === "quotes"
      ? extractGoal
      : "full_text";
  }
  if (isUrlParseReadTrigger(trigger)) {
    return extractGoal || "summary";
  }
  return extractGoal;
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

function extractUrlParseFields(text: string): ExtractedUrlParseFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedUrlParseFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "url") {
      extracted.url = extracted.url || rawValue;
      return;
    }

    if (match.key === "extractGoal") {
      extracted.extractGoal =
        extracted.extractGoal || resolveExtractGoal(rawValue);
      return;
    }

    extracted.prompt = extracted.prompt || rawValue;
  });

  return {
    ...extracted,
    strippedText: trimDecorations(stripExplicitFields(text, matches)),
  };
}

function stripPromptDecorations(body: string): string {
  return body
    .replace(PROMPT_PREFIX_REGEX, "")
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
  const trigger = normalizeTrigger(matched[1] || "");
  const extracted = extractUrlParseFields(body);
  const url =
    extracted.url || extracted.strippedText.match(URL_REGEX)?.[0]?.trim();
  const promptSource =
    extracted.prompt || stripDetectedUrl(extracted.strippedText, url);
  const extractGoal = extracted.extractGoal || resolveExtractGoal(promptSource);

  return {
    rawText: text,
    trigger,
    body,
    prompt: stripPromptDecorations(promptSource),
    url,
    extractGoal: resolveDefaultExtractGoal(trigger, extractGoal),
  };
}
