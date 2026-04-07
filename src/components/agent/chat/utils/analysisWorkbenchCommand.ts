export type AnalysisWorkbenchCommandTrigger =
  | "@分析"
  | "@analysis"
  | "@analyze";

export interface ParsedAnalysisWorkbenchCommand {
  rawText: string;
  trigger: AnalysisWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  content?: string;
  focus?: string;
  style?: string;
  outputFormat?: string;
}

const ANALYSIS_COMMAND_PREFIX_REGEX =
  /^\s*(@分析|@analysis|@analyze)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(内容|正文|原文|content|text)|(重点|焦点|角度|维度|问题|focus|angle|dimension|question)|(风格|语气|style|tone)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(分析|拆解|评估|判断|analyze|analysis)(?:\s|$|[:：])*/i;

type AnalysisFieldKey = "content" | "focus" | "style" | "outputFormat";

interface AnalysisFieldMatch {
  key: AnalysisFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedAnalysisFields {
  content?: string;
  focus?: string;
  style?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): AnalysisWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@analysis") {
    return "@analysis";
  }
  if (normalized === "@analyze") {
    return "@analyze";
  }
  return "@分析";
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveFieldKey(matched: RegExpExecArray): AnalysisFieldKey | null {
  if (matched[1]) {
    return "content";
  }
  if (matched[2]) {
    return "focus";
  }
  if (matched[3]) {
    return "style";
  }
  if (matched[4]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): AnalysisFieldMatch[] {
  const baseMatches: Omit<AnalysisFieldMatch, "end">[] = [];
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
  matches: AnalysisFieldMatch[],
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

function extractAnalysisFields(text: string): ExtractedAnalysisFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedAnalysisFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
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

export function parseAnalysisWorkbenchCommand(
  text: string,
): ParsedAnalysisWorkbenchCommand | null {
  const matched = text.match(ANALYSIS_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractAnalysisFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);
  const fallbackPrompt = trimDecorations(
    [
      extracted.content || undefined,
      extracted.focus ? `围绕${extracted.focus}` : undefined,
      extracted.style || undefined,
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
    content: extracted.content,
    focus: extracted.focus,
    style: extracted.style,
    outputFormat: extracted.outputFormat,
  };
}
