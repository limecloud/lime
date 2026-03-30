/**
 * 项目上下文相关类型定义
 *
 * 定义项目上下文（ProjectContext）和发布配置相关的 TypeScript 类型。
 *
 * @module types/context
 * @requirements 10.1
 */

import type { Project } from "./project";
import type { Persona } from "./persona";
import type { Material } from "./material";
import type { Platform } from "./platform";

// ============================================================================
// 上下文类型
// ============================================================================

/**
 * 项目上下文
 *
 * 包含项目的完整配置信息，用于构建 AI System Prompt。
 */
export interface ProjectContext {
  project: Project;
  persona?: Persona;
  materials: Material[];
}

/**
 * 发布配置
 */
export interface PublishConfig {
  id: string;
  projectId: string;
  platform: Platform;
  isConfigured: boolean;
  lastPublishedAt?: number;
  publishCount: number;
  createdAt: number;
  updatedAt: number;
}
