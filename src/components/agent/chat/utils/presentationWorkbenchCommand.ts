export type PresentationWorkbenchCommandTrigger =
  | "@PPT"
  | "@ppt"
  | "@slides"
  | "@演示";

export type PresentationDeckType =
  | "pitch_deck"
  | "sales_deck"
  | "training_deck"
  | "report_deck"
  | "proposal_deck";

export interface ParsedPresentationWorkbenchCommand {
  rawText: string;
  trigger: PresentationWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  deckType?: PresentationDeckType;
  style?: string;
  audience?: string;
  slideCount?: number;
}

const PRESENTATION_COMMAND_PREFIX_REGEX =
  /^\s*(@PPT|@ppt|@slides|@演示)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_DECK_TYPE_REGEX =
  /(?:类型|演示类型|type)\s*[:：=]?\s*(路演PPT|融资PPT|销售PPT|培训PPT|汇报PPT|方案PPT|pitch(?:\s+deck)?|sales(?:\s+deck)?|training(?:\s+deck)?|report(?:\s+deck)?|proposal(?:\s+deck)?)(?=$|[\s,，。；;:：])/i;
const LEADING_DECK_TYPE_REGEX =
  /^(路演PPT|融资PPT|销售PPT|培训PPT|汇报PPT|方案PPT|pitch(?:\s+deck)?|sales(?:\s+deck)?|training(?:\s+deck)?|report(?:\s+deck)?|proposal(?:\s+deck)?)(?=$|[\s,，。；;:：])/i;
const LEADING_EXPLICIT_DECK_TYPE_REGEX =
  /^(?:类型|演示类型|type)\s*[:：=]?\s*(路演PPT|融资PPT|销售PPT|培训PPT|汇报PPT|方案PPT|pitch(?:\s+deck)?|sales(?:\s+deck)?|training(?:\s+deck)?|report(?:\s+deck)?|proposal(?:\s+deck)?)(?=$|[\s,，。；;:：])/i;
const PRESENTATION_PROMPT_BOUNDARY_PATTERN = String.raw`(?:\s+(?:帮我|给我|请|生成|制作|整理|输出|做一个|做个|create|generate|build|draft))`;
const LEADING_EXPLICIT_STYLE_REGEX = new RegExp(
  String.raw`^(?:风格|style)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:受众|对象|audience|页数|页|slides?|类型|演示类型|type)\s*[:：=]?)|${PRESENTATION_PROMPT_BOUNDARY_PATTERN})`,
  "i",
);
const LEADING_EXPLICIT_AUDIENCE_REGEX = new RegExp(
  String.raw`^(?:受众|对象|audience)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:风格|style|页数|页|slides?|类型|演示类型|type)\s*[:：=]?)|${PRESENTATION_PROMPT_BOUNDARY_PATTERN})`,
  "i",
);
const LEADING_EXPLICIT_SLIDE_COUNT_REGEX =
  /^(?:页数|页|slides?)\s*[:：=]?\s*(\d{1,2})/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(生成|制作|整理|输出|做一个|做个|create|generate|build|draft)(?:\s|$|[:：])*/i;

function normalizeTrigger(value: string): PresentationWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@ppt") {
    return "@PPT";
  }
  if (normalized === "@slides") {
    return "@slides";
  }
  if (normalized === "@演示") {
    return "@演示";
  }
  return "@PPT";
}

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function trimLeadingDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+/g, "").trimStart();
}

function normalizeDeckType(
  value: string | undefined,
): PresentationDeckType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "路演ppt" ||
    normalized === "融资ppt" ||
    normalized === "pitch" ||
    normalized === "pitch deck"
  ) {
    return "pitch_deck";
  }
  if (
    normalized === "销售ppt" ||
    normalized === "sales" ||
    normalized === "sales deck"
  ) {
    return "sales_deck";
  }
  if (
    normalized === "培训ppt" ||
    normalized === "training" ||
    normalized === "training deck"
  ) {
    return "training_deck";
  }
  if (
    normalized === "汇报ppt" ||
    normalized === "report" ||
    normalized === "report deck"
  ) {
    return "report_deck";
  }
  if (
    normalized === "方案ppt" ||
    normalized === "proposal" ||
    normalized === "proposal deck"
  ) {
    return "proposal_deck";
  }
  return undefined;
}

function stripField(body: string, regex: RegExp): string {
  return body.replace(regex, " ");
}

function consumeLeadingPresentationFields(body: string): {
  deckType?: PresentationDeckType;
  style?: string;
  audience?: string;
  slideCount?: number;
  promptBody: string;
} {
  let remaining = body.trim();
  let deckType = normalizeDeckType(
    remaining.match(LEADING_DECK_TYPE_REGEX)?.[1]?.trim(),
  );
  let style: string | undefined;
  let audience: string | undefined;
  let slideCount: number | undefined;

  if (deckType) {
    remaining = trimLeadingDecorations(
      stripField(remaining, LEADING_DECK_TYPE_REGEX),
    );
  }

  while (remaining) {
    const explicitDeckType = normalizeDeckType(
      remaining.match(LEADING_EXPLICIT_DECK_TYPE_REGEX)?.[1]?.trim(),
    );
    if (explicitDeckType) {
      deckType = deckType || explicitDeckType;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_DECK_TYPE_REGEX),
      );
      continue;
    }

    const explicitStyle = trimDecorations(
      remaining.match(LEADING_EXPLICIT_STYLE_REGEX)?.[1] || "",
    );
    if (explicitStyle) {
      style = style || explicitStyle;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_STYLE_REGEX),
      );
      continue;
    }

    const explicitAudience = trimDecorations(
      remaining.match(LEADING_EXPLICIT_AUDIENCE_REGEX)?.[1] || "",
    );
    if (explicitAudience) {
      audience = audience || explicitAudience;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_AUDIENCE_REGEX),
      );
      continue;
    }

    const slideCountRaw = remaining
      .match(LEADING_EXPLICIT_SLIDE_COUNT_REGEX)?.[1]
      ?.trim();
    if (slideCountRaw) {
      const parsedSlideCount = Number.parseInt(slideCountRaw, 10);
      slideCount =
        Number.isFinite(parsedSlideCount) && parsedSlideCount > 0
          ? Math.max(1, parsedSlideCount)
          : slideCount;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_SLIDE_COUNT_REGEX),
      );
      continue;
    }

    break;
  }

  return {
    deckType,
    style,
    audience,
    slideCount,
    promptBody: remaining,
  };
}

function stripPromptDecorations(body: string, deckType?: string): string {
  const leadingDeckTypeRegex = deckType
    ? new RegExp(
        `^${deckType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimDecorations(
    body
      .replace(leadingDeckTypeRegex, "")
      .replace(PROMPT_PREFIX_REGEX, "")
      .replace(/\s+/g, " "),
  );
}

export function parsePresentationWorkbenchCommand(
  text: string,
): ParsedPresentationWorkbenchCommand | null {
  const matched = text.match(PRESENTATION_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const { deckType, style, audience, slideCount, promptBody } =
    consumeLeadingPresentationFields(body);
  const explicitDeckType = body.match(EXPLICIT_DECK_TYPE_REGEX)?.[1]?.trim();
  const leadingDeckType = body.match(LEADING_DECK_TYPE_REGEX)?.[1]?.trim();
  const prompt = stripPromptDecorations(
    promptBody,
    explicitDeckType || leadingDeckType,
  );

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    deckType,
    style: style || undefined,
    audience: audience || undefined,
    slideCount,
  };
}
