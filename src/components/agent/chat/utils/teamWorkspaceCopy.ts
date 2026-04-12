import type { AsterSubagentSkillInfo } from "@/lib/api/agentRuntime";
import { STABLE_PROCESSING_LABEL } from "./stableProcessingExperience";

export type TeamWorkspaceDisplayRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "closed"
  | "not_found"
  | undefined;

export type TeamWorkspaceDisplayFormationStatus =
  | "forming"
  | "formed"
  | "failed";

export type TeamWorkspaceDisplayMemberStatus =
  | "planned"
  | "spawning"
  | "running"
  | "waiting"
  | "completed"
  | "failed";

export const TEAM_WORKSPACE_SURFACE_TITLE = "任务工作台";
export const TEAM_WORKSPACE_REALTIME_BADGE_LABEL = "任务进行时";
export const TEAM_WORKSPACE_MEMBER_NOUN = "子任务";
export const TEAM_WORKSPACE_PLAN_LABEL = "任务方案";
export const TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL = "主任务";
export const TEAM_WORKSPACE_STABLE_PROCESSING_LABEL = STABLE_PROCESSING_LABEL;
export const TEAM_WORKSPACE_WAITING_HEADLINE = "等待任务接手";
export const TEAM_WORKSPACE_IDLE_STATUS_LABEL = "还没有任务接手";

const RUNTIME_STATUS_LABELS = {
  idle: "待开始",
  queued: "稍后开始",
  running: "处理中",
  completed: "已完成",
  failed: "需重试",
  aborted: "已暂停",
  closed: "已停止",
  not_found: "未找到",
} as const;

const FORMATION_STATUS_META = {
  forming: {
    label: "准备中",
    title: "正在准备任务分工",
  },
  formed: {
    label: "已就绪",
    title: "任务分工已准备好",
  },
  failed: {
    label: "准备失败",
    title: "任务分工准备失败",
  },
} as const;

const MEMBER_STATUS_LABELS = {
  planned: "待分配",
  spawning: "接入中",
  running: "正在处理",
  waiting: "待继续",
  completed: "已完成",
  failed: "需重试",
} as const;

const ROLE_HINT_LABELS: Record<string, string> = {
  explorer: "分析",
  executor: "执行",
  reviewer: "复核",
  writer: "撰写",
  planner: "规划",
  researcher: "研究",
  designer: "设计",
  design: "设计",
  editor: "润色",
  orchestrator: TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL,
};

export function resolveTeamWorkspaceDisplayRuntimeStatusLabel(
  status?: TeamWorkspaceDisplayRuntimeStatus,
): string {
  if (!status) {
    return RUNTIME_STATUS_LABELS.idle;
  }
  return RUNTIME_STATUS_LABELS[status];
}

export function resolveTeamWorkspaceDisplayFormationMeta(
  status: TeamWorkspaceDisplayFormationStatus,
) {
  return FORMATION_STATUS_META[status];
}

export function resolveTeamWorkspaceDisplayMemberStatusLabel(
  status: TeamWorkspaceDisplayMemberStatus,
) {
  return MEMBER_STATUS_LABELS[status];
}

export function resolveTeamWorkspaceDisplaySessionTypeLabel(value?: string) {
  switch (value) {
    case "sub_agent":
      return TEAM_WORKSPACE_MEMBER_NOUN;
    case "fork":
      return "补充分支";
    case "user":
      return TEAM_WORKSPACE_MAIN_ASSISTANT_LABEL;
    default:
      return value?.trim() || "会话";
  }
}

export function resolveTeamWorkspaceRoleHintLabel(
  roleHint?: string | null,
): string | null {
  const normalized = roleHint?.trim();
  if (!normalized) {
    return null;
  }

  const mappedLabel = ROLE_HINT_LABELS[normalized.toLowerCase()];
  if (mappedLabel) {
    return mappedLabel;
  }

  if (/[\u4e00-\u9fff]/.test(normalized)) {
    return normalized;
  }

  return null;
}

export function buildTeamWorkspaceSkillDisplayName(
  skill: AsterSubagentSkillInfo,
): string {
  return skill.name;
}

export function resolveTeamWorkspaceStableProcessingLabel() {
  return TEAM_WORKSPACE_STABLE_PROCESSING_LABEL;
}
