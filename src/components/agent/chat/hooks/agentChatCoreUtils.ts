import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { ActionRequired, ContentPart, Question } from "../types";

export const WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE =
  "workspace_path_auto_created";
export const LIME_TOOL_METADATA_BEGIN = "[Lime 工具元数据开始]";
export const LIME_TOOL_METADATA_END = "[Lime 工具元数据结束]";
export const ASK_USER_QUESTIONS_SCHEMA_KEY = "x-lime-ask-user-questions";

export const normalizeExecutionStrategy = (
  value?: string | null,
): AsterExecutionStrategy =>
  value === "code_orchestrated" || value === "auto" ? value : "react";

export const normalizeActionType = (
  value?: string,
): ActionRequired["actionType"] | null => {
  if (
    value === "tool_confirmation" ||
    value === "ask_user" ||
    value === "elicitation"
  ) {
    return value;
  }
  if (value === "ask") {
    return "ask_user";
  }
  return null;
};

export const isWorkspacePathErrorMessage = (message: string): boolean => {
  return (
    message.includes("Workspace 路径不存在") ||
    message.includes("Workspace 路径不是目录") ||
    message.includes("Workspace 路径存在但不是目录") ||
    message.includes("工作区目录缺失") ||
    message.includes("workspace path")
  );
};

export const appendActionRequiredToParts = (
  parts: ContentPart[],
  actionRequired: ActionRequired,
): ContentPart[] => {
  const exists = parts.some(
    (part) =>
      part.type === "action_required" &&
      part.actionRequired.requestId === actionRequired.requestId,
  );

  if (exists) {
    return parts;
  }

  return [...parts, { type: "action_required", actionRequired }];
};

export const parseJsonObject = (
  raw?: string,
): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
};

export const isAskToolName = (toolName: string): boolean => {
  const normalized = toolName.toLowerCase().trim();
  return (
    normalized === "askuserquestion" ||
    normalized === "request_user_input" ||
    normalized === "requestuserinput" ||
    normalized === "ask" ||
    normalized === "ask_user" ||
    /(^|[_-])ask($|[_-])/.test(normalized)
  );
};

export const normalizeAskOptions = (
  value: unknown,
): Array<{ label: string; description?: string }> | undefined => {
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item) => {
      if (typeof item === "string") {
        const label = item.trim();
        return label ? { label } : null;
      }
      if (item && typeof item === "object") {
        const candidate = item as Record<string, unknown>;
        const label =
          (typeof candidate.label === "string" && candidate.label.trim()) ||
          (typeof candidate.value === "string" && candidate.value.trim()) ||
          "";
        if (!label) return null;
        const description =
          typeof candidate.description === "string"
            ? candidate.description
            : undefined;
        return { label, description };
      }
      return null;
    })
    .filter(
      (item): item is { label: string; description?: string } => item !== null,
    );

  return normalized.length > 0 ? normalized : undefined;
};

export const normalizeActionQuestions = (
  value: unknown,
  fallbackQuestion?: string,
): ActionRequired["questions"] | undefined => {
  const toQuestion = (item: unknown): Question | null => {
    if (typeof item === "string") {
      const question = item.trim();
      if (!question) return null;
      return {
        question,
        multiSelect: false,
      };
    }

    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const questionCandidate = [
      record.question,
      record.prompt,
      record.message,
      record.text,
      record.title,
    ].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    );

    if (!questionCandidate) return null;

    const options = normalizeAskOptions(
      record.options || record.choices || record.enum,
    );
    const header =
      typeof record.header === "string" ? record.header : undefined;
    const multiSelect =
      record.multiSelect === true || record.multi_select === true;

    return {
      question: questionCandidate.trim(),
      header,
      options,
      multiSelect,
    };
  };

  const normalized = Array.isArray(value)
    ? value.map(toQuestion).filter((item): item is Question => item !== null)
    : [];

  if (normalized.length > 0) return normalized;

  if (typeof fallbackQuestion === "string" && fallbackQuestion.trim()) {
    return [
      {
        question: fallbackQuestion.trim(),
        multiSelect: false,
      },
    ];
  }

  return undefined;
};

export const extractQuestionsFromRequestedSchema = (
  value: unknown,
): ActionRequired["questions"] | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const schema = value as Record<string, unknown>;
  return normalizeActionQuestions(schema[ASK_USER_QUESTIONS_SCHEMA_KEY]);
};

export const resolveAskQuestionText = (
  args: Record<string, unknown>,
): string | undefined => {
  const candidates = [
    args.question,
    args.prompt,
    args.message,
    args.text,
    args.query,
    args.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value) return value;
    }
  }

  return undefined;
};

export const resolveAskRequestId = (
  args: Record<string, unknown> | null,
): string | undefined => {
  if (!args) return undefined;

  const directCandidates = [
    args.request_id,
    args.requestId,
    args.action_request_id,
    args.actionRequestId,
    args.action_id,
    args.actionId,
    args.elicitation_id,
    args.elicitationId,
    args.id,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const nestedData =
    args.data && typeof args.data === "object"
      ? (args.data as Record<string, unknown>)
      : undefined;

  if (nestedData) {
    const nestedCandidates = [
      nestedData.request_id,
      nestedData.requestId,
      nestedData.id,
      nestedData.action_id,
      nestedData.actionId,
    ];
    for (const candidate of nestedCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return undefined;
};

export const resolveActionPromptKey = (
  action: ActionRequired,
): string | null => {
  if (typeof action.prompt === "string" && action.prompt.trim()) {
    return action.prompt.trim();
  }

  if (action.questions && action.questions.length > 0) {
    const question = action.questions[0]?.question;
    if (typeof question === "string" && question.trim()) {
      return question.trim();
    }
  }

  const schema = action.requestedSchema as Record<string, unknown> | undefined;
  const properties =
    schema?.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const answer =
    properties?.answer && typeof properties.answer === "object"
      ? (properties.answer as Record<string, unknown>)
      : undefined;
  const description = answer?.description;
  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }

  return null;
};

export const truncateForLog = (text: string, maxLength = 80): string => {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
};

export const mapProviderName = (providerType: string): string => {
  const mapping: Record<string, string> = {
    openai: "openai",
    "gpt-4": "openai",
    "gpt-4o": "openai",
    claude: "anthropic",
    anthropic: "anthropic",
    google: "google",
    gemini: "google",
    deepseek: "deepseek",
    "deepseek-reasoner": "deepseek",
    ollama: "ollama",
    codex: "codex",
    openrouter: "openrouter",
    groq: "openai",
    mistral: "openai",
  };
  return mapping[providerType.toLowerCase()] || providerType;
};
