import type { AsterSubagentSkillInfo } from "@/lib/api/agentRuntime";
import {
  buildTeamWorkspaceSkillDisplayName,
  resolveTeamWorkspaceDisplayRuntimeStatusLabel,
  resolveTeamWorkspaceDisplaySessionTypeLabel,
  resolveTeamWorkspaceRoleHintLabel,
  resolveTeamWorkspaceStableProcessingLabel,
} from "../utils/teamWorkspaceCopy";
import { getTeamPresetOption } from "../utils/teamPresets";
import type { TeamWorkspaceRuntimeStatus } from "../teamWorkspaceRuntime";
import { buildRuntimeDetailSummary } from "./canvasLaneSelectors";

export interface SelectedSessionDetailSession {
  blueprintRoleLabel?: string;
  createdFromTurnId?: string;
  latestTurnStatus?: TeamWorkspaceRuntimeStatus;
  model?: string;
  originTool?: string;
  outputContract?: string;
  profileName?: string;
  providerConcurrencyGroup?: string;
  providerName?: string;
  providerParallelBudget?: number;
  queueReason?: string;
  queuedTurnCount?: number;
  roleKey?: string;
  sessionType?: string;
  skills?: AsterSubagentSkillInfo[];
  teamActiveCount?: number;
  teamParallelBudget?: number;
  teamPresetId?: string;
  teamQueuedCount?: number;
  theme?: string;
}

export interface SelectedSessionDetailSkillBadge {
  id: string;
  label: string;
  title?: string;
}

export interface SelectedSessionDetailDisplayState {
  runtimeDetailSummary: string | null;
  queueReason: string | null;
  metadata: string[];
  settingBadges: string[];
  outputContract: string | null;
  skillBadges: SelectedSessionDetailSkillBadge[];
  hasSettings: boolean;
}

export function buildSelectedSessionDetailDisplayState(params: {
  selectedSession?: SelectedSessionDetailSession | null;
  isChildSession: boolean;
  parentSessionName?: string | null;
}): SelectedSessionDetailDisplayState {
  const selectedSession = params.selectedSession ?? null;
  const queuedCount =
    selectedSession?.teamQueuedCount ?? selectedSession?.queuedTurnCount ?? 0;
  const roleLabel = resolveTeamWorkspaceRoleHintLabel(selectedSession?.roleKey);
  const presetLabel = selectedSession?.teamPresetId
    ? getTeamPresetOption(selectedSession.teamPresetId)?.label ??
      selectedSession.teamPresetId
    : null;
  const skillBadges = (selectedSession?.skills ?? []).map((skill) => ({
    id: skill.id,
    label: buildTeamWorkspaceSkillDisplayName(skill),
    title: skill.description || skill.directory || undefined,
  }));
  const settingBadges = [
    presetLabel ? `预设 ${presetLabel}` : null,
    selectedSession?.profileName ? `风格 ${selectedSession.profileName}` : null,
    roleLabel ? `分工 ${roleLabel}` : null,
    selectedSession?.theme ? `主题 ${selectedSession.theme}` : null,
  ].filter(Boolean) as string[];
  const metadata = [
    selectedSession?.blueprintRoleLabel
      ? `分工 ${selectedSession.blueprintRoleLabel}`
      : null,
    selectedSession?.sessionType
      ? resolveTeamWorkspaceDisplaySessionTypeLabel(selectedSession.sessionType)
      : null,
    selectedSession?.providerName
      ? `服务 ${selectedSession.providerName}`
      : null,
    selectedSession?.model ? `模型 ${selectedSession.model}` : null,
    selectedSession?.originTool ? `来源 ${selectedSession.originTool}` : null,
    selectedSession?.createdFromTurnId
      ? `来自之前的任务 ${selectedSession.createdFromTurnId}`
      : null,
    queuedCount > 0 ? `等待中 ${queuedCount}` : null,
    selectedSession?.teamActiveCount !== undefined &&
    selectedSession?.teamParallelBudget !== undefined
      ? `处理中 ${selectedSession.teamActiveCount}/${selectedSession.teamParallelBudget}`
      : null,
    selectedSession?.providerParallelBudget === 1 &&
    selectedSession?.providerConcurrencyGroup
      ? resolveTeamWorkspaceStableProcessingLabel()
      : null,
    selectedSession?.latestTurnStatus
      ? `最近进展 ${resolveTeamWorkspaceDisplayRuntimeStatusLabel(selectedSession.latestTurnStatus)}`
      : null,
    params.isChildSession && params.parentSessionName?.trim()
      ? `来自 ${params.parentSessionName.trim()}`
      : null,
  ].filter(Boolean) as string[];

  return {
    runtimeDetailSummary: buildRuntimeDetailSummary(selectedSession),
    queueReason: selectedSession?.queueReason?.trim() || null,
    metadata,
    settingBadges,
    outputContract: selectedSession?.outputContract?.trim() || null,
    skillBadges,
    hasSettings:
      settingBadges.length > 0 ||
      Boolean(selectedSession?.outputContract?.trim()) ||
      skillBadges.length > 0,
  };
}
