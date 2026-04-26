export type ImageWorkbenchCommandTrigger =
  | "@配图"
  | "@分镜"
  | "@修图"
  | "@重绘"
  | "@Vision 1"
  | "@image"
  | "/image";

export type ImageWorkbenchCommandMode = "generate" | "edit" | "variation";

const MAX_IMAGE_WORKBENCH_COUNT = 16;
const STORYBOARD_3X3_REGEX =
  /(?:\b3\s*[x×*]\s*3\b|九宫格|storyboard)(?:\s*(?:分镜(?:板|版)?|网格图))?/i;

export interface ParsedImageWorkbenchCommand {
  rawText: string;
  trigger: ImageWorkbenchCommandTrigger;
  body: string;
  mode: ImageWorkbenchCommandMode;
  prompt: string;
  count: number;
  layoutHint?: string;
  size?: string;
  aspectRatio?: string;
  targetRef?: string;
}

const IMAGE_COMMAND_PREFIX_REGEX =
  /^\s*(@配图|@分镜|@修图|@重绘|@Vision 1|@image|\/image)(?:\s+|$)([\s\S]*)$/i;
const TARGET_REF_REGEX = /#(img-[a-z0-9_-]+)/i;
const SIZE_REGEX = /\b(\d{3,4}x\d{3,4})\b/i;
const ASPECT_RATIO_REGEX = /\b(1:1|16:9|9:16|4:3|3:4|3:2|2:3|21:9|4:5|5:4)\b/i;

function normalizeTrigger(value: string): ImageWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@image") {
    return "@image";
  }
  if (normalized === "/image") {
    return "/image";
  }
  if (normalized === "@vision 1") {
    return "@Vision 1";
  }
  if (normalized === "@分镜") {
    return "@分镜";
  }
  if (normalized === "@修图") {
    return "@修图";
  }
  if (normalized === "@重绘") {
    return "@重绘";
  }
  return "@配图";
}

function isStoryboardCommandTrigger(
  trigger: ImageWorkbenchCommandTrigger,
): boolean {
  return trigger === "@分镜";
}

function clampCount(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.min(MAX_IMAGE_WORKBENCH_COUNT, Math.trunc(value)));
}

function extractExplicitCount(body: string): number | undefined {
  const patterns = [
    /(?:出|生成|要)\s*(\d+)\s*张/i,
    /(\d+)\s*张/i,
    /\bx\s*(\d+)\b/i,
  ];

  for (const pattern of patterns) {
    const matched = body.match(pattern);
    if (matched) {
      return clampCount(Number.parseInt(matched[1] || "", 10));
    }
  }

  return undefined;
}

function resolveLayoutHint(params: {
  trigger: ImageWorkbenchCommandTrigger;
  body: string;
  explicitCount?: number;
}): string | undefined {
  if (STORYBOARD_3X3_REGEX.test(params.body)) {
    return "storyboard_3x3";
  }

  if (
    isStoryboardCommandTrigger(params.trigger) &&
    (params.explicitCount == null || params.explicitCount === 9)
  ) {
    return "storyboard_3x3";
  }

  return undefined;
}

function extractCount(params: {
  trigger: ImageWorkbenchCommandTrigger;
  explicitCount?: number;
  layoutHint?: string;
}): number {
  const { trigger, explicitCount, layoutHint } = params;
  if (layoutHint === "storyboard_3x3") {
    return 9;
  }

  if (explicitCount != null) {
    return explicitCount;
  }

  return isStoryboardCommandTrigger(trigger) ? 9 : 1;
}

function resolveMode(
  trigger: ImageWorkbenchCommandTrigger,
  normalizedBody: string,
  targetRef?: string,
): ImageWorkbenchCommandMode {
  if (trigger === "@修图") {
    return "edit";
  }
  if (trigger === "@重绘") {
    return "variation";
  }
  if (/^(编辑|edit|修改)(?:\s|$|[:：])/i.test(normalizedBody)) {
    return "edit";
  }
  if (/^(重绘|变体|variation|variant)(?:\s|$|[:：])/i.test(normalizedBody)) {
    return "variation";
  }
  if (/^(生成|create|generate)(?:\s|$|[:：])/i.test(normalizedBody)) {
    return "generate";
  }
  return targetRef ? "variation" : "generate";
}

function stripPromptDecorations(body: string, layoutHint?: string): string {
  const normalizedBody = layoutHint
    ? body
        .replace(
          /(?:\b3\s*[x×*]\s*3\b|九宫格|storyboard)(?:\s*(?:分镜(?:板|版)?|网格图))?/gi,
          "",
        )
        .replace(/\b分镜(?:板|版)?\b/gi, "")
    : body;

  return normalizedBody
    .replace(/^(生成|create|generate)(?:\s|$|[:：])*/i, "")
    .replace(/^(编辑|edit|修改)(?:\s|$|[:：])*/i, "")
    .replace(/^(重绘|变体|variation|variant)(?:\s|$|[:：])*/i, "")
    .replace(TARGET_REF_REGEX, "")
    .replace(/(?:出|生成|要)\s*\d+\s*张/gi, "")
    .replace(/\d+\s*张/gi, "")
    .replace(/\bx\s*\d+\b/gi, "")
    .replace(SIZE_REGEX, "")
    .replace(ASPECT_RATIO_REGEX, "")
    .replace(/[，,]\s*[，,]+/g, "，")
    .replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSize(body: string): { size?: string; aspectRatio?: string } {
  const explicitSize = body.match(SIZE_REGEX)?.[1];
  if (explicitSize) {
    return { size: explicitSize };
  }

  const aspectRatio = body.match(ASPECT_RATIO_REGEX)?.[1];
  if (!aspectRatio) {
    return {};
  }

  const mappedSizes: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "21:9": "1792x1024",
    "4:3": "1152x864",
    "3:2": "1344x768",
    "5:4": "1152x864",
    "9:16": "1024x1792",
    "3:4": "864x1152",
    "2:3": "768x1344",
    "4:5": "864x1152",
  };

  return {
    size: mappedSizes[aspectRatio],
    aspectRatio,
  };
}

export function parseImageWorkbenchCommand(
  text: string,
): ParsedImageWorkbenchCommand | null {
  const matched = text.match(IMAGE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const trigger = normalizeTrigger(matched[1] || "");
  const body = (matched[2] || "").trim();
  const targetRef = body.match(TARGET_REF_REGEX)?.[1];
  const normalizedBody = body.trim();
  const mode = resolveMode(trigger, normalizedBody, targetRef);
  const explicitCount = extractExplicitCount(normalizedBody);
  const layoutHint = resolveLayoutHint({
    trigger,
    body: normalizedBody,
    explicitCount,
  });
  const { size, aspectRatio } = resolveSize(normalizedBody);

  return {
    rawText: text,
    trigger,
    body,
    mode,
    prompt: stripPromptDecorations(normalizedBody, layoutHint),
    count: extractCount({
      trigger,
      explicitCount,
      layoutHint,
    }),
    layoutHint,
    size,
    aspectRatio,
    targetRef,
  };
}

export function shouldRouteImageWorkbenchCommandToSkill(input: {
  parsedCommand: ParsedImageWorkbenchCommand;
  attachedImageCount?: number;
}): boolean {
  const { parsedCommand, attachedImageCount = 0 } = input;
  return (
    parsedCommand.trigger !== "@修图" &&
    parsedCommand.mode === "generate" &&
    !parsedCommand.targetRef &&
    attachedImageCount === 0
  );
}

export function buildImageGenerateSkillSlashCommand(
  parsedCommand: ParsedImageWorkbenchCommand,
): string {
  const normalizedBody = parsedCommand.body.trim();
  if (!normalizedBody) {
    return "/image_generate";
  }
  if (
    parsedCommand.mode === "edit" &&
    !/^(编辑|edit|修改)(?:\s|$|[:：])/i.test(normalizedBody)
  ) {
    return `/image_generate 编辑 ${normalizedBody}`;
  }
  if (
    parsedCommand.mode === "variation" &&
    !/^(重绘|变体|variation|variant)(?:\s|$|[:：])/i.test(normalizedBody)
  ) {
    return `/image_generate 重绘 ${normalizedBody}`;
  }
  return `/image_generate ${normalizedBody}`;
}
