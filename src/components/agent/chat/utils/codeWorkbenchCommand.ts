export type CodeWorkbenchCommandTrigger =
  | "@代码"
  | "@code"
  | "@coding"
  | "@开发";

export type CodeWorkbenchTaskType =
  | "code_review"
  | "bug_fix"
  | "implementation"
  | "refactor"
  | "explain";

export interface ParsedCodeWorkbenchCommand {
  rawText: string;
  trigger: CodeWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  taskType?: CodeWorkbenchTaskType;
}

const CODE_COMMAND_PREFIX_REGEX =
  /^\s*(@代码|@code|@coding|@开发)(?:\s+|$)([\s\S]*)$/i;
const EXPLICIT_TASK_TYPE_REGEX =
  /(?:类型|任务|任务类型|type|task|kind|模式|mode)\s*[:：=]?\s*(代码评审|代码审查|code(?:\s+review)?|review|修复|修\s*bug|bug(?:\s+fix)?|fix(?:\s+bug)?|debug|实现|开发|implementation|implement|build|重构|refactor|解释|讲解|说明|分析代码|explain)(?=$|[\s,，。；;:：])/i;
const LEADING_TASK_TYPE_REGEX =
  /^(代码评审|代码审查|code(?:\s+review)?|review|修复|修\s*bug|bug(?:\s+fix)?|fix(?:\s+bug)?|debug|实现|开发|implementation|implement|build|重构|refactor|解释|讲解|说明|分析代码|explain)(?=$|[\s,，。；;:：])/i;

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function normalizeTrigger(value: string): CodeWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@code") {
    return "@code";
  }
  if (normalized === "@coding") {
    return "@coding";
  }
  if (normalized === "@开发") {
    return "@开发";
  }
  return "@代码";
}

function normalizeTaskType(
  value: string | undefined,
): CodeWorkbenchTaskType | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "代码评审" ||
    normalized === "代码审查" ||
    normalized === "code review" ||
    normalized === "code" ||
    normalized === "review"
  ) {
    return "code_review";
  }
  if (
    normalized === "修复" ||
    normalized === "修 bug" ||
    normalized === "修bug" ||
    normalized === "bug fix" ||
    normalized === "bug" ||
    normalized === "fix bug" ||
    normalized === "debug"
  ) {
    return "bug_fix";
  }
  if (
    normalized === "实现" ||
    normalized === "开发" ||
    normalized === "implementation" ||
    normalized === "implement" ||
    normalized === "build"
  ) {
    return "implementation";
  }
  if (normalized === "重构" || normalized === "refactor") {
    return "refactor";
  }
  if (
    normalized === "解释" ||
    normalized === "讲解" ||
    normalized === "说明" ||
    normalized === "分析代码" ||
    normalized === "explain"
  ) {
    return "explain";
  }
  return undefined;
}

function inferTaskType(body: string): CodeWorkbenchTaskType | undefined {
  const normalized = body.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    /(?:代码评审|代码审查|code\s+review|\breview\b)/i.test(normalized)
  ) {
    return "code_review";
  }
  if (/(?:修复|修\s*bug|bug\s+fix|fix\s+bug|\bdebug\b|\bbug\b)/i.test(normalized)) {
    return "bug_fix";
  }
  if (/(?:重构|\brefactor\b)/i.test(normalized)) {
    return "refactor";
  }
  if (/(?:解释|讲解|说明|分析代码|\bexplain\b)/i.test(normalized)) {
    return "explain";
  }
  if (
    /(?:实现|开发|\bimplementation\b|\bimplement\b|\bbuild\b)/i.test(
      normalized,
    )
  ) {
    return "implementation";
  }
  return undefined;
}

function stripPromptDecorations(body: string, leadingTaskType?: string): string {
  const leadingTaskTypeRegex = leadingTaskType
    ? new RegExp(
        `^${leadingTaskType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,，。；;:：])`,
        "i",
      )
    : /^$/;

  return trimDecorations(
    body
      .replace(EXPLICIT_TASK_TYPE_REGEX, " ")
      .trimStart()
      .replace(leadingTaskTypeRegex, "")
      .replace(/\s+/g, " "),
  );
}

export function parseCodeWorkbenchCommand(
  text: string,
): ParsedCodeWorkbenchCommand | null {
  const matched = text.match(CODE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const explicitTaskType = body.match(EXPLICIT_TASK_TYPE_REGEX)?.[1]?.trim();
  const leadingTaskType = body.match(LEADING_TASK_TYPE_REGEX)?.[1]?.trim();
  const taskType =
    normalizeTaskType(explicitTaskType || leadingTaskType) || inferTaskType(body);
  const prompt = stripPromptDecorations(body, explicitTaskType || leadingTaskType);

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt: prompt || body,
    taskType,
  };
}
