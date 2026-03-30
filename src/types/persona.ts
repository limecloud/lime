/**
 * 人设相关类型定义
 *
 * 定义人设（Persona）相关的 TypeScript 类型。
 *
 * @module types/persona
 * @requirements 6.3
 */

import type { Platform } from "./platform";

// ============================================================================
// 人设类型
// ============================================================================

/**
 * 人设
 */
export interface Persona {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  style: string;
  tone?: string;
  targetAudience?: string;
  forbiddenWords: string[];
  preferredWords: string[];
  examples?: string;
  platforms: Platform[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建人设请求
 */
export interface CreatePersonaRequest {
  projectId: string;
  name: string;
  description?: string;
  style: string;
  tone?: string;
  targetAudience?: string;
  forbiddenWords?: string[];
  preferredWords?: string[];
  examples?: string;
  platforms?: Platform[];
}

/**
 * 更新人设请求
 */
export interface PersonaUpdate {
  name?: string;
  description?: string;
  style?: string;
  tone?: string;
  targetAudience?: string;
  forbiddenWords?: string[];
  preferredWords?: string[];
  examples?: string;
  platforms?: Platform[];
}

/**
 * 人设模板（用于快速创建）
 */
export interface PersonaTemplate {
  id: string;
  name: string;
  description: string;
  style: string;
  tone: string;
  targetAudience: string;
  platforms: Platform[];
}
