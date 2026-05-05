import { WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE } from "./agentChatCoreUtils";
import {
  resolveRuntimeWarningToastPresentation,
  type RuntimeWarningToastLevel,
} from "./runtimeWarningPresentation";

export interface AgentStreamWarningPlan {
  shouldMarkWarned: boolean;
  toast: {
    level: RuntimeWarningToastLevel;
    message: string;
  } | null;
  warningKey: string | null;
}

export interface AgentStreamWarningToastAction {
  level: RuntimeWarningToastLevel;
  message: string;
}

export interface AgentStreamWarningToastDispatcher {
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

export function buildAgentStreamWarningPlan(params: {
  activeSessionId: string;
  alreadyWarned: boolean;
  code?: string | null;
  message?: string | null;
}): AgentStreamWarningPlan {
  if (params.code === WORKSPACE_PATH_AUTO_CREATED_WARNING_CODE) {
    return {
      shouldMarkWarned: false,
      toast: null,
      warningKey: null,
    };
  }

  const warningKey = `${params.activeSessionId}:${
    params.code || params.message || ""
  }`;
  if (params.alreadyWarned) {
    return {
      shouldMarkWarned: false,
      toast: null,
      warningKey,
    };
  }

  const presentation = resolveRuntimeWarningToastPresentation({
    code: params.code,
    message: params.message,
  });

  return {
    shouldMarkWarned: true,
    toast: presentation.shouldToast
      ? {
          level: presentation.level,
          message: presentation.message,
        }
      : null,
    warningKey,
  };
}

export function buildAgentStreamWarningToastAction(
  toastPlan: AgentStreamWarningPlan["toast"],
): AgentStreamWarningToastAction | null {
  if (!toastPlan) {
    return null;
  }

  return {
    level: toastPlan.level,
    message: toastPlan.message,
  };
}

export function applyAgentStreamWarningToastAction(
  action: AgentStreamWarningToastAction | null,
  dispatcher: AgentStreamWarningToastDispatcher,
): void {
  if (!action) {
    return;
  }

  switch (action.level) {
    case "info":
      dispatcher.info(action.message);
      break;
    case "error":
      dispatcher.error(action.message);
      break;
    case "warning":
    default:
      dispatcher.warning(action.message);
      break;
  }
}
