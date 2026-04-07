export type SkillFailureCode =
  | "skill_catalog_unavailable"
  | "skill_not_found"
  | "skill_session_init_failed"
  | "skill_provider_unavailable"
  | "skill_workspace_mismatch"
  | "skill_stream_failed"
  | "skill_cancelled"
  | "skill_execute_failed";

export interface SkillFailureInfo {
  code: SkillFailureCode;
  message: string;
  recoveryHint: string;
}

const DEFAULT_FAILURE: SkillFailureInfo = {
  code: "skill_execute_failed",
  message: "执行过程中发生未知错误",
  recoveryHint: "请重试；若持续失败，请切换模型或新建任务后再试。",
};

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || DEFAULT_FAILURE.message;
  }

  if (typeof error === "string") {
    return error.trim() || DEFAULT_FAILURE.message;
  }

  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return DEFAULT_FAILURE.message;
}

function splitErrorCode(rawMessage: string): {
  explicitCode: string | null;
  message: string;
} {
  const separatorIndex = rawMessage.indexOf("|");
  if (separatorIndex <= 0) {
    return { explicitCode: null, message: rawMessage };
  }

  const maybeCode = rawMessage.slice(0, separatorIndex).trim();
  if (!/^[a-z0-9_:-]+$/i.test(maybeCode)) {
    return { explicitCode: null, message: rawMessage };
  }

  const message = rawMessage.slice(separatorIndex + 1).trim();
  return {
    explicitCode: maybeCode,
    message: message || rawMessage,
  };
}

function byCode(code: SkillFailureCode, message: string): SkillFailureInfo {
  switch (code) {
    case "skill_catalog_unavailable":
      return {
        code,
        message,
        recoveryHint: "技能目录暂不可用，请稍后重试或检查本地技能配置。",
      };
    case "skill_not_found":
      return {
        code,
        message,
        recoveryHint:
          "请确认技能名称拼写，并在 Claw 侧边栏的技能页查看可用技能。",
      };
    case "skill_session_init_failed":
      return {
        code,
        message,
        recoveryHint: "请先新建任务或重新选择项目后再执行技能。",
      };
    case "skill_provider_unavailable":
      return {
        code,
        message,
        recoveryHint: "当前凭证或模型不可用，请切换模型/Provider 后重试。",
      };
    case "skill_workspace_mismatch":
      return {
        code,
        message,
        recoveryHint: "项目目录已变化，请返回新建任务重新进入该项目后再试。",
      };
    case "skill_stream_failed":
      return {
        code,
        message,
        recoveryHint: "流式执行中断，请重试；必要时先停止当前会话。",
      };
    case "skill_cancelled":
      return {
        code,
        message,
        recoveryHint: "已取消执行，可直接重新发送同一技能命令。",
      };
    case "skill_execute_failed":
    default:
      return {
        code: "skill_execute_failed",
        message,
        recoveryHint: DEFAULT_FAILURE.recoveryHint,
      };
  }
}

function inferSkillFailureCode(message: string): SkillFailureCode {
  const lower = message.toLowerCase();

  if (
    lower.includes("cancel") ||
    lower.includes("取消") ||
    lower.includes("stopped")
  ) {
    return "skill_cancelled";
  }

  if (
    lower.includes("workspace_mismatch") ||
    lower.includes("工作目录") ||
    lower.includes("workspace 不匹配")
  ) {
    return "skill_workspace_mismatch";
  }

  if (
    lower.includes("provider") ||
    lower.includes("无法配置任何可用") ||
    lower.includes("credential")
  ) {
    return "skill_provider_unavailable";
  }

  if (lower.includes("session") || lower.includes("无法创建会话")) {
    return "skill_session_init_failed";
  }

  if (lower.includes("stream error") || lower.includes("agent error")) {
    return "skill_stream_failed";
  }

  if (
    lower.includes("skill") &&
    (lower.includes("not found") || lower.includes("不存在"))
  ) {
    return "skill_not_found";
  }

  return "skill_execute_failed";
}

function normalizeSkillFailureCode(
  code: string | null,
): SkillFailureCode | null {
  if (!code) {
    return null;
  }

  const normalized = code.trim().toLowerCase();
  const allowed: SkillFailureCode[] = [
    "skill_catalog_unavailable",
    "skill_not_found",
    "skill_session_init_failed",
    "skill_provider_unavailable",
    "skill_workspace_mismatch",
    "skill_stream_failed",
    "skill_cancelled",
    "skill_execute_failed",
  ];

  return allowed.includes(normalized as SkillFailureCode)
    ? (normalized as SkillFailureCode)
    : null;
}

export function resolveSkillFailure(error: unknown): SkillFailureInfo {
  const raw = normalizeErrorMessage(error);
  const { explicitCode, message } = splitErrorCode(raw);

  const normalizedCode = normalizeSkillFailureCode(explicitCode);
  if (normalizedCode) {
    return byCode(normalizedCode, message);
  }

  return byCode(inferSkillFailureCode(message), message);
}

export function formatSkillFailureMessage(failure: SkillFailureInfo): string {
  return `Skill 执行失败（${failure.code}）：${failure.message}\n建议：${failure.recoveryHint}`;
}
