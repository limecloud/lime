/**
 * Agent / aster 兼容 API
 *
 * 仅保留历史命名与旧入口的显式过渡层，禁止在新代码中直接依赖。
 */

import { safeInvoke } from "@/lib/dev-bridge";
import {
  getAsterAgentStatus,
  sendAsterMessageStream,
  type AsterExecutionStrategy,
  type ImageInput,
} from "./agentRuntime";

const createDeprecatedAgentApiError = (
  apiName: string,
  replacement: string,
): Error => new Error(`${apiName} 已废弃，请迁移到 ${replacement}。`);

/**
 * aster Agent 状态
 *
 * @deprecated 请使用 `AsterAgentStatus`
 */
export interface asterAgentStatus {
  initialized: boolean;
  provider?: string;
  model?: string;
}

/**
 * aster Provider 信息
 *
 * @deprecated 旧命名类型，请改用现役 Aster Provider 配置流程
 */
export interface asterProviderInfo {
  name: string;
  display_name: string;
}

/**
 * aster 创建会话响应
 *
 * @deprecated 请使用 `createAsterSession`
 */
export interface asterCreateSessionResponse {
  session_id: string;
}

/**
 * 发送消息到 Agent（支持连续对话）- 非流式版本
 *
 * @deprecated 已废弃。请迁移到 `sendAsterMessageStream`。
 */
export async function sendAgentMessage(
  _message: string,
  _sessionId?: string,
  _model?: string,
  _images?: ImageInput[],
  _webSearch?: boolean,
  _thinking?: boolean,
): Promise<string> {
  throw createDeprecatedAgentApiError(
    "sendAgentMessage",
    "sendAgentMessageStream 或 sendAsterMessageStream",
  );
}

/**
 * 发送消息到 Agent（流式版本）
 *
 * @deprecated 请使用 sendAsterMessageStream 代替
 */
export async function sendAgentMessageStream(
  message: string,
  eventName: string,
  workspaceId: string,
  sessionId?: string,
  model?: string,
  images?: ImageInput[],
  provider?: string,
  _terminalMode?: boolean,
  projectId?: string,
  executionStrategy?: AsterExecutionStrategy,
): Promise<void> {
  return await sendAsterMessageStream(
    message,
    sessionId || "default",
    eventName,
    workspaceId,
    images,
    provider
      ? {
          provider_id: provider,
          provider_name: provider,
          model_name: model || "claude-sonnet-4-20250514",
        }
      : undefined,
    executionStrategy,
    undefined,
    undefined,
    undefined,
    projectId,
  );
}

/**
 * 初始化 aster Agent
 *
 * @deprecated 请使用 `initAsterAgent` + `configureAsterProvider`
 */
export async function initasterAgent(
  _providerName: string,
  _modelName: string,
): Promise<asterAgentStatus> {
  throw createDeprecatedAgentApiError(
    "initasterAgent",
    "initAsterAgent + configureAsterProvider",
  );
}

/**
 * 获取 aster Agent 状态
 *
 * @deprecated 请使用 `getAsterAgentStatus`
 */
export async function getasterAgentStatus(): Promise<asterAgentStatus> {
  const status = await getAsterAgentStatus();
  return {
    initialized: status.initialized,
    provider: status.provider_name,
    model: status.model_name,
  };
}

/**
 * 重置 aster Agent
 *
 * @deprecated 请使用 `initAsterAgent` / `getAsterAgentStatus` 相关新 API
 */
export async function resetasterAgent(): Promise<void> {
  return await safeInvoke("aster_agent_reset");
}

/**
 * 创建 aster Agent 会话
 *
 * @deprecated 请使用 `createAsterSession`
 */
export async function createasterSession(
  _name?: string,
): Promise<asterCreateSessionResponse> {
  throw createDeprecatedAgentApiError(
    "createasterSession",
    "createAsterSession",
  );
}

/**
 * 发送消息到 aster Agent (流式响应)
 *
 * @deprecated 请使用 `sendAsterMessageStream`
 */
export async function sendasterMessage(
  _sessionId: string,
  _message: string,
  _eventName: string,
): Promise<void> {
  throw createDeprecatedAgentApiError(
    "sendasterMessage",
    "sendAsterMessageStream",
  );
}

/**
 * 扩展 aster Agent 系统提示词
 *
 * @deprecated 该旧入口已停止维护，请改用现役 Aster 会话能力
 */
export async function extendasterSystemPrompt(
  _instruction: string,
): Promise<void> {
  throw createDeprecatedAgentApiError(
    "extendasterSystemPrompt",
    "现役 Aster 会话配置流程",
  );
}

/**
 * 获取 aster 支持的 Provider 列表
 *
 * @deprecated 该旧入口已停止维护，请改用 Provider 配置/凭证池流程
 */
export async function listasterProviders(): Promise<asterProviderInfo[]> {
  throw createDeprecatedAgentApiError(
    "listasterProviders",
    "Provider 配置/凭证池流程",
  );
}
