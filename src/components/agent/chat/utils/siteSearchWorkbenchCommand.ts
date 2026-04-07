export type SiteSearchWorkbenchCommandTrigger =
  | "@站点搜索"
  | "@站点"
  | "@site_search"
  | "@site";

export interface ParsedSiteSearchWorkbenchCommand {
  rawText: string;
  trigger: SiteSearchWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  site?: string;
  query?: string;
  limit?: number;
}

const SITE_SEARCH_COMMAND_PREFIX_REGEX =
  /^\s*(@站点搜索|@站点|@site_search|@site)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(站点|来源|site|source)|(关键词|查询|query)|(数量|count|limit))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(在|去|用|搜索|搜一下|查一下|查找|检索|search|find|lookup)(?:\s|$|[:：])*/i;
const LEADING_SITE_REGEX =
  /^(GitHub|知乎|B站|b站|Bilibili|36Kr|linux\.do|什么值得买|SMZDM|Yahoo Finance)(?=$|[\s,，。；;:：])/i;
const INLINE_LIMIT_REGEX =
  /(\d{1,2})\s*(?:条|个|项|results?|items?)(?=$|[\s,，。；;:：])/i;

type SiteSearchFieldKey = "site" | "query" | "limit";

interface SiteSearchFieldMatch {
  key: SiteSearchFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedSiteSearchFields {
  site?: string;
  query?: string;
  limit?: number;
  strippedText: string;
}

function normalizeTrigger(value: string): SiteSearchWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@站点") {
    return "@站点";
  }
  if (normalized === "@site_search") {
    return "@site_search";
  }
  if (normalized === "@site") {
    return "@site";
  }
  return "@站点搜索";
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
  };

  return aliasMap[normalized] || value?.trim();
}

function clampLimit(value: number | null | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function resolveFieldKey(matched: RegExpExecArray): SiteSearchFieldKey | null {
  if (matched[1]) {
    return "site";
  }
  if (matched[2]) {
    return "query";
  }
  if (matched[3]) {
    return "limit";
  }
  return null;
}

function collectFieldMatches(text: string): SiteSearchFieldMatch[] {
  const baseMatches: Omit<SiteSearchFieldMatch, "end">[] = [];
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

    if (match.key === "limit") {
      const limitMatch = remainder.match(
        /^\s*\d{1,2}(?:\s*(?:条|个|项|results?|items?))?/i,
      );
      const consumed = limitMatch?.[0]?.length ?? remainder.length;
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
  matches: SiteSearchFieldMatch[],
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

function extractSiteSearchFields(text: string): ExtractedSiteSearchFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedSiteSearchFields = {
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
    if (match.key === "limit") {
      extracted.limit =
        extracted.limit ||
        clampLimit(Number.parseInt(rawValue.match(/\d{1,2}/)?.[0] || "", 10));
      return;
    }

    extracted.query = extracted.query || rawValue;
  });

  extracted.strippedText = trimDecorations(stripExplicitFields(text, matches));
  return extracted;
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parseSiteSearchWorkbenchCommand(
  text: string,
): ParsedSiteSearchWorkbenchCommand | null {
  const matched = text.match(SITE_SEARCH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractSiteSearchFields(body);
  let site = extracted.site;
  let promptSource = extracted.strippedText;

  if (!site) {
    const leadingSite = promptSource.match(LEADING_SITE_REGEX)?.[1];
    site = normalizeSite(leadingSite);
    if (site && leadingSite) {
      promptSource = trimDecorations(promptSource.slice(leadingSite.length));
    }
  }

  let limit = extracted.limit;
  if (!limit) {
    const inlineLimit = promptSource.match(INLINE_LIMIT_REGEX)?.[1];
    limit = clampLimit(
      inlineLimit ? Number.parseInt(inlineLimit, 10) : undefined,
    );
    if (limit) {
      promptSource = trimDecorations(
        promptSource.replace(INLINE_LIMIT_REGEX, " "),
      );
    }
  }

  const prompt = stripPromptDecorations(promptSource);
  const query = trimDecorations(extracted.query || prompt);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: prompt || query,
    site,
    query: query || undefined,
    limit,
  };
}
