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
  | "social-media" // 社交媒体
  | "blog" // 博客
  | "novel" // 小说
  | "general" // 通用
  | "poster" // 图文海报
  | "music" // 歌词曲谱
  | "knowledge" // 知识探索
  | "planning" // 计划规划
  | "document" // 办公文档
  | "video"; // 短视频

/**
 * Workspace 类型显示名称映射
 */
export const WorkspaceTypeLabels: Record<WorkspaceType, string> = {
  persistent: "持久化",
  temporary: "临时",
  "social-media": "社交媒体",
  blog: "博客",
  novel: "小说",
  general: "通用",
  poster: "图文海报",
  music: "歌词曲谱",
  knowledge: "知识探索",
  planning: "计划规划",
  document: "办公文档",
  video: "短视频",
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
