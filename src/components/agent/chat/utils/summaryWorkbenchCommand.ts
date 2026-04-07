export type SummaryWorkbenchCommandTrigger =
  | "@总结"
  | "@summary"
  | "@summarize"
  | "@摘要";

export type SummaryLength = "short" | "medium" | "long";

export interface ParsedSummaryWorkbenchCommand {
  rawText: string;
  trigger: SummaryWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  content?: string;
  focus?: string;
  length?: SummaryLength;
  style?: string;
  outputFormat?: string;
}

const SUMMARY_COMMAND_PREFIX_REGEX =
  /^\s*(@总结|@summary|@summarize|@摘要)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(内容|正文|原文|content|text)|(重点|焦点|维度|focus)|(长度|篇幅|length)|(风格|语气|style|tone)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(总结|概括|提炼|摘要|summary|summarize)(?:\s|$|[:：])*/i;

type SummaryFieldKey =
  | "content"
  | "focus"
  | "length"
  | "style"
  | "outputFormat";

interface SummaryFieldMatch {
  key: SummaryFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedSummaryFields {
  content?: string;
  focus?: string;
  length?: SummaryLength;
  style?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): SummaryWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@summary") {
    return "@summary";
  }
  if (normalized === "@summarize") {
    return "@summarize";
  }
  if (normalized === "@摘要") {
    return "@摘要";
  }
  return "@总结";
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLength(value: string | undefined): SummaryLength | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "short" ||
    normalized === "brief" ||
    normalized === "简短" ||
    normalized === "短" ||
    normalized === "要点"
  ) {
    return "short";
  }

  if (
    normalized === "long" ||
    normalized === "detailed" ||
    normalized === "详细" ||
    normalized === "长" ||
    normalized === "完整"
  ) {
    return "long";
  }

  if (
    normalized === "medium" ||
    normalized === "standard" ||
    normalized === "中" ||
    normalized === "适中" ||
    normalized === "标准"
  ) {
    return "medium";
  }

  return undefined;
}

function resolveFieldKey(matched: RegExpExecArray): SummaryFieldKey | null {
  if (matched[1]) {
    return "content";
  }
  if (matched[2]) {
    return "focus";
  }
  if (matched[3]) {
    return "length";
  }
  if (matched[4]) {
    return "style";
  }
  if (matched[5]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): SummaryFieldMatch[] {
  const baseMatches: Omit<SummaryFieldMatch, "end">[] = [];
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

    if (match.key === "length") {
      const lengthMatch = remainder.match(
        /^\s*(?:short|brief|medium|standard|long|detailed|简短|短|要点|中|适中|标准|详细|长|完整)/i,
      );
      const consumed = lengthMatch?.[0]?.length ?? remainder.length;
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
  matches: SummaryFieldMatch[],
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

function extractSummaryFields(text: string): ExtractedSummaryFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedSummaryFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "length") {
      extracted.length = extracted.length || normalizeLength(rawValue);
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

export function parseSummaryWorkbenchCommand(
  text: string,
): ParsedSummaryWorkbenchCommand | null {
  const matched = text.match(SUMMARY_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractSummaryFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);
  const fallbackPrompt = trimDecorations(
    [
      extracted.content || undefined,
      extracted.focus || undefined,
      extracted.length || undefined,
      extracted.style || undefined,
    ]
      .filter(Boolean)
      .join(" "),
  );

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: prompt || fallbackPrompt,
    content: extracted.content,
    focus: extracted.focus,
    length: extracted.length,
    style: extracted.style,
    outputFormat: extracted.outputFormat,
  };
}
