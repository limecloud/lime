export type TranslationWorkbenchCommandTrigger =
  | "@翻译"
  | "@translate"
  | "@translation";

export interface ParsedTranslationWorkbenchCommand {
  rawText: string;
  trigger: TranslationWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  content?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  style?: string;
  outputFormat?: string;
}

const TRANSLATION_COMMAND_PREFIX_REGEX =
  /^\s*(@翻译|@translate|@translation)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(内容|正文|原文|content|text)|(原语言|源语言|source(?:[_\s-]?language)?|source|from)|(目标语言|目标语种|语言|target(?:[_\s-]?language)?|target|to)|(风格|语气|style|tone)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX = /^\s*(翻译|翻成|译成|translate)(?:\s|$|[:：])*/i;

type TranslationFieldKey =
  | "content"
  | "sourceLanguage"
  | "targetLanguage"
  | "style"
  | "outputFormat";

interface TranslationFieldMatch {
  key: TranslationFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedTranslationFields {
  content?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  style?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): TranslationWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@translate") {
    return "@translate";
  }
  if (normalized === "@translation") {
    return "@translation";
  }
  return "@翻译";
}

function trimDecorations(value: string): string {
  return value
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguage(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const aliasMap: Record<string, string> = {
    chinese: "中文",
    zh: "中文",
    中文: "中文",
    汉语: "中文",
    chinese_simplified: "中文",
    english: "英语",
    en: "英语",
    英文: "英语",
    英语: "英语",
    japanese: "日语",
    ja: "日语",
    日语: "日语",
    日文: "日语",
    korean: "韩语",
    ko: "韩语",
    韩语: "韩语",
    french: "法语",
    fr: "法语",
    法语: "法语",
    german: "德语",
    de: "德语",
    德语: "德语",
    spanish: "西班牙语",
    es: "西班牙语",
    西班牙语: "西班牙语",
    russian: "俄语",
    ru: "俄语",
    俄语: "俄语",
  };

  return aliasMap[normalized] || value?.trim();
}

function resolveFieldKey(matched: RegExpExecArray): TranslationFieldKey | null {
  if (matched[1]) {
    return "content";
  }
  if (matched[2]) {
    return "sourceLanguage";
  }
  if (matched[3]) {
    return "targetLanguage";
  }
  if (matched[4]) {
    return "style";
  }
  if (matched[5]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): TranslationFieldMatch[] {
  const baseMatches: Omit<TranslationFieldMatch, "end">[] = [];
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
  matches: TranslationFieldMatch[],
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

function extractTranslationFields(text: string): ExtractedTranslationFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedTranslationFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = trimDecorations(text.slice(match.valueStart, match.end));
    if (!rawValue) {
      return;
    }

    if (match.key === "sourceLanguage" || match.key === "targetLanguage") {
      extracted[match.key] =
        extracted[match.key] || normalizeLanguage(rawValue);
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

export function parseTranslationWorkbenchCommand(
  text: string,
): ParsedTranslationWorkbenchCommand | null {
  const matched = text.match(TRANSLATION_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractTranslationFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);
  const fallbackPrompt = trimDecorations(
    [
      extracted.content || undefined,
      extracted.sourceLanguage ? `从${extracted.sourceLanguage}` : undefined,
      extracted.targetLanguage ? `译为${extracted.targetLanguage}` : undefined,
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
    sourceLanguage: extracted.sourceLanguage,
    targetLanguage: extracted.targetLanguage,
    style: extracted.style,
    outputFormat: extracted.outputFormat,
  };
}
