import {
  normalizeContentPostPlatform,
  parseContentPostPlatform,
  type ContentPostPlatformType,
} from "./contentPostPlatform";

export type GrowthWorkbenchCommandTrigger =
  | "@增长"
  | "@增长跟踪"
  | "@growth"
  | "@Growth Expert";

export interface ParsedGrowthWorkbenchCommand {
  rawText: string;
  trigger: GrowthWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
  accountList?: string;
  reportCadence?: string;
  alertThreshold?: string;
}

const GROWTH_COMMAND_PREFIX_REGEX =
  /^\s*(@Growth Expert|@增长跟踪|@增长|@growth)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(平台|渠道|platform|channel)|(账号|账号列表|参考账号|目标账号|accounts?|handles?)|(回报频率|回报节奏|频率|schedule|cadence|report(?:[_\s-]?cadence)?)|(告警|阈值|告警阈值|alert|threshold))\s*[:：=]?\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(做一版|整理|输出|制定|跟踪|监控|分析|track|monitor|analyze|build|create)(?:\s|$|[:：])*/i;
const PROMPT_BOUNDARY_REGEX =
  /\s+(?=(?:帮我|给我|请|help\s+me|please)\b|(?:帮我|给我|请))/i;

type GrowthFieldKey =
  | "platform"
  | "accountList"
  | "reportCadence"
  | "alertThreshold";

interface GrowthFieldMatch {
  key: GrowthFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedGrowthFields {
  platformType?: ContentPostPlatformType;
  platformLabel?: string;
  accountList?: string;
  reportCadence?: string;
  alertThreshold?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): GrowthWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@增长跟踪") {
    return "@增长跟踪";
  }
  if (normalized === "@growth") {
    return "@growth";
  }
  if (normalized === "@growth expert") {
    return "@Growth Expert";
  }
  return "@增长";
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAccountList(value: string | undefined): string | undefined {
  const normalized = trimDecorations(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s*[,，、]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || undefined;
}

function resolveFieldKey(matched: RegExpExecArray): GrowthFieldKey | null {
  if (matched[1]) {
    return "platform";
  }
  if (matched[2]) {
    return "accountList";
  }
  if (matched[3]) {
    return "reportCadence";
  }
  if (matched[4]) {
    return "alertThreshold";
  }
  return null;
}

function collectFieldMatches(text: string): GrowthFieldMatch[] {
  const baseMatches: Omit<GrowthFieldMatch, "end">[] = [];
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
    const promptBoundaryIndex =
      remainder.match(PROMPT_BOUNDARY_REGEX)?.index ?? -1;

    return {
      ...match,
      end:
        promptBoundaryIndex >= 0
          ? match.valueStart + promptBoundaryIndex
          : nextStart,
    };
  });
}

function stripExplicitFields(text: string, matches: GrowthFieldMatch[]): string {
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

function inferAccountListFromText(text: string): string | undefined {
  const handles = Array.from(
    text.matchAll(/(^|[\s,，、])(@[a-zA-Z0-9_.-]{2,})(?=$|[\s,，、。；;:：])/g),
  )
    .map((matched) => matched[2]?.trim())
    .filter((value): value is string => Boolean(value));

  if (handles.length === 0) {
    return undefined;
  }

  return normalizeAccountList(Array.from(new Set(handles)).join(", "));
}

function extractGrowthFields(text: string): ExtractedGrowthFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedGrowthFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "platform") {
      const normalizedPlatform = normalizeContentPostPlatform(rawValue);
      extracted.platformType = extracted.platformType || normalizedPlatform.platformType;
      extracted.platformLabel =
        extracted.platformLabel || normalizedPlatform.platformLabel;
      return;
    }

    if (match.key === "accountList") {
      extracted.accountList =
        extracted.accountList || normalizeAccountList(rawValue);
      return;
    }

    extracted[match.key] = extracted[match.key] || rawValue;
  });

  let strippedText = trimDecorations(stripExplicitFields(text, matches));

  if (!extracted.platformType) {
    const parsedPlatform = parseContentPostPlatform(strippedText);
    extracted.platformType = parsedPlatform.platformType;
    extracted.platformLabel = parsedPlatform.platformLabel;
    if (parsedPlatform.leadingPlatformText) {
      strippedText = trimDecorations(
        strippedText.slice(parsedPlatform.leadingPlatformText.length),
      );
    }
  }

  extracted.accountList =
    extracted.accountList || inferAccountListFromText(strippedText);
  extracted.strippedText = strippedText;
  return extracted;
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parseGrowthWorkbenchCommand(
  text: string,
): ParsedGrowthWorkbenchCommand | null {
  const matched = text.match(GROWTH_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractGrowthFields(body);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: stripPromptDecorations(extracted.strippedText),
    platformType: extracted.platformType,
    platformLabel: extracted.platformLabel,
    accountList: extracted.accountList,
    reportCadence: extracted.reportCadence,
    alertThreshold: extracted.alertThreshold,
  };
}
