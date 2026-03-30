import {
  normalizeThemeType,
  type ThemeType,
} from "@/lib/workspace/workbenchContract";
import type { AsterSubagentSessionInfo } from "@/lib/api/agentRuntime";
import type { ProjectType } from "@/lib/api/project";

export function normalizeInitialTheme(value?: string): ThemeType {
  return normalizeThemeType(value);
}

export function deriveCurrentSessionRuntimeStatus(params: {
  isSending: boolean;
  queuedTurnCount: number;
  turns: Array<{ status: string }>;
}): AsterSubagentSessionInfo["runtime_status"] | undefined {
  if (
    params.isSending ||
    params.turns.some((turn) => turn.status === "running")
  ) {
    return "running";
  }
  if (params.queuedTurnCount > 0) {
    return "queued";
  }

  const latestStatus = params.turns[params.turns.length - 1]?.status;
  switch (latestStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    default:
      return undefined;
  }
}

export function deriveLatestTurnRuntimeStatus(
  turns: Array<{ status: string }>,
): AsterSubagentSessionInfo["runtime_status"] | undefined {
  switch (turns[turns.length - 1]?.status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    default:
      return undefined;
  }
}

export function projectTypeToTheme(projectType: ProjectType): ThemeType {
  return normalizeThemeType(projectType);
}
