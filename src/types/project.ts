/**
 * 项目相关类型定义
 *
 * 定义项目（Project/Workspace）相关的 TypeScript 类型。
 *
 * @module types/project
 * @requirements 1.5, 12.6
 */

import type { WorkspaceType } from "./workspace";
import type { WorkspaceSettings } from "./workspace";

// ============================================================================
// 项目类型
// ============================================================================

/**
 * 项目（Workspace）
 */
export interface Project {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  rootPath: string;
  isDefault: boolean;
  settings?: WorkspaceSettings;
  icon?: string;
  color?: string;
  isFavorite: boolean;
  isArchived: boolean;
  tags: string[];
  defaultPersonaId?: string;
  stats?: ProjectStats;
  createdAt: number;
  updatedAt: number;
}

/**
 * 项目统计信息
 */
export interface ProjectStats {
  contentCount: number;
  totalWords: number;
  completedCount: number;
  lastAccessed?: number;
}

/**
 * 创建项目请求
 */
export interface CreateProjectRequest {
  name: string;
  workspaceType: WorkspaceType;
  icon?: string;
  color?: string;
}

/**
 * 更新项目请求
 */
export interface ProjectUpdate {
  name?: string;
  settings?: WorkspaceSettings;
  icon?: string;
  color?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  tags?: string[];
  defaultPersonaId?: string;
}

/**
 * 项目筛选条件
 */
export interface ProjectFilter {
  workspaceType?: WorkspaceType;
  isArchived?: boolean;
  isFavorite?: boolean;
  searchQuery?: string;
}
