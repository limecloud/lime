/**
 * Agent / Aster 现役运行时 API
 *
 * 仅保留当前仍在维护的进程、会话、流式与交互能力。
 */

import { safeInvoke } from "@/lib/dev-bridge";
import type {
  AgentThreadItem,
  AgentThreadTurn,
  ToolResultImage,
} from "./agentStream";
import {
  normalizeQueuedTurnSnapshots,
  type QueuedTurnSnapshot,
} from "./queuedTurn";

export type { QueuedTurnSnapshot } from "./queuedTurn";

/**
 * Agent 状态
 */
export interface AgentProcessStatus {
  running: boolean;
  base_url?: string;
  port?: number;
}

/**
 * 创建会话响应
 */
export interface CreateSessionResponse {
  session_id: string;
  credential_name: string;
  credential_uuid: string;
  provider_type: string;
  model?: string;
  execution_strategy?: AsterExecutionStrategy;
}

export type AsterExecutionStrategy = "react" | "code_orchestrated" | "auto";

/**
 * 会话信息
 */
export interface SessionInfo {
  session_id: string;
  provider_type: string;
  model?: string;
  title?: string;
  created_at: string;
  last_activity: string;
  messages_count: number;
  workspace_id?: string;
  working_dir?: string;
  execution_strategy?: AsterExecutionStrategy;
}

/**
 * 图片输入
 */
export interface ImageInput {
  data: string;
  media_type: string;
}

/**
 * Skill 信息
 */
export interface SkillInfo {
  name: string;
  description?: string;
  path?: string;
}

const requireWorkspaceId = (
  workspaceId?: string,
  fallbackWorkspaceId?: string,
): string => {
  const resolvedWorkspaceId = (workspaceId ?? fallbackWorkspaceId)?.trim();
  if (!resolvedWorkspaceId) {
    throw new Error("workspaceId 不能为空，请先选择项目工作区");
  }
  return resolvedWorkspaceId;
};

/**
 * Aster Agent 状态
 */
export interface AsterAgentStatus {
  initialized: boolean;
  provider_configured: boolean;
  provider_name?: string;
  model_name?: string;
}

/**
 * Aster Provider 配置
 */
export interface AsterProviderConfig {
  provider_id?: string;
  provider_name: string;
  model_name: string;
  api_key?: string;
  base_url?: string;
}

export interface AutoContinueRequestPayload {
  enabled: boolean;
  fast_mode_enabled: boolean;
  continuation_length: number;
  sensitivity: number;
  source?: string;
}

export type AgentSearchMode = "disabled" | "allowed" | "required";

/**
 * Aster 会话信息（匹配后端 SessionInfo 结构）
 */
export interface AsterSessionInfo {
  id: string;
  name?: string;
  created_at: number;
  updated_at: number;
  messages_count?: number;
  execution_strategy?: AsterExecutionStrategy;
}

/**
 * TauriMessageContent（匹配后端 TauriMessageContent 枚举）
 */
export interface TauriMessageContent {
  type: string;
  text?: string;
  id?: string;
  action_type?: string;
  data?: unknown;
  tool_name?: string;
  arguments?: unknown;
  success?: boolean;
  output?: string;
  error?: string;
  images?: ToolResultImage[];
  mime_type?: string;
}

/**
 * Aster 会话详情（匹配后端 SessionDetail 结构）
 */
export interface AsterSessionDetail {
  id: string;
  thread_id?: string;
  name?: string;
  created_at: number;
  updated_at: number;
  execution_strategy?: AsterExecutionStrategy;
  messages: Array<{
    id?: string;
    role: string;
    content: TauriMessageContent[];
    timestamp: number;
  }>;
  turns?: AgentThreadTurn[];
  items?: AgentThreadItem[];
  queued_turns?: QueuedTurnSnapshot[];
}

export interface AgentTurnConfigSnapshot {
  provider_config?: AsterProviderConfig;
  execution_strategy?: AsterExecutionStrategy;
  web_search?: boolean;
  search_mode?: AgentSearchMode;
  auto_continue?: AutoContinueRequestPayload;
  system_prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeSubmitTurnRequest {
  message: string;
  session_id: string;
  event_name: string;
  workspace_id: string;
  images?: ImageInput[];
  turn_config?: AgentTurnConfigSnapshot;
  queue_if_busy?: boolean;
  queued_turn_id?: string;
}

export interface AgentRuntimeInterruptTurnRequest {
  session_id: string;
  turn_id?: string;
}

export interface AgentRuntimeRemoveQueuedTurnRequest {
  session_id: string;
  queued_turn_id: string;
}

export interface AgentRuntimeRespondActionRequest {
  session_id: string;
  request_id: string;
  action_type: "tool_confirmation" | "ask_user" | "elicitation";
  confirmed: boolean;
  response?: string;
  user_data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeUpdateSessionRequest {
  session_id: string;
  name?: string;
  execution_strategy?: AsterExecutionStrategy;
}

interface InvokeAsterChatStreamOptions {
  message: string;
  sessionId: string;
  eventName: string;
  workspaceId: string;
  images?: ImageInput[];
  providerConfig?: AsterProviderConfig;
  executionStrategy?: AsterExecutionStrategy;
  webSearch?: boolean;
  searchMode?: AgentSearchMode;
  autoContinue?: AutoContinueRequestPayload;
  systemPrompt?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

const invokeAsterChatStream = async ({
  message,
  sessionId,
  eventName,
  workspaceId,
  images,
  providerConfig,
  executionStrategy,
  webSearch,
  searchMode,
  autoContinue,
  systemPrompt,
  projectId,
  metadata,
}: InvokeAsterChatStreamOptions): Promise<void> => {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId, projectId);

  return await safeInvoke("aster_agent_chat_stream", {
    request: {
      message,
      session_id: sessionId,
      event_name: eventName,
      images,
      provider_config: providerConfig,
      project_id: projectId,
      workspace_id: resolvedWorkspaceId,
      execution_strategy: executionStrategy,
      web_search: webSearch,
      search_mode: searchMode,
      auto_continue: autoContinue,
      system_prompt: systemPrompt,
      metadata,
    },
  });
};

export async function submitAgentRuntimeTurn(
  request: AgentRuntimeSubmitTurnRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_submit_turn", { request });
}

export async function interruptAgentRuntimeTurn(
  request: AgentRuntimeInterruptTurnRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_interrupt_turn", { request });
}

export async function removeAgentRuntimeQueuedTurn(
  request: AgentRuntimeRemoveQueuedTurnRequest,
): Promise<boolean> {
  return await safeInvoke("agent_runtime_remove_queued_turn", { request });
}

export async function respondAgentRuntimeAction(
  request: AgentRuntimeRespondActionRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_respond_action", { request });
}

export async function createAgentRuntimeSession(
  workspaceId: string,
  name?: string,
  executionStrategy?: AsterExecutionStrategy,
): Promise<string> {
  return await safeInvoke("agent_runtime_create_session", {
    workspaceId: requireWorkspaceId(workspaceId),
    name,
    executionStrategy,
  });
}

export async function listAgentRuntimeSessions(): Promise<AsterSessionInfo[]> {
  return await safeInvoke("agent_runtime_list_sessions");
}

export async function getAgentRuntimeSession(
  sessionId: string,
): Promise<AsterSessionDetail> {
  const detail = await safeInvoke("agent_runtime_get_session", { sessionId });
  return {
    ...(detail as AsterSessionDetail),
    queued_turns: normalizeQueuedTurnSnapshots(
      (detail as AsterSessionDetail | null | undefined)?.queued_turns,
    ),
  };
}

export async function updateAgentRuntimeSession(
  request: AgentRuntimeUpdateSessionRequest,
): Promise<void> {
  return await safeInvoke("agent_runtime_update_session", { request });
}

export async function deleteAgentRuntimeSession(
  sessionId: string,
): Promise<void> {
  return await safeInvoke("agent_runtime_delete_session", { sessionId });
}

/**
 * 启动 Agent（初始化原生 Agent）
 */
export async function startAgentProcess(): Promise<AgentProcessStatus> {
  return await safeInvoke("agent_start_process", {});
}

/**
 * 停止 Agent
 */
export async function stopAgentProcess(): Promise<void> {
  return await safeInvoke("agent_stop_process");
}

/**
 * 获取 Agent 状态
 */
export async function getAgentProcessStatus(): Promise<AgentProcessStatus> {
  return await safeInvoke("agent_get_process_status");
}

/**
 * 创建 Agent 会话
 */
export async function createAgentSession(
  providerType: string,
  workspaceId: string,
  model?: string,
  systemPrompt?: string,
  skills?: SkillInfo[],
  executionStrategy?: AsterExecutionStrategy,
): Promise<CreateSessionResponse> {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  return await safeInvoke("agent_create_session", {
    providerType,
    model,
    systemPrompt,
    skills,
    workspaceId: resolvedWorkspaceId,
    executionStrategy,
  });
}

/**
 * 获取会话列表
 */
export async function listAgentSessions(): Promise<SessionInfo[]> {
  return await safeInvoke("agent_list_sessions");
}

/**
 * 获取会话详情
 */
export async function getAgentSession(sessionId: string): Promise<SessionInfo> {
  return await safeInvoke("agent_get_session", {
    sessionId,
  });
}

/**
 * 删除会话
 */
export async function deleteAgentSession(sessionId: string): Promise<void> {
  return await safeInvoke("agent_delete_session", {
    sessionId,
  });
}

/**
 * Agent 消息内容类型
 */
export type AgentMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
    >;

/**
 * 工具调用
 */
export interface AgentToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Agent 消息
 */
export interface AgentMessage {
  role: string;
  content: AgentMessageContent;
  timestamp: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

/**
 * 获取会话消息列表
 */
export async function getAgentSessionMessages(
  sessionId: string,
): Promise<AgentMessage[]> {
  return await safeInvoke("agent_get_session_messages", {
    sessionId,
  });
}

/**
 * 重命名会话（更新标题）
 */
export async function renameAgentSession(
  sessionId: string,
  title: string,
): Promise<void> {
  return await safeInvoke("agent_rename_session", {
    sessionId,
    title,
  });
}

/**
 * 生成智能标题
 */
export async function generateAgentTitle(sessionId: string): Promise<string> {
  return await safeInvoke("agent_generate_title", {
    sessionId,
  });
}

/**
 * 初始化 Aster Agent
 */
export async function initAsterAgent(): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_init");
}

/**
 * 获取 Aster Agent 状态
 */
export async function getAsterAgentStatus(): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_status");
}

/**
 * 配置 Aster Agent 的 Provider
 */
export async function configureAsterProvider(
  config: AsterProviderConfig,
  sessionId: string,
): Promise<AsterAgentStatus> {
  return await safeInvoke("aster_agent_configure_provider", {
    request: config,
    session_id: sessionId,
  });
}

/**
 * 发送消息到 Aster Agent (流式响应)
 *
 * 通过 Tauri 事件接收响应流
 */
export async function sendAsterMessageStream(
  message: string,
  sessionId: string,
  eventName: string,
  workspaceId: string,
  images?: ImageInput[],
  providerConfig?: AsterProviderConfig,
  executionStrategy?: AsterExecutionStrategy,
  webSearch?: boolean,
  autoContinue?: AutoContinueRequestPayload,
  systemPrompt?: string,
  projectId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return await invokeAsterChatStream({
    message,
    sessionId,
    eventName,
    workspaceId,
    images,
    providerConfig,
    executionStrategy,
    webSearch,
    autoContinue,
    systemPrompt,
    projectId,
    metadata,
  });
}

/**
 * 停止 Aster Agent 会话
 */
export async function stopAsterSession(sessionId: string): Promise<boolean> {
  return await safeInvoke("aster_agent_stop", { sessionId });
}

/**
 * 创建 Aster 会话
 */
export async function createAsterSession(
  workspaceId: string,
  workingDir?: string,
  name?: string,
  executionStrategy?: AsterExecutionStrategy,
): Promise<string> {
  const resolvedWorkspaceId = requireWorkspaceId(workspaceId);

  return await safeInvoke("aster_session_create", {
    workingDir,
    workspaceId: resolvedWorkspaceId,
    name,
    executionStrategy,
  });
}

/**
 * 获取 Aster 会话列表
 */
export async function listAsterSessions(): Promise<AsterSessionInfo[]> {
  return await safeInvoke("aster_session_list");
}

/**
 * 获取 Aster 会话详情
 */
export async function getAsterSession(
  sessionId: string,
): Promise<AsterSessionDetail> {
  const detail = await safeInvoke("aster_session_get", { sessionId });
  return {
    ...(detail as AsterSessionDetail),
    queued_turns: normalizeQueuedTurnSnapshots(
      (detail as AsterSessionDetail | null | undefined)?.queued_turns,
    ),
  };
}

/**
 * 重命名 Aster 会话
 */
export async function renameAsterSession(
  sessionId: string,
  name: string,
): Promise<void> {
  return await safeInvoke("aster_session_rename", { sessionId, name });
}

/**
 * 设置 Aster 会话执行策略
 */
export async function setAsterSessionExecutionStrategy(
  sessionId: string,
  executionStrategy: AsterExecutionStrategy,
): Promise<void> {
  return await safeInvoke("aster_session_set_execution_strategy", {
    sessionId,
    executionStrategy,
  });
}

/**
 * 删除 Aster 会话
 */
export async function deleteAsterSession(sessionId: string): Promise<void> {
  return await safeInvoke("aster_session_delete", { sessionId });
}

/**
 * 确认 Aster Agent 权限请求
 */
export async function confirmAsterAction(
  requestId: string,
  confirmed: boolean,
  response?: string,
): Promise<void> {
  return await safeInvoke("aster_agent_confirm", {
    request: {
      request_id: requestId,
      confirmed,
      response,
    },
  });
}

/**
 * 提交 Aster Agent elicitation 响应
 */
export async function submitAsterElicitationResponse(
  sessionId: string,
  requestId: string,
  userData: unknown,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return await safeInvoke("aster_agent_submit_elicitation_response", {
    sessionId,
    request: {
      request_id: requestId,
      user_data: userData,
      metadata,
    },
  });
}

/**
 * 终端命令请求（从后端发送到前端）
 */
export interface TerminalCommandRequest {
  /** 请求 ID */
  request_id: string;
  /** 要执行的命令 */
  command: string;
  /** 工作目录（可选） */
  working_dir?: string;
  /** 超时时间（秒） */
  timeout_secs: number;
}

/**
 * 终端命令响应（从前端发送到后端）
 */
export interface TerminalCommandResponse {
  /** 请求 ID */
  request_id: string;
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息 */
  error?: string;
  /** 退出码 */
  exit_code?: number;
  /** 是否被用户拒绝 */
  rejected: boolean;
}

/**
 * 发送终端命令响应到后端
 *
 * 当用户批准或拒绝命令后，调用此函数将结果发送给 TerminalTool
 */
export async function sendTerminalCommandResponse(
  response: TerminalCommandResponse,
): Promise<void> {
  return await safeInvoke("agent_terminal_command_response", {
    requestId: response.request_id,
    success: response.success,
    output: response.output,
    error: response.error,
    exitCode: response.exit_code,
    rejected: response.rejected,
  });
}

/**
 * 终端滚动缓冲区请求（从后端发送到前端）
 */
export interface TermScrollbackRequest {
  /** 请求 ID */
  request_id: string;
  /** 终端会话 ID */
  session_id: string;
  /** 起始行号（可选，从 0 开始） */
  line_start?: number;
  /** 读取行数（可选） */
  count?: number;
}

/**
 * 终端滚动缓冲区响应（从前端发送到后端）
 */
export interface TermScrollbackResponse {
  /** 请求 ID */
  request_id: string;
  /** 是否成功 */
  success: boolean;
  /** 总行数 */
  total_lines: number;
  /** 实际返回的起始行号 */
  line_start: number;
  /** 实际返回的结束行号 */
  line_end: number;
  /** 输出内容 */
  content: string;
  /** 是否还有更多内容 */
  has_more: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 发送终端滚动缓冲区响应到后端
 *
 * 当前端读取终端输出历史后，调用此函数将结果发送给 TermScrollbackTool
 */
export async function sendTermScrollbackResponse(
  response: TermScrollbackResponse,
): Promise<void> {
  return await safeInvoke("agent_term_scrollback_response", {
    requestId: response.request_id,
    success: response.success,
    totalLines: response.total_lines,
    lineStart: response.line_start,
    lineEnd: response.line_end,
    content: response.content,
    hasMore: response.has_more,
    error: response.error,
  });
}

/**
 * 权限确认响应
 */
export interface PermissionResponse {
  /** 请求 ID */
  requestId: string;
  /** 是否确认 */
  confirmed: boolean;
  /** 响应内容（用户输入或选择的答案） */
  response?: string;
}

/**
 * 发送权限确认响应到后端
 *
 * 当用户确认或拒绝权限请求后，调用此函数将结果发送给 Agent
 */
export async function sendPermissionResponse(
  response: PermissionResponse,
): Promise<void> {
  return await safeInvoke("aster_agent_confirm", {
    request: {
      request_id: response.requestId,
      confirmed: response.confirmed,
      response: response.response,
    },
  });
}
