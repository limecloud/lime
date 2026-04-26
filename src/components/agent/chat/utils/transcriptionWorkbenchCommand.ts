export type TranscriptionWorkbenchCommandTrigger =
  | "@转写"
  | "@transcribe"
  | "@Audio Extractor";

export interface ParsedTranscriptionWorkbenchCommand {
  rawText: string;
  trigger: TranscriptionWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  sourceUrl?: string;
  sourcePath?: string;
  language?: string;
  outputFormat?: "txt" | "srt" | "vtt" | "markdown" | "json";
  speakerLabels?: boolean;
  timestamps?: boolean;
}

const TRANSCRIPTION_COMMAND_PREFIX_REGEX =
  /^\s*(@转写|@transcribe|@Audio Extractor)(?:\s+|$)([\s\S]*)$/i;
const SOURCE_URL_REGEX = /https?:\/\/[^\s"'，。；;]+/i;
const QUOTED_SOURCE_PATH_REGEX =
  /(["'])([^"'\n]+\.(?:wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|m4v|avi|mkv|webm))\1/i;
const WINDOWS_SOURCE_PATH_REGEX =
  /([a-zA-Z]:\\[^\s"'，。；;]+\.(?:wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|m4v|avi|mkv|webm))/i;
const UNIX_SOURCE_PATH_REGEX =
  /((?:\.{1,2}\/|\/)[^\s"'，。；;]+\.(?:wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|m4v|avi|mkv|webm))/i;
const RELATIVE_SOURCE_PATH_REGEX =
  /(^|[\s(])((?:[^/\\\s"'，。；;]+\/)*[^/\\\s"'，。；;]+\.(?:wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|m4v|avi|mkv|webm))(?=$|[\s),，。；;])/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(转写|transcribe|生成|导出|请帮我|请把)(?:\s|$|[:：])*/i;
const LANGUAGE_REGEX =
  /(?:语言|lang|language)\s*[:：=]?\s*(自动|auto|中文|英文|中英混合|zh(?:-[a-z]+)?|en(?:-[a-z]+)?)/i;
const OUTPUT_FORMAT_REGEX =
  /(?:输出格式|格式|format|output(?:[_\s-]?format)?)\s*[:：=]?\s*(txt|text|srt|vtt|markdown|md|json)/i;
const EXPORT_OUTPUT_FORMAT_REGEX =
  /(?:导出(?:为)?|输出(?:为)?|生成|export|output)\s*(txt|text|srt|vtt|markdown|md|json)(?:字幕|稿|文件)?/i;
const SPEAKER_LABELS_NEGATIVE_REGEX =
  /(?:不区分说话人|无需区分说话人|不要区分说话人|no\s+speaker\s+labels)/i;
const SPEAKER_LABELS_REGEX =
  /(?:区分说话人|说话人分离|分角色|speaker(?:[_\s-]?labels)?|speaker diarization)/i;
const TIMESTAMPS_NEGATIVE_REGEX = /(?:不要时间戳|无需时间戳|no\s+timestamps?)/i;
const TIMESTAMPS_REGEX = /(?:带?时间戳|timestamps?|字幕时间轴)/i;

function normalizeTrigger(value: string): TranscriptionWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@audio extractor") {
    return "@Audio Extractor";
  }
  return normalized === "@transcribe" ? "@transcribe" : "@转写";
}

function normalizeOutputFormat(
  value: string | undefined,
): ParsedTranscriptionWorkbenchCommand["outputFormat"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "txt" || normalized === "text") {
    return "txt";
  }
  if (normalized === "srt" || normalized === "vtt" || normalized === "json") {
    return normalized;
  }
  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }
  return undefined;
}

function extractSourceUrl(body: string): string | undefined {
  return body.match(SOURCE_URL_REGEX)?.[0]?.trim();
}

function extractSourcePath(body: string): string | undefined {
  return (
    body.match(QUOTED_SOURCE_PATH_REGEX)?.[2] ||
    body.match(WINDOWS_SOURCE_PATH_REGEX)?.[1] ||
    body.match(UNIX_SOURCE_PATH_REGEX)?.[1] ||
    body.match(RELATIVE_SOURCE_PATH_REGEX)?.[2]
  )?.trim();
}

function stripPromptDecorations(
  body: string,
  sourceUrl?: string,
  sourcePath?: string,
): string {
  return body
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(SOURCE_URL_REGEX, "")
    .replace(QUOTED_SOURCE_PATH_REGEX, "")
    .replace(WINDOWS_SOURCE_PATH_REGEX, "")
    .replace(UNIX_SOURCE_PATH_REGEX, "")
    .replace(RELATIVE_SOURCE_PATH_REGEX, "$1")
    .replace(PROMPT_PREFIX_REGEX, "")
    .replace(LANGUAGE_REGEX, "")
    .replace(OUTPUT_FORMAT_REGEX, "")
    .replace(EXPORT_OUTPUT_FORMAT_REGEX, "")
    .replace(SPEAKER_LABELS_NEGATIVE_REGEX, "")
    .replace(SPEAKER_LABELS_REGEX, "")
    .replace(TIMESTAMPS_NEGATIVE_REGEX, "")
    .replace(TIMESTAMPS_REGEX, "")
    .replace(
      sourceUrl
        ? new RegExp(sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
        : /^$/,
      "",
    )
    .replace(
      sourcePath
        ? new RegExp(sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
        : /^$/,
      "",
    )
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTranscriptionWorkbenchCommand(
  text: string,
): ParsedTranscriptionWorkbenchCommand | null {
  const matched = text.match(TRANSCRIPTION_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const sourceUrl = extractSourceUrl(body);
  const sourcePath = sourceUrl ? undefined : extractSourcePath(body);
  const outputFormat = normalizeOutputFormat(
    body.match(OUTPUT_FORMAT_REGEX)?.[1] ||
      body.match(EXPORT_OUTPUT_FORMAT_REGEX)?.[1],
  );
  const speakerLabels = SPEAKER_LABELS_NEGATIVE_REGEX.test(body)
    ? false
    : SPEAKER_LABELS_REGEX.test(body)
      ? true
      : undefined;
  const timestamps = TIMESTAMPS_NEGATIVE_REGEX.test(body)
    ? false
    : TIMESTAMPS_REGEX.test(body)
      ? true
      : undefined;

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: stripPromptDecorations(body, sourceUrl, sourcePath),
    sourceUrl,
    sourcePath,
    language: body.match(LANGUAGE_REGEX)?.[1]?.trim(),
    outputFormat,
    speakerLabels,
    timestamps,
  };
}
