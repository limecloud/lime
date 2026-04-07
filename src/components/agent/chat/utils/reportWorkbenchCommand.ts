export type ReportWorkbenchCommandTrigger =
  | "@研报"
  | "@report"
  | "@research_report";

export interface ParsedReportWorkbenchCommand {
  rawText: string;
  trigger: ReportWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  query?: string;
  site?: string;
  timeRange?: string;
  focus?: string;
  outputFormat?: string;
}

const REPORT_COMMAND_PREFIX_REGEX =
  /^\s*(@研报|@report|@research_report)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(关键词|查询|主题|query)|(站点|来源|site|source)|(时间|时间范围|time(?:[_\s-]?range)?|range)|(重点|关注点|维度|focus)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(研报|研究报告|行业报告|竞品报告|report|research\s+report)(?:\s|$|[:：])*/i;
const INLINE_TIME_RANGE_REGEX =
  /(近\d{1,3}天|近\d{1,2}周|近\d{1,2}个月|最近(?:一周|一月|一个月|半年|一年)|过去\d{1,3}天|过去\d{1,2}周|过去\d{1,2}个月|本周|本月|今年|去年|20\d{2})/i;
const LEADING_SITE_REGEX =
  /^(GitHub|知乎|B站|b站|Bilibili|36Kr|linux\.do|什么值得买|SMZDM|Yahoo Finance|微博|小红书|抖音)(?=$|[\s,，。；;:：])/i;

type ReportFieldKey = "query" | "site" | "timeRange" | "focus" | "outputFormat";

interface ReportFieldMatch {
  key: ReportFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedReportFields {
  query?: string;
  site?: string;
  timeRange?: string;
  focus?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): ReportWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@report") {
    return "@report";
  }
  if (normalized === "@research_report") {
    return "@research_report";
  }
  return "@研报";
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
  };

  return aliasMap[normalized] || value?.trim();
}

function resolveFieldKey(matched: RegExpExecArray): ReportFieldKey | null {
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
    return "focus";
  }
  if (matched[5]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): ReportFieldMatch[] {
  const baseMatches: Omit<ReportFieldMatch, "end">[] = [];
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
  matches: ReportFieldMatch[],
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

function extractReportFields(text: string): ExtractedReportFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedReportFields = {
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

    extracted[match.key] = extracted[match.key] || rawValue;
  });

  const strippedText = trimDecorations(stripExplicitFields(text, matches));
  const leadingSite = normalizeSite(
    strippedText.match(LEADING_SITE_REGEX)?.[1],
  );
  const inlineTimeRange = strippedText.match(INLINE_TIME_RANGE_REGEX)?.[1];
  const strippedWithoutSite = leadingSite
    ? trimDecorations(strippedText.replace(LEADING_SITE_REGEX, ""))
    : strippedText;
  const strippedWithoutTime = inlineTimeRange
    ? trimDecorations(strippedWithoutSite.replace(INLINE_TIME_RANGE_REGEX, ""))
    : strippedWithoutSite;

  return {
    query: extracted.query,
    site: extracted.site || leadingSite,
    timeRange: extracted.timeRange || inlineTimeRange,
    focus: extracted.focus,
    outputFormat: extracted.outputFormat,
    strippedText: strippedWithoutTime,
  };
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parseReportWorkbenchCommand(
  text: string,
): ParsedReportWorkbenchCommand | null {
  const matched = text.match(REPORT_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractReportFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);
  const fallbackPrompt = trimDecorations(
    [
      extracted.query || undefined,
      extracted.site || undefined,
      extracted.timeRange || undefined,
      extracted.focus || undefined,
      extracted.outputFormat || undefined,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: prompt || fallbackPrompt,
    query: extracted.query || prompt || undefined,
    site: extracted.site,
    timeRange: extracted.timeRange,
    focus: extracted.focus,
    outputFormat: extracted.outputFormat || "研究报告",
  };
}
