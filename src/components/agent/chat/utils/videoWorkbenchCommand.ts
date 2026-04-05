export type VideoWorkbenchCommandTrigger = "@视频" | "@video";

export interface ParsedVideoWorkbenchCommand {
  rawText: string;
  trigger: VideoWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  duration?: number;
  aspectRatio?: "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  resolution?: "480p" | "720p" | "1080p";
}

const VIDEO_COMMAND_PREFIX_REGEX = /^\s*(@视频|@video)(?:\s+|$)([\s\S]*)$/i;
const DURATION_REGEX =
  /(?:时长\s*)?(\d+)\s*(?:秒钟|秒|s)(?=[\s,，。；;:：]|$)/i;
const ASPECT_RATIO_REGEX = /(自适应|adaptive|16:9|9:16|1:1|4:3|3:4|21:9)/i;
const RESOLUTION_REGEX = /\b(480p|720p|1080p)\b/i;

function normalizeTrigger(value: string): VideoWorkbenchCommandTrigger {
  return value.trim().toLowerCase() === "@video" ? "@video" : "@视频";
}

function clampDuration(value: number | null | undefined): number | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function resolveAspectRatio(
  body: string,
): ParsedVideoWorkbenchCommand["aspectRatio"] {
  const value = body.match(ASPECT_RATIO_REGEX)?.[1]?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  if (value === "自适应" || value === "adaptive") {
    return "adaptive";
  }
  if (
    value === "16:9" ||
    value === "9:16" ||
    value === "1:1" ||
    value === "4:3" ||
    value === "3:4" ||
    value === "21:9"
  ) {
    return value;
  }
  return undefined;
}

function resolveResolution(
  body: string,
): ParsedVideoWorkbenchCommand["resolution"] {
  const value = body.match(RESOLUTION_REGEX)?.[1]?.trim().toLowerCase();
  if (value === "480p" || value === "720p" || value === "1080p") {
    return value;
  }
  return undefined;
}

function stripPromptDecorations(body: string): string {
  return body
    .replace(/^(生成|create|generate)(?:\s|$|[:：])*/i, "")
    .replace(DURATION_REGEX, "")
    .replace(ASPECT_RATIO_REGEX, "")
    .replace(RESOLUTION_REGEX, "")
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVideoWorkbenchCommand(
  text: string,
): ParsedVideoWorkbenchCommand | null {
  const matched = text.match(VIDEO_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: stripPromptDecorations(body),
    duration: clampDuration(
      Number.parseInt(body.match(DURATION_REGEX)?.[1] || "", 10),
    ),
    aspectRatio: resolveAspectRatio(body),
    resolution: resolveResolution(body),
  };
}
