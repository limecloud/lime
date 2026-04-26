import type { SummaryLength } from "./summaryWorkbenchCommand";

export type FileReadWorkbenchCommandTrigger =
  | "@读文件"
  | "@read_file"
  | "@Read File Content";

export interface ParsedFileReadWorkbenchCommand {
  rawText: string;
  trigger: FileReadWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  sourcePath?: string;
  focus?: string;
  length?: SummaryLength;
  style?: string;
  outputFormat?: string;
}

const FILE_READ_COMMAND_PREFIX_REGEX =
  /^\s*(@读文件|@read_file|@Read File Content)(?:\s+|$)([\s\S]*)$/i;
const FIELD_LABEL_REGEX =
  /(?:(文件|路径|file|source(?:[_\s-]?path)?|path)|(重点|关注点|焦点|focus)|(长度|篇幅|length)|(风格|语气|style|tone)|(输出|格式|output|format))\s*[:：=]\s*/gi;
const PROMPT_PREFIX_REGEX =
  /^\s*(读取|解读|阅读|分析|提取|总结|read|parse|analyze|summarize)(?:\s|$|[:：])*/i;
const FILE_PATH_REGEX =
  /(?:"([^"\n]+)"|'([^'\n]+)'|((?:(?:[A-Za-z]:[\\/])|(?:\/)|(?:~\/)|(?:\.{1,2}[\\/]))[^\s"'，。；;]+|[^\s"'，。；;\\/]+(?:[\\/][^\s"'，。；;]+)+|[^\s"'，。；;]+\.[A-Za-z0-9]{1,16}))/i;

type FileReadFieldKey =
  | "sourcePath"
  | "focus"
  | "length"
  | "style"
  | "outputFormat";

interface FileReadFieldMatch {
  key: FileReadFieldKey;
  start: number;
  valueStart: number;
  end: number;
}

interface ExtractedFileReadFields {
  sourcePath?: string;
  focus?: string;
  length?: SummaryLength;
  style?: string;
  outputFormat?: string;
  strippedText: string;
}

function normalizeTrigger(value: string): FileReadWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@read_file") {
    return "@read_file";
  }
  if (normalized === "@read file content") {
    return "@Read File Content";
  }
  return "@读文件";
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

function normalizeFilePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^['"]|['"]$/g, "").trim();
}

function looksLikeFilePath(value: string | undefined): boolean {
  const normalized = normalizeFilePath(value);
  if (!normalized) {
    return false;
  }

  return (
    /^([A-Za-z]:[\\/]|\/|~\/|\.{1,2}[\\/])/.test(normalized) ||
    /[\\/]/.test(normalized) ||
    /\.[A-Za-z0-9]{1,16}$/.test(normalized)
  );
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

function resolveFieldKey(matched: RegExpExecArray): FileReadFieldKey | null {
  if (matched[1]) {
    return "sourcePath";
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

function collectFieldMatches(text: string): FileReadFieldMatch[] {
  const baseMatches: Omit<FileReadFieldMatch, "end">[] = [];
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
  matches: FileReadFieldMatch[],
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

function extractFilePath(text: string): string | undefined {
  const matched = text.match(FILE_PATH_REGEX);
  const candidate = normalizeFilePath(
    matched?.[1] || matched?.[2] || matched?.[3],
  );

  return looksLikeFilePath(candidate) ? candidate : undefined;
}

function stripDetectedSource(text: string, sourcePath?: string): string {
  if (!sourcePath) {
    return text;
  }

  const escapedSource = escapeRegExp(sourcePath);
  return trimDecorations(
    text.replace(new RegExp(`(["'])?${escapedSource}\\1`, "gi"), " "),
  );
}

function extractFileReadFields(text: string): ExtractedFileReadFields {
  const matches = collectFieldMatches(text);
  const extracted: ExtractedFileReadFields = {
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

    if (match.key === "sourcePath") {
      const normalized = normalizeFilePath(rawValue);
      extracted.sourcePath =
        extracted.sourcePath || (looksLikeFilePath(normalized) ? normalized : rawValue);
      return;
    }

    extracted[match.key] = extracted[match.key] || rawValue;
  });

  const strippedWithoutFields = trimDecorations(
    stripExplicitFields(text, matches),
  );
  const detectedPath =
    extracted.sourcePath || extractFilePath(strippedWithoutFields);
  const strippedWithoutPath = stripDetectedSource(
    strippedWithoutFields,
    looksLikeFilePath(detectedPath) ? detectedPath : undefined,
  );

  return {
    sourcePath: looksLikeFilePath(detectedPath) ? detectedPath : extracted.sourcePath,
    focus: extracted.focus,
    length: extracted.length,
    style: extracted.style,
    outputFormat: extracted.outputFormat,
    strippedText: strippedWithoutPath,
  };
}

function stripPromptDecorations(text: string): string {
  return trimDecorations(text.replace(PROMPT_PREFIX_REGEX, ""));
}

export function parseFileReadWorkbenchCommand(
  text: string,
): ParsedFileReadWorkbenchCommand | null {
  const matched = text.match(FILE_READ_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const extracted = extractFileReadFields(body);
  const prompt = stripPromptDecorations(extracted.strippedText);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    sourcePath: extracted.sourcePath,
    focus: extracted.focus,
    length: extracted.length,
    style: extracted.style,
    outputFormat: extracted.outputFormat,
  };
}
