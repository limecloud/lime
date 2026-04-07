export type FormWorkbenchCommandTrigger =
  | "@表单"
  | "@form"
  | "@survey"
  | "@问卷";

export type FormType =
  | "survey_form"
  | "lead_form"
  | "registration_form"
  | "feedback_form"
  | "application_form";

export interface ParsedFormWorkbenchCommand {
  rawText: string;
  trigger: FormWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  formType?: FormType;
  style?: string;
  audience?: string;
  fieldCount?: number;
}

const FORM_COMMAND_PREFIX_REGEX =
  /^\s*(@表单|@form|@survey|@问卷)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_FORM_TYPE_REGEX =
  /(?:类型|表单类型|type)\s*[:：=]?\s*(问卷表单|调查表单|线索表单|报名表单|反馈表单|申请表单|survey(?:\s+form)?|lead(?:\s+form)?|registration(?:\s+form)?|feedback(?:\s+form)?|application(?:\s+form)?)(?=$|[\s,，。；;:：])/i;
const LEADING_FORM_TYPE_REGEX =
  /^(问卷表单|调查表单|线索表单|报名表单|反馈表单|申请表单|survey(?:\s+form)?|lead(?:\s+form)?|registration(?:\s+form)?|feedback(?:\s+form)?|application(?:\s+form)?)(?=$|[\s,，。；;:：])/i;
const LEADING_EXPLICIT_FORM_TYPE_REGEX =
  /^(?:类型|表单类型|type)\s*[:：=]?\s*(问卷表单|调查表单|线索表单|报名表单|反馈表单|申请表单|survey(?:\s+form)?|lead(?:\s+form)?|registration(?:\s+form)?|feedback(?:\s+form)?|application(?:\s+form)?)(?=$|[\s,，。；;:：])/i;
const FORM_PROMPT_BOUNDARY_PATTERN =
  String.raw`(?:\s+(?:帮我|给我|请|生成|制作|设计|整理|输出|做一个|做个|create|generate|build|draft))`;
const LEADING_EXPLICIT_STYLE_REGEX = new RegExp(
  String.raw`^(?:风格|style)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:受众|对象|audience|字段数|题数|问题数|fields?|questions?|类型|表单类型|type)\s*[:：=]?)|${FORM_PROMPT_BOUNDARY_PATTERN})`,
  "i",
);
const LEADING_EXPLICIT_AUDIENCE_REGEX = new RegExp(
  String.raw`^(?:受众|对象|audience)\s*[:：=]?\s*(.+?)(?=$|[,，。；;\n]|(?:\s+(?:风格|style|字段数|题数|问题数|fields?|questions?|类型|表单类型|type)\s*[:：=]?)|${FORM_PROMPT_BOUNDARY_PATTERN})`,
  "i",
);
const LEADING_EXPLICIT_FIELD_COUNT_REGEX =
  /^(?:字段数|题数|问题数|fields?|questions?)\s*[:：=]?\s*(\d{1,2})/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(生成|制作|设计|整理|输出|做一个|做个|create|generate|build|draft)(?:\s|$|[:：])*/i;

function normalizeTrigger(value: string): FormWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@form") {
    return "@form";
  }
  if (normalized === "@survey") {
    return "@survey";
  }
  if (normalized === "@问卷") {
    return "@问卷";
  }
  return "@表单";
}

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function trimLeadingDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+/g, "").trimStart();
}

function normalizeFormType(value: string | undefined): FormType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "问卷表单" ||
    normalized === "调查表单" ||
    normalized === "survey" ||
    normalized === "survey form"
  ) {
    return "survey_form";
  }
  if (normalized === "线索表单" || normalized === "lead" || normalized === "lead form") {
    return "lead_form";
  }
  if (
    normalized === "报名表单" ||
    normalized === "registration" ||
    normalized === "registration form"
  ) {
    return "registration_form";
  }
  if (
    normalized === "反馈表单" ||
    normalized === "feedback" ||
    normalized === "feedback form"
  ) {
    return "feedback_form";
  }
  if (
    normalized === "申请表单" ||
    normalized === "application" ||
    normalized === "application form"
  ) {
    return "application_form";
  }
  return undefined;
}

function stripField(body: string, regex: RegExp): string {
  return body.replace(regex, " ");
}

function consumeLeadingFormFields(body: string): {
  formType?: FormType;
  style?: string;
  audience?: string;
  fieldCount?: number;
  promptBody: string;
} {
  let remaining = body.trim();
  let formType = normalizeFormType(remaining.match(LEADING_FORM_TYPE_REGEX)?.[1]?.trim());
  let style: string | undefined;
  let audience: string | undefined;
  let fieldCount: number | undefined;

  if (formType) {
    remaining = trimLeadingDecorations(stripField(remaining, LEADING_FORM_TYPE_REGEX));
  }

  while (remaining) {
    const explicitFormType = normalizeFormType(
      remaining.match(LEADING_EXPLICIT_FORM_TYPE_REGEX)?.[1]?.trim(),
    );
    if (explicitFormType) {
      formType = formType || explicitFormType;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_FORM_TYPE_REGEX),
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

    const fieldCountRaw =
      remaining.match(LEADING_EXPLICIT_FIELD_COUNT_REGEX)?.[1]?.trim();
    if (fieldCountRaw) {
      const parsedFieldCount = Number.parseInt(fieldCountRaw, 10);
      fieldCount =
        Number.isFinite(parsedFieldCount) && parsedFieldCount > 0
          ? Math.max(1, parsedFieldCount)
          : fieldCount;
      remaining = trimLeadingDecorations(
        stripField(remaining, LEADING_EXPLICIT_FIELD_COUNT_REGEX),
      );
      continue;
    }

    break;
  }

  return {
    formType,
    style,
    audience,
    fieldCount,
    promptBody: remaining,
  };
}

function stripPromptDecorations(body: string, formType?: string): string {
  const leadingFormTypeRegex = formType
    ? new RegExp(
        `^${formType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimDecorations(
    body
      .replace(leadingFormTypeRegex, "")
      .replace(PROMPT_PREFIX_REGEX, "")
      .replace(/\s+/g, " "),
  );
}

export function parseFormWorkbenchCommand(
  text: string,
): ParsedFormWorkbenchCommand | null {
  const matched = text.match(FORM_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const { formType, style, audience, fieldCount, promptBody } =
    consumeLeadingFormFields(body);
  const explicitFormType = body.match(EXPLICIT_FORM_TYPE_REGEX)?.[1]?.trim();
  const leadingFormType = body.match(LEADING_FORM_TYPE_REGEX)?.[1]?.trim();
  const prompt = stripPromptDecorations(
    promptBody,
    explicitFormType || leadingFormType,
  );

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    formType,
    style: style || undefined,
    audience: audience || undefined,
    fieldCount,
  };
}
