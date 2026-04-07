export type WebpageWorkbenchCommandTrigger =
  | "@网页"
  | "@webpage"
  | "@landing";

export type WebpageType =
  | "landing_page"
  | "homepage"
  | "campaign_page"
  | "product_page"
  | "docs_page"
  | "portfolio"
  | "resume_page";

export interface ParsedWebpageWorkbenchCommand {
  rawText: string;
  trigger: WebpageWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  pageType?: WebpageType;
  style?: string;
  techStack?: string;
}

const WEBPAGE_COMMAND_PREFIX_REGEX =
  /^\s*(@网页|@webpage|@landing)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_PAGE_TYPE_REGEX =
  /(?:类型|页面类型|type)\s*[:：=]?\s*(落地页|landing(?:\s+page)?|官网|首页|home(?:\s+page)?|活动页|campaign(?:\s+page)?|产品页|product(?:\s+page)?|文档页|docs?(?:\s+page)?|作品集|portfolio|简历页|resume(?:\s+page)?)(?=$|[\s,，。；;:：])/i;
const LEADING_PAGE_TYPE_REGEX =
  /^(落地页|landing(?:\s+page)?|官网|首页|home(?:\s+page)?|活动页|campaign(?:\s+page)?|产品页|product(?:\s+page)?|文档页|docs?(?:\s+page)?|作品集|portfolio|简历页|resume(?:\s+page)?)(?=$|[\s,，。；;:：])/i;
const PROMPT_BOUNDARY_PATTERN =
  String.raw`(?:\s+(?:帮我|给我|请|生成|制作|搭建|做一个|做个|create|generate|build))`;
const EXPLICIT_STYLE_REGEX =
  new RegExp(
    String.raw`(?:风格|style)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:技术|栈|tech|stack|framework|类型|页面类型|type)\s*[:：=]?)|${PROMPT_BOUNDARY_PATTERN})`,
    "i",
  );
const EXPLICIT_TECH_STACK_REGEX =
  new RegExp(
    String.raw`(?:技术|栈|tech|stack|framework)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:风格|style|类型|页面类型|type)\s*[:：=]?)|${PROMPT_BOUNDARY_PATTERN})`,
    "i",
  );
const PROMPT_PREFIX_REGEX =
  /^\s*(生成|制作|搭建|做一个|做个|create|generate|build)(?:\s|$|[:：])*/i;

function normalizeTrigger(value: string): WebpageWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@webpage") {
    return "@webpage";
  }
  if (normalized === "@landing") {
    return "@landing";
  }
  return "@网页";
}

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function normalizePageType(value: string | undefined): WebpageType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "落地页" || normalized === "landing page" || normalized === "landing") {
    return "landing_page";
  }
  if (
    normalized === "官网" ||
    normalized === "首页" ||
    normalized === "home page" ||
    normalized === "homepage" ||
    normalized === "home"
  ) {
    return "homepage";
  }
  if (
    normalized === "活动页" ||
    normalized === "campaign" ||
    normalized === "campaign page"
  ) {
    return "campaign_page";
  }
  if (
    normalized === "产品页" ||
    normalized === "product" ||
    normalized === "product page"
  ) {
    return "product_page";
  }
  if (
    normalized === "文档页" ||
    normalized === "docs" ||
    normalized === "doc" ||
    normalized === "docs page" ||
    normalized === "doc page"
  ) {
    return "docs_page";
  }
  if (normalized === "作品集" || normalized === "portfolio") {
    return "portfolio";
  }
  if (
    normalized === "简历页" ||
    normalized === "resume" ||
    normalized === "resume page"
  ) {
    return "resume_page";
  }
  return undefined;
}

function stripField(body: string, regex: RegExp): string {
  return body.replace(regex, " ");
}

function stripPromptDecorations(body: string, pageType?: string): string {
  const leadingPageTypeRegex = pageType
    ? new RegExp(
        `^${pageType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimDecorations(
    stripField(
      stripField(
        stripField(
          body.replace(leadingPageTypeRegex, "").replace(PROMPT_PREFIX_REGEX, ""),
          EXPLICIT_PAGE_TYPE_REGEX,
        ),
        EXPLICIT_STYLE_REGEX,
      ),
      EXPLICIT_TECH_STACK_REGEX,
    )
      .replace(PROMPT_PREFIX_REGEX, "")
      .replace(/\s+/g, " "),
  );
}

export function parseWebpageWorkbenchCommand(
  text: string,
): ParsedWebpageWorkbenchCommand | null {
  const matched = text.match(WEBPAGE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const explicitPageType = body.match(EXPLICIT_PAGE_TYPE_REGEX)?.[1]?.trim();
  const leadingPageType = body.match(LEADING_PAGE_TYPE_REGEX)?.[1]?.trim();
  const pageType = normalizePageType(explicitPageType || leadingPageType);
  const style = trimDecorations(body.match(EXPLICIT_STYLE_REGEX)?.[1] || "");
  const techStack = trimDecorations(body.match(EXPLICIT_TECH_STACK_REGEX)?.[1] || "");
  const prompt = stripPromptDecorations(body, explicitPageType || leadingPageType);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    pageType,
    style: style || undefined,
    techStack: techStack || undefined,
  };
}
