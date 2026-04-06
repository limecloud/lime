export type PdfWorkbenchCommandTrigger = "@读PDF" | "@pdf" | "@read_pdf";

export interface ParsedPdfWorkbenchCommand {
  rawText: string;
  trigger: PdfWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  sourcePath?: string;
  sourceUrl?: string;
  focus?: string;
  outputFormat?: string;
}

const PDF_COMMAND_PREFIX_REGEX =
  /^\s*(@读PDF|@pdf|@read_pdf)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(文件|路径|pdf|source(?:[_\s-]?path)?|path)|(链接|网址|url|source(?:[_\s-]?url)?)|(重点|关注点|焦点|focus)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(读取|解读|阅读|分析|提取|总结|read|parse|analyze|summarize)(?:\s|$|[:：])*/i;
const PDF_URL_REGEX = /https?:\/\/[^\s"'，。；;]+\.pdf(?:\?[^\s"'，。；;]*)?/i;
const PDF_PATH_REGEX =
  /(?:"([^"\n]+\.pdf)"|'([^'\n]+\.pdf)'|((?:(?:[A-Za-z]:[\\/])|(?:\/)|(?:\.{1,2}[\\/]))?[^\s"'，。；;]+\.pdf))/i;

type PdfFieldKey = "source" | "sourceUrl" | "focus" | "outputFormat";

interface PdfFieldMatch {
  key: PdfFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedPdfFields {
  sourcePath?: string;
  sourceUrl?: string;
  focus?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): PdfWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@pdf") {
    return "@pdf";
  }
  if (normalized === "@read_pdf") {
    return "@read_pdf";
  }
  return "@读PDF";
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

function normalizePdfSource(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^['"]|['"]$/g, "").trim();
}

function resolveFieldKey(matched: RegExpExecArray): PdfFieldKey | null {
  if (matched[1]) {
    return "source";
  }
  if (matched[2]) {
    return "sourceUrl";
  }
  if (matched[3]) {
    return "focus";
  }
  if (matched[4]) {
    return "outputFormat";
  }
  return null;
}

function collectFieldMatches(text: string): PdfFieldMatch[] {
  const baseMatches: Omit<PdfFieldMatch, "end">[] = [];
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
    end: index + 1 < baseMatches.length ? baseMatches[index + 1]!.start : text.length,
  }));
}

function stripExplicitFields(text: string, matches: PdfFieldMatch[]): string {
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

function extractPdfUrl(text: string): string | undefined {
  return normalizePdfSource(text.match(PDF_URL_REGEX)?.[0]);
}

function extractPdfPath(text: string): string | undefined {
  const matched = text.match(PDF_PATH_REGEX);
  return normalizePdfSource(matched?.[1] || matched?.[2] || matched?.[3]);
}

function stripDetectedSource(text: string, source?: string): string {
  if (!source) {
    return text;
  }

  const escapedSource = escapeRegExp(source);
  return trimDecorations(
    text.replace(new RegExp(`(["'])?${escapedSource}\\1`, "gi"), " "),
  );
}

function extractPdfFields(text: string): ExtractedPdfFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedPdfFields = {
    strippedText: text,
  };

  matches.forEach((match) => {
    const rawValue = normalizePdfSource(
      trimDecorations(text.slice(match.valueStart, match.end)),
    );
    if (!rawValue) {
      return;
    }

    if (match.key === "sourceUrl") {
      extracted.sourceUrl = extracted.sourceUrl || rawValue;
      return;
    }

    if (match.key === "source") {
      if (PDF_URL_REGEX.test(rawValue)) {
        extracted.sourceUrl = extracted.sourceUrl || rawValue;
      } else {
        extracted.sourcePath = extracted.sourcePath || rawValue;
      }
      return;
    }

    extracted[match.key] = extracted[match.key] || rawValue;
  });

  const strippedWithoutFields = trimDecorations(stripExplicitFields(text, matches));
  const detectedUrl = extracted.sourceUrl || extractPdfUrl(strippedWithoutFields);
  const strippedWithoutUrl = stripDetectedSource(strippedWithoutFields, detectedUrl);
  const detectedPath =
    extracted.sourcePath || extractPdfPath(strippedWithoutUrl);
  const strippedWithoutPath = stripDetectedSource(strippedWithoutUrl, detectedPath);

  return {
    sourcePath: detectedPath,
    sourceUrl: detectedUrl,
    focus: extracted.focus,
    outputFormat: extracted.outputFormat,
    strippedText: strippedWithoutPath,
  };
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parsePdfWorkbenchCommand(
  text: string,
): ParsedPdfWorkbenchCommand | null {
  const matched = text.match(PDF_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractPdfFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    sourcePath: extracted.sourcePath,
    sourceUrl: extracted.sourceUrl,
    focus: extracted.focus,
    outputFormat: extracted.outputFormat,
  };
}
