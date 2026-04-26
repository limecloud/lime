export type ResourceSearchWorkbenchCommandTrigger =
  | "@素材"
  | "@资源"
  | "@resource"
  | "@Image Search"
  | "@Fetch Image"
  | "@Pinterest Image Search"
  | "@Video Search";

export type ResourceSearchType = "image" | "bgm" | "sfx" | "video";

export interface ParsedResourceSearchWorkbenchCommand {
  rawText: string;
  trigger: ResourceSearchWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  title?: string;
  resourceType?: ResourceSearchType;
  query?: string;
  usage?: string;
  count?: number;
}

const RESOURCE_SEARCH_COMMAND_PREFIX_REGEX =
  /^\s*(@素材|@资源|@resource|@Image Search|@Fetch Image|@Pinterest Image Search|@Video Search)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(标题|title)|(类型|资源类型|resource(?:[_\s-]?type)?|type)|(关键词|查询|query)|(用途|usage)|(数量|count))\s*[:：=]?\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(找|搜索|检索|查找|search|find|lookup|look\s+for)(?:\s|$|[:：])*/i;
const COUNT_REGEX =
  /(\d{1,2})\s*(?:个|条|张|首|段|份|results?|items?)(?=$|[\s,，。；;:：])/i;
const USAGE_TRAIL_REGEX =
  /(?:^|[\s,，。；;:：])(?:用于|给|for)\s*([^,，。；;\n]+?)(?=$|[\s,，。；;:：]+\d{1,2}\s*(?:个|条|张|首|段|份|results?|items?)|[，,。；;])/i;

type ResourceFieldKey = "title" | "resourceType" | "query" | "usage" | "count";

interface ResourceFieldMatch {
  key: ResourceFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedResourceFields {
  title?: string;
  resourceType?: ResourceSearchType;
  query?: string;
  usage?: string;
  count?: number;
  strippedText: string;
}

function normalizeTrigger(
  value: string,
): ResourceSearchWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@pinterest image search") {
    return "@Pinterest Image Search";
  }
  if (normalized === "@image search") {
    return "@Image Search";
  }
  if (normalized === "@fetch image") {
    return "@Fetch Image";
  }
  if (normalized === "@video search") {
    return "@Video Search";
  }
  if (normalized === "@资源") {
    return "@资源";
  }
  if (normalized === "@resource") {
    return "@resource";
  }
  return "@素材";
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampCount(value: number | null | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function normalizeResourceType(
  value: string | undefined,
): ResourceSearchType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "图片" ||
    normalized === "图" ||
    normalized === "配图" ||
    normalized === "插画" ||
    normalized === "照片" ||
    normalized === "image" ||
    normalized === "images" ||
    normalized === "photo" ||
    normalized === "illustration"
  ) {
    return "image";
  }

  if (
    normalized === "bgm" ||
    normalized === "背景音乐" ||
    normalized === "音乐" ||
    normalized === "music"
  ) {
    return "bgm";
  }

  if (
    normalized === "音效" ||
    normalized === "声效" ||
    normalized === "sfx" ||
    normalized === "sound" ||
    normalized === "soundeffect"
  ) {
    return "sfx";
  }

  if (
    normalized === "视频" ||
    normalized === "视频素材" ||
    normalized === "video" ||
    normalized === "clip"
  ) {
    return "video";
  }

  return undefined;
}

function inferResourceTypeFromText(
  value: string,
): ResourceSearchType | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (/(背景音乐|bgm|音乐\b|music\b)/i.test(normalized)) {
    return "bgm";
  }
  if (/(音效|声效|sfx|sound effect|sound\b)/i.test(normalized)) {
    return "sfx";
  }
  if (/(视频素材|视频|video|clip)/i.test(normalized)) {
    return "video";
  }
  if (
    /(图片|配图|插画|照片|image|photo|illustration|背景图)/i.test(normalized)
  ) {
    return "image";
  }
  return undefined;
}

function resolveDefaultResourceType(
  trigger: ResourceSearchWorkbenchCommandTrigger,
  resourceType?: ResourceSearchType,
): ResourceSearchType | undefined {
  if (resourceType) {
    return resourceType;
  }

  if (
    trigger === "@Image Search" ||
    trigger === "@Fetch Image" ||
    trigger === "@Pinterest Image Search"
  ) {
    return "image";
  }

  if (trigger === "@Video Search") {
    return "video";
  }

  return undefined;
}

function resolveFieldKey(matched: RegExpExecArray): ResourceFieldKey | null {
  if (matched[1]) {
    return "title";
  }
  if (matched[2]) {
    return "resourceType";
  }
  if (matched[3]) {
    return "query";
  }
  if (matched[4]) {
    return "usage";
  }
  if (matched[5]) {
    return "count";
  }
  return null;
}

function collectFieldMatches(text: string): ResourceFieldMatch[] {
  const baseMatches: Omit<ResourceFieldMatch, "end">[] = [];
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

    if (match.key === "count") {
      const countMatch = remainder.match(
        /^\s*\d{1,2}(?:\s*(?:个|条|张|首|段|份|results?|items?))?/i,
      );
      const consumed = countMatch?.[0]?.length ?? remainder.length;
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
  matches: ResourceFieldMatch[],
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

function extractExplicitFields(text: string): ExtractedResourceFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedResourceFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "title") {
      extracted.title = rawValue;
      return;
    }
    if (match.key === "resourceType") {
      extracted.resourceType = normalizeResourceType(rawValue);
      return;
    }
    if (match.key === "query") {
      extracted.query = rawValue;
      return;
    }
    if (match.key === "usage") {
      extracted.usage = rawValue;
      return;
    }
    if (match.key === "count") {
      extracted.count = clampCount(
        Number.parseInt(rawValue.match(/\d{1,2}/)?.[0] || "", 10),
      );
    }
  });

  extracted.strippedText = trimDecorations(stripExplicitFields(text, matches));
  return extracted;
}

function stripLeadingResourceType(
  text: string,
  resourceType?: ResourceSearchType,
): string {
  if (!resourceType) {
    return text;
  }

  const aliasMap: Record<ResourceSearchType, string[]> = {
    image: [
      "图片",
      "图",
      "配图",
      "插画",
      "照片",
      "image",
      "photo",
      "illustration",
    ],
    bgm: ["背景音乐", "音乐", "bgm", "music"],
    sfx: ["音效", "声效", "sfx", "sound"],
    video: ["视频素材", "视频", "video", "clip"],
  };
  const aliases = aliasMap[resourceType];
  const pattern = new RegExp(
    `^(?:${aliases.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[\\s,，。；;:：])`,
    "i",
  );

  return text.replace(pattern, "").trim();
}

function stripTrailingUsageAndCount(text: string): {
  strippedText: string;
  usage?: string;
  count?: number;
} {
  let strippedText = text;
  let usage: string | undefined;
  let count = clampCount(
    Number.parseInt(text.match(COUNT_REGEX)?.[1] || "", 10),
  );

  const usageMatch = text.match(USAGE_TRAIL_REGEX);
  if (usageMatch) {
    usage = trimDecorations(usageMatch[1] || "");
    strippedText = trimDecorations(text.replace(usageMatch[0], " "));
  }

  if (count) {
    strippedText = trimDecorations(strippedText.replace(COUNT_REGEX, ""));
  }

  return {
    strippedText,
    usage,
    count,
  };
}

export function parseResourceSearchWorkbenchCommand(
  text: string,
): ParsedResourceSearchWorkbenchCommand | null {
  const matched = text.match(RESOURCE_SEARCH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const trigger = normalizeTrigger(matched[1] || "");
  const explicitFields = extractExplicitFields(body);
  let strippedText = explicitFields.strippedText;
  const inferredResourceType = resolveDefaultResourceType(
    trigger,
    explicitFields.resourceType || inferResourceTypeFromText(strippedText),
  );

  strippedText = stripLeadingResourceType(strippedText, inferredResourceType);
  strippedText = trimDecorations(strippedText.replace(PROMPT_PREFIX_REGEX, ""));

  const trailingResolution = stripTrailingUsageAndCount(strippedText);
  const query = trimDecorations(
    explicitFields.query || trailingResolution.strippedText,
  );
  const prompt = trimDecorations(
    explicitFields.query
      ? [explicitFields.query, explicitFields.usage || trailingResolution.usage]
          .filter(Boolean)
          .join(" ")
      : trailingResolution.strippedText,
  );

  return {
    rawText: text,
    trigger,
    body,
    prompt,
    title: explicitFields.title,
    resourceType: inferredResourceType,
    query: query || undefined,
    usage: explicitFields.usage || trailingResolution.usage,
    count: explicitFields.count || trailingResolution.count,
  };
}
