/**
 * Workspace 相关类型定义
 *
 * @module types/workspace
 */

// ============================================================================
// Workspace 类型
// ============================================================================

/**
 * Workspace 类型枚举
 */
export type WorkspaceType =
  | "persistent" // 持久化项目
  | "temporary" // 临时项目
  | "blog" // 博客
  | "general"; // 通用

/**
 * Workspace 类型显示名称映射
 */
export const WorkspaceTypeLabels: Record<WorkspaceType, string> = {
  persistent: "持久化",
  temporary: "临时",
  blog: "博客",
  general: "通用",
};

/** 媒体生成偏好设置 */
export interface WorkspaceMediaGenerationSettings {
  preferredProviderId?: string;
  preferredModelId?: string;
  allowFallback?: boolean;
}

export type WorkspaceTeamSelectionSource = "builtin" | "custom";

export interface WorkspaceTeamSelectionReference {
  id: string;
  source: WorkspaceTeamSelectionSource;
}

export interface WorkspaceAgentTeamRoleSettings {
  id: string;
  label: string;
  summary: string;
  profileId?: string;
  roleKey?: string;
  skillIds?: string[];
}

export interface WorkspaceAgentCustomTeamSettings {
  id: string;
  label: string;
  description: string;
  theme?: string;
  presetId?: string;
  roles: WorkspaceAgentTeamRoleSettings[];
  createdAt?: number;
  updatedAt?: number;
}

export interface WorkspaceAgentTeamSettings {
  selectedTeam?: WorkspaceTeamSelectionReference;
  disabled?: boolean;
  customTeams?: WorkspaceAgentCustomTeamSettings[];
}

/** Workspace 设置 */
export interface WorkspaceSettings {
  mcpConfig?: Record<string, unknown>;
  defaultProvider?: string;
  autoCompact?: boolean;
  imageGeneration?: WorkspaceMediaGenerationSettings;
  videoGeneration?: WorkspaceMediaGenerationSettings;
  voiceGeneration?: WorkspaceMediaGenerationSettings;
  agentTeam?: WorkspaceAgentTeamSettings;
}
