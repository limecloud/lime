export type BroadcastWorkbenchCommandTrigger =
  | "@播报"
  | "@播客"
  | "@broadcast";

export interface ParsedBroadcastWorkbenchCommand {
  rawText: string;
  trigger: BroadcastWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  content?: string;
  title?: string;
  audience?: string;
  tone?: string;
  durationHintMinutes?: number;
}

const BROADCAST_COMMAND_PREFIX_REGEX =
  /^\s*(@播报|@播客|@broadcast)(?:\s+|$)([\s\S]*)$/i;
const CONTENT_MARKER_REGEX =
  /(?:正文|内容|文章|原文|文稿|稿件|text|content)\s*[:：]/i;
const FIELD_LABEL_REGEX =
  /(?:(标题|title)|(听众|受众|audience)|(语气|风格|tone|style)|(时长|duration|duration(?:[_\s-]?hint(?:[_\s-]?minutes?)?)?))\s*[:：=]?\s*/gi;
const INLINE_DURATION_REGEX =
  /(\d{1,3})\s*(?:分钟|分|min|mins?|minutes?)(?=$|[\s,，。；;:：])/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(整理(?:成)?|改写(?:成)?|转成|做成|生成|请帮我|帮我|broadcast|podcast|create|generate|make|turn|convert)(?:\s|$|[:：])*/i;
const PROMPT_BREAK_REGEX =
  /(?:整理(?:成)?|改写(?:成)?|转成|做成|生成|请帮我|帮我|broadcast|podcast|create|generate|make|turn|convert)(?=\s|$|[:：])/i;

type BroadcastFieldKey = "title" | "audience" | "tone" | "duration";

interface BroadcastFieldMatch {
  key: BroadcastFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedBroadcastFields {
  title?: string;
  audience?: string;
  tone?: string;
  durationHintMinutes?: number;
  strippedText: string;
}

function normalizeTrigger(value: string): BroadcastWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@播客") {
    return "@播客";
  }
  if (normalized === "@broadcast") {
    return "@broadcast";
  }
  return "@播报";
}

function clampDuration(value: number | null | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(180, Math.trunc(value)));
}

function splitPromptAndContent(body: string): {
  promptSource: string;
  contentSource?: string;
} {
  const matched = CONTENT_MARKER_REGEX.exec(body);
  if (!matched || matched.index === undefined) {
    return {
      promptSource: body,
    };
  }

  const promptSource = body.slice(0, matched.index).trim();
  const contentSource = body
    .slice(matched.index + matched[0].length)
    .trim();

  return {
    promptSource,
    contentSource: contentSource || undefined,
  };
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFieldValue(value: string): string {
  return trimDecorations(value);
}

function resolveFieldKey(matched: RegExpExecArray): BroadcastFieldKey | null {
  if (matched[1]) {
    return "title";
  }
  if (matched[2]) {
    return "audience";
  }
  if (matched[3]) {
    return "tone";
  }
  if (matched[4]) {
    return "duration";
  }
  return null;
}

function collectFieldMatches(text: string): BroadcastFieldMatch[] {
  const baseMatches: Omit<BroadcastFieldMatch, "end">[] = [];
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
      index + 1 < baseMatches.length ? baseMatches[index + 1]!.start : text.length;
    const remainder = text.slice(match.valueStart, nextStart);

    if (match.key === "duration") {
      const durationMatch = remainder.match(
        /^\s*\d{1,3}(?:\s*(?:分钟|分|min|mins?|minutes?))?/i,
      );
      const consumed = durationMatch?.[0]?.length ?? remainder.length;
      return {
        ...match,
        end: match.valueStart + consumed,
      };
    }

    let end = nextStart;
    if (nextStart === text.length) {
      const durationIndex = remainder.search(INLINE_DURATION_REGEX);
      if (durationIndex >= 0) {
        end = Math.min(end, match.valueStart + durationIndex);
      }
      const promptBreakIndex = remainder.search(PROMPT_BREAK_REGEX);
      if (promptBreakIndex >= 0) {
        end = Math.min(end, match.valueStart + promptBreakIndex);
      }
    }

    return {
      ...match,
      end,
    };
  });
}

function stripExplicitFields(text: string, matches: BroadcastFieldMatch[]): string {
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

function extractBroadcastFields(text: string): ExtractedBroadcastFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedBroadcastFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = normalizeFieldValue(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "duration") {
      extracted.durationHintMinutes = clampDuration(
        Number.parseInt(rawValue.match(/\d{1,3}/)?.[0] || "", 10),
      );
      return;
    }

    if (!extracted[match.key]) {
      extracted[match.key] = rawValue;
    }
  });

  const strippedText = stripExplicitFields(text, matches);
  extracted.strippedText = trimDecorations(strippedText);
  return extracted;
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(
    text
      .replace(PROMPT_PREFIX_REGEX, "")
      .replace(INLINE_DURATION_REGEX, "")
      .replace(PROMPT_PREFIX_REGEX, ""),
  );
}

export function parseBroadcastWorkbenchCommand(
  text: string,
): ParsedBroadcastWorkbenchCommand | null {
  const matched = text.match(BROADCAST_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const { promptSource, contentSource } = splitPromptAndContent(body);
  const promptFields = extractBroadcastFields(promptSource || body);
  const bodyFields = extractBroadcastFields(body);
  const durationHintMinutes =
    promptFields.durationHintMinutes ??
    clampDuration(
      Number.parseInt(
        promptFields.strippedText.match(INLINE_DURATION_REGEX)?.[1] || "",
        10,
      ),
    ) ??
    bodyFields.durationHintMinutes;
  const prompt = stripPromptDecorations(promptFields.strippedText);
  const content =
    contentSource ||
    stripPromptDecorations(bodyFields.strippedText) ||
    undefined;

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    content,
    title: promptFields.title,
    audience: promptFields.audience,
    tone: promptFields.tone,
    durationHintMinutes,
  };
}
