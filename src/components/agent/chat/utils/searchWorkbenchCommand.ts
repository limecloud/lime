export type SearchWorkbenchCommandTrigger =
  | "@搜索"
  | "@Search"
  | "@search"
  | "@research"
  | "@调研"
  | "@Google Search"
  | "@Daily Search"
  | "@Search Agent"
  | "@Instagram Research";

export type SearchDepth = "quick" | "standard" | "deep";

export interface ParsedSearchWorkbenchCommand {
  rawText: string;
  trigger: SearchWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  query?: string;
  site?: string;
  timeRange?: string;
  depth?: SearchDepth;
  focus?: string;
  outputFormat?: string;
}

const SEARCH_COMMAND_PREFIX_REGEX =
  /^\s*(@Instagram Research|@Search Agent|@Google Search|@Daily Search|@搜索|@Search|@search|@research|@调研)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(关键词|查询|query)|(站点|来源|site|source)|(时间|时间范围|time(?:[_\s-]?range)?|range)|(深度|depth)|(关注点|重点|维度|focus)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(搜索|搜一下|查一下|查找|检索|调研|research|search|look\s+up|find)(?:\s|$|[:：])*/i;
const INLINE_TIME_RANGE_REGEX =
  /(近\d{1,3}天|近\d{1,2}周|近\d{1,2}个月|最近(?:一周|一月|一个月|半年|一年)|过去\d{1,3}天|过去\d{1,2}周|过去\d{1,2}个月|本周|本月|今年|去年|20\d{2})/i;
const LEADING_SITE_REGEX =
  /^(GitHub|知乎|B站|b站|Bilibili|36Kr|linux\.do|什么值得买|SMZDM|Yahoo Finance|微博|小红书|抖音|Instagram)(?=$|[\s,，。；;:：])/i;

type SearchFieldKey =
  | "query"
  | "site"
  | "timeRange"
  | "depth"
  | "focus"
  | "outputFormat";

interface SearchFieldMatch {
  key: SearchFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedSearchFields {
  query?: string;
  site?: string;
  timeRange?: string;
  depth?: SearchDepth;
  focus?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): SearchWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@search agent") {
    return "@Search Agent";
  }
  if (normalized === "@instagram research") {
    return "@Instagram Research";
  }
  if (normalized === "@google search") {
    return "@Google Search";
  }
  if (normalized === "@daily search") {
    return "@Daily Search";
  }
  if (normalized === "@search") {
    return value.trim() === "@Search" ? "@Search" : "@search";
  }
  if (normalized === "@research") {
    return "@research";
  }
  if (normalized === "@调研") {
    return "@调研";
  }
  return "@搜索";
}

function resolveDefaultTimeRange(
  trigger: SearchWorkbenchCommandTrigger,
  timeRange?: string,
): string | undefined {
  if (timeRange) {
    return timeRange;
  }

  if (trigger === "@Daily Search") {
    return "最近一天";
  }

  return undefined;
}

function resolveDefaultSite(
  trigger: SearchWorkbenchCommandTrigger,
  site?: string,
): string | undefined {
  if (site) {
    return site;
  }

  if (trigger === "@Instagram Research") {
    return "Instagram";
  }

  return undefined;
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSite(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const aliasMap: Record<string, string> = {
    github: "GitHub",
    知乎: "知乎",
    b站: "B站",
    bilibili: "B站",
    "36kr": "36Kr",
    "linux.do": "linux.do",
    什么值得买: "什么值得买",
    smzdm: "什么值得买",
    "yahoo finance": "Yahoo Finance",
    微博: "微博",
    小红书: "小红书",
    抖音: "抖音",
    instagram: "Instagram",
  };

  return aliasMap[normalized] || value?.trim();
}

function normalizeDepth(value: string | undefined): SearchDepth | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "quick" ||
    normalized === "fast" ||
    normalized === "简版" ||
    normalized === "快速" ||
    normalized === "速览"
  ) {
    return "quick";
  }

  if (
    normalized === "deep" ||
    normalized === "深入" ||
    normalized === "深度" ||
    normalized === "详细"
  ) {
    return "deep";
  }

  if (
    normalized === "standard" ||
    normalized === "normal" ||
    normalized === "标准" ||
    normalized === "普通"
  ) {
    return "standard";
  }

  return undefined;
}

function resolveFieldKey(matched: RegExpExecArray): SearchFieldKey | null {
  if (matched[1]) {
    return "query";
  }
  if (matched[2]) {
    return "site";
  }
  if (matched[3]) {
    return "timeRange";
  }
  if (matched[4]) {
    return "depth";
  }
  if (matched[5]) {
    return "focus";
  }
  if (matched[6]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): SearchFieldMatch[] {
  const baseMatches: Omit<SearchFieldMatch, "end">[] = [];
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

  return baseMatches.map((match, index) => {
    const nextStart =
      index + 1 < baseMatches.length
        ? baseMatches[index + 1]!.start
        : text.length;
    const remainder = text.slice(match.valueStart, nextStart);

    if (match.key === "depth") {
      const depthMatch = remainder.match(
        /^\s*(?:quick|fast|standard|normal|deep|简版|快速|速览|标准|普通|深入|深度|详细)/i,
      );
      const consumed = depthMatch?.[0]?.length ?? remainder.length;
      return {
        ...match,
        end: match.valueStart + consumed,
      };
    }

    return {
      ...match,
      end: nextStart,
    };
  });
}

function stripExplicitFields(
  text: string,
  matches: SearchFieldMatch[],
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

function extractSearchFields(text: string): ExtractedSearchFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedSearchFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "site") {
      extracted.site = extracted.site || normalizeSite(rawValue);
      return;
    }

    if (match.key === "depth") {
      extracted.depth = extracted.depth || normalizeDepth(rawValue);
      return;
    }

    extracted[match.key] = extracted[match.key] || rawValue;
  });

  extracted.strippedText = trimDecorations(stripExplicitFields(text, matches));
  return extracted;
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parseSearchWorkbenchCommand(
  text: string,
): ParsedSearchWorkbenchCommand | null {
  const matched = text.match(SEARCH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const trigger = normalizeTrigger(matched[1] || "");
  const extracted = extractSearchFields(body);

  let site = extracted.site;
  let timeRange = extracted.timeRange;
  let promptSource = extracted.strippedText;

  if (!site) {
    const leadingSite = promptSource.match(LEADING_SITE_REGEX)?.[1];
    site = normalizeSite(leadingSite);
    if (site && leadingSite) {
      promptSource = trimDecorations(promptSource.slice(leadingSite.length));
    }
  }

  if (!timeRange) {
    const inlineTimeRange = promptSource.match(INLINE_TIME_RANGE_REGEX)?.[1];
    if (inlineTimeRange) {
      timeRange = inlineTimeRange.trim();
      promptSource = trimDecorations(
        promptSource.replace(INLINE_TIME_RANGE_REGEX, " "),
      );
    }
  }

  const prompt = stripPromptDecorations(promptSource);
  const query = trimDecorations(extracted.query || prompt);
  const fallbackPrompt = trimDecorations(
    [
      query || undefined,
      site || undefined,
      timeRange || undefined,
      extracted.focus || undefined,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    rawText: text,
    trigger,
    body,
    prompt: prompt || fallbackPrompt,
    query: query || undefined,
    site: resolveDefaultSite(trigger, site),
    timeRange: resolveDefaultTimeRange(trigger, timeRange),
    depth: extracted.depth,
    focus: extracted.focus,
    outputFormat: extracted.outputFormat,
  };
}
