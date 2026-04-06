/**
 * @file Skill 执行 API 模块
 * @description 封装 Skill 执行相关的 Tauri 命令调用
 *
 * 提供以下功能：
 * - executeSkill: 执行指定的 Skill
 * - listExecutableSkills: 列出所有可执行的 Skills
 * - getSkillDetail: 获取 Skill 详情
 *
 * @module lib/api/skill-execution
 * @requirements 3.1, 4.1, 5.1
 */

import { safeInvoke } from "@/lib/dev-bridge";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 可执行 Skill 信息
 *
 * 用于 listExecutableSkills 返回的 Skill 列表项
 */
export interface ExecutableSkillInfo {
  /** Skill 名称（唯一标识） */
  name: string;
  /** 显示名称 */
  display_name: string;
  /** Skill 描述 */
  description: string;
  /** 执行模式：prompt, workflow, agent */
  execution_mode: "prompt" | "workflow" | "agent";
  /** 是否有 workflow 定义 */
  has_workflow: boolean;
  /** 指定的 Provider（可选） */
  provider?: string;
  /** 指定的 Model（可选） */
  model?: string;
  /** 参数提示（可选） */
  argument_hint?: string;
}

/**
 * Workflow 步骤信息
 *
 * 描述 Workflow 中的单个步骤
 */
export interface WorkflowStepInfo {
  /** 步骤 ID */
  id: string;
  /** 步骤名称 */
  name: string;
  /** 依赖的步骤 ID 列表 */
  dependencies: string[];
}

/**
 * Skill 详情信息
 *
 * 包含 Skill 的完整信息，用于 getSkillDetail 返回
 */
export interface SkillDetailInfo extends ExecutableSkillInfo {
  /** Markdown 内容（System Prompt） */
  markdown_content: string;
  /** Workflow 步骤（如果有） */
  workflow_steps?: WorkflowStepInfo[];
  /** 允许的工具列表（可选） */
  allowed_tools?: string[];
  /** 使用场景说明（可选） */
  when_to_use?: string;
}

/**
 * 步骤执行结果
 *
 * 描述单个步骤的执行结果
 */
export interface StepResult {
  /** 步骤 ID */
  step_id: string;
  /** 步骤名称 */
  step_name: string;
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output?: string;
  /** 错误信息 */
  error?: string;
}

/**
 * Skill 执行结果
 *
 * 用于 executeSkill 返回的执行结果
 */
export interface SkillExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 最终输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 已完成的步骤结果 */
  steps_completed: StepResult[];
}

/**
 * Skill 执行请求参数
 *
 * 统一对象参数，避免位置参数导致的调用混乱。
 */
export interface ExecuteSkillRequest {
  /** Skill 名称 */
  skillName: string;
  /** 用户输入 */
  userInput: string;
  /** 图片输入（可选） */
  images?: SkillExecutionImageInput[];
  /** 结构化请求上下文（可选） */
  requestContext?: Record<string, unknown>;
  /** Provider 覆盖 */
  providerOverride?: string;
  /** 模型覆盖 */
  modelOverride?: string;
  /** 执行 ID（用于事件关联） */
  executionId?: string;
  /** 会话 ID（用于上下文延续） */
  sessionId?: string;
}

export interface SkillExecutionImageInput {
  data: string;
  mediaType: string;
}

// ============================================================================
// Tauri 事件 Payload 类型
// ============================================================================

/**
 * 步骤开始事件 Payload
 *
 * 当 Skill 执行步骤开始时发送
 * 事件名: skill:step_start
 */
export interface StepStartPayload {
  /** 执行 ID */
  execution_id: string;
  /** 步骤 ID */
  step_id: string;
  /** 步骤名称 */
  step_name: string;
  /** 当前步骤序号（从 1 开始） */
  current_step: number;
  /** 总步骤数 */
  total_steps: number;
}

/**
 * 步骤完成事件 Payload
 *
 * 当 Skill 执行步骤完成时发送
 * 事件名: skill:step_complete
 */
export interface StepCompletePayload {
  /** 执行 ID */
  execution_id: string;
  /** 步骤 ID */
  step_id: string;
  /** 输出内容 */
  output: string;
}

/**
 * 步骤错误事件 Payload
 *
 * 当 Skill 执行步骤出错时发送
 * 事件名: skill:step_error
 */
export interface StepErrorPayload {
  /** 执行 ID */
  execution_id: string;
  /** 步骤 ID */
  step_id: string;
  /** 错误信息 */
  error: string;
  /** 是否会重试 */
  will_retry: boolean;
}

/**
 * 执行完成事件 Payload
 *
 * 当 Skill 执行完成时发送
 * 事件名: skill:complete
 */
export interface ExecutionCompletePayload {
  /** 执行 ID */
  execution_id: string;
  /** 是否成功 */
  success: boolean;
  /** 输出内容（成功时） */
  output?: string;
  /** 错误信息（失败时） */
  error?: string;
}

// ============================================================================
// Tauri 事件名常量
// ============================================================================

/** Skill 执行相关的 Tauri 事件名 */
export const SKILL_EVENTS = {
  /** 步骤开始事件 */
  STEP_START: "skill:step_start",
  /** 步骤完成事件 */
  STEP_COMPLETE: "skill:step_complete",
  /** 步骤错误事件 */
  STEP_ERROR: "skill:step_error",
  /** 执行完成事件 */
  COMPLETE: "skill:complete",
} as const;

// ============================================================================
// API 函数
// ============================================================================

/**
 * Skill 执行 API
 *
 * 封装 Skill 执行相关的 Tauri 命令调用
 */
export const skillExecutionApi = {
  /**
   * 执行指定的 Skill
   *
   * @param request - 执行参数
   * @returns 执行结果
   *
   * @requirements 3.1, 3.2, 3.5
   */
  async executeSkill(
    request: ExecuteSkillRequest,
  ): Promise<SkillExecutionResult> {
    return safeInvoke(
      "execute_skill",
      request as unknown as Record<string, unknown>,
    );
  },

  /**
   * 列出所有可执行的 Skills
   *
   * 返回所有可以执行的 Skills 列表，已过滤掉 disable_model_invocation=true 的 Skills
   *
   * @returns 可执行的 Skills 列表
   *
   * @requirements 4.1, 4.2, 4.3, 4.4
   */
  async listExecutableSkills(): Promise<ExecutableSkillInfo[]> {
    return safeInvoke("list_executable_skills");
  },

  /**
   * 获取 Skill 详情
   *
   * @param skillName - Skill 名称
   * @returns Skill 详情信息
   * @throws 如果 Skill 不存在则抛出错误
   *
   * @requirements 5.1, 5.2, 5.3, 5.4
   */
  async getSkillDetail(skillName: string): Promise<SkillDetailInfo> {
    return safeInvoke("get_skill_detail", { skillName });
  },
};
