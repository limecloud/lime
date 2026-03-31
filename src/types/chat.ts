/**
 * @file chat.ts
 * @description 统一对话系统类型定义
 * @module types/chat
 *
 * 定义了统一对话系统的核心类型，支持多种对话模式：
 * - Agent: AI Agent 模式，支持工具调用
 * - General: 通用对话模式，纯文本
 * - Workbench: 工作台模式，支持画布输出
 */

// ============================================================================
// 基础类型
// ============================================================================

/** 对话模式 */
export type ChatMode = "agent" | "general" | "workbench";

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

/** 消息状态 */
export type MessageStatus = "pending" | "streaming" | "complete" | "error";

// ============================================================================
// 会话类型
// ============================================================================

/** 统一会话结构 */
export interface ChatSession {
  /** 会话 ID */
  id: string;
  /** 对话模式 */
  mode: ChatMode;
  /** 会话标题 */
  title?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 模型名称 */
  model?: string;
  /** Provider 类型 */
  providerType?: string;
  /** 凭证 UUID */
  credentialUuid?: string;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 消息数量 */
  messageCount?: number;
}

// ============================================================================
// 消息类型
// ============================================================================

/** 消息内容块类型 */
export type ContentBlockType =
  | "text"
  | "image"
  | "file"
  | "canvas"
  | "tool_result";

/** 文本内容块 */
export interface TextContentBlock {
  type: "text";
  text: string;
}

/** 图片内容块 */
export interface ImageContentBlock {
  type: "image";
  url: string;
  alt?: string;
}

/** 文件内容块 */
export interface FileContentBlock {
  type: "file";
  path: string;
  name: string;
}

/** 画布内容块 */
export interface CanvasContentBlock {
  type: "canvas";
  canvasType: string;
  content: string;
}

/** 工具结果内容块 */
export interface ToolResultContentBlock {
  type: "tool_result";
  toolCallId: string;
  result: unknown;
}

/** 内容块联合类型 */
export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | FileContentBlock
  | CanvasContentBlock
  | ToolResultContentBlock;

/** 工具调用状态 */
export type ToolCallStatus = "pending" | "running" | "completed" | "failed";

/** 工具调用信息 */
export interface ToolCall {
  id: string;
  name: string;
  arguments?: string;
  status: ToolCallStatus;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
  startTime?: Date;
  endTime?: Date;
}

/** 统一消息结构 */
export interface ChatMessage {
  /** 消息 ID */
  id: string | number;
  /** 会话 ID */
  sessionId: string;
  /** 角色 */
  role: MessageRole;
  /** 文本内容（便捷访问） */
  content: string;
  /** 结构化内容块 */
  contentBlocks?: ContentBlock[];
  /** 工具调用列表 */
  toolCalls?: ToolCall[];
  /** 工具调用 ID（用于工具响应） */
  toolCallId?: string;
  /** 消息状态 */
  status: MessageStatus;
  /** 错误信息 */
  error?: ChatError;
  /** 扩展元数据 */
  metadata?: MessageMetadata;
  /** 创建时间 */
  createdAt: string | Date;
}

/** 消息元数据 */
export interface MessageMetadata {
  /** 使用的模型 */
  model?: string;
  /** Token 使用量 */
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  /** 响应耗时（毫秒） */
  duration?: number;
  /** 其他自定义数据 */
  [key: string]: unknown;
}

// ============================================================================
// 错误类型
// ============================================================================

/** 错误类型 */
export type ChatErrorType =
  | "network"
  | "auth"
  | "rate_limit"
  | "quota"
  | "invalid_request"
  | "server"
  | "unknown";

/** 错误信息 */
export interface ChatError {
  type: ChatErrorType;
  message: string;
  code?: string;
  retryable: boolean;
}

// ============================================================================
// 图片输入类型
// ============================================================================

/** 图片输入 */
export interface ImageInput {
  /** Base64 编码的图片数据 */
  data: string;
  /** MIME 类型 */
  mediaType: string;
}

// ============================================================================
// API 请求/响应类型
// ============================================================================

/** 创建会话请求 */
export interface CreateSessionRequest {
  mode: ChatMode;
  title?: string;
  systemPrompt?: string;
  providerType?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

/** 发送消息请求 */
export interface SendMessageRequest {
  sessionId: string;
  message: string;
  eventName: string;
  images?: Array<{ data: string; media_type: string }>;
  webSearch?: boolean;
}

/** 会话响应 */
export interface SessionResponse {
  id: string;
  mode: ChatMode;
  title?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Harness 产物快照 */
export interface HarnessArtifactSnapshot {
  artifactId: string;
  filePath?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/** Harness 领域事件 */
export interface HarnessEventPayload {
  kind: string;
  sessionId?: string;
  runId?: string;
  correlationId?: string;
  theme?: string;
  stage?: string;
  summary?: string;
  artifact?: HarnessArtifactSnapshot;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// 流式事件类型
// ============================================================================

/** 流式事件类型 */
export type StreamEventType =
  | "text_delta"
  | "thinking_delta"
  | "tool_start"
  | "tool_end"
  | "harness_event"
  | "artifact_snapshot"
  | "action_required"
  | "done"
  | "final_done"
  | "error";

/** 文本增量事件 */
export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

/** 思考增量事件 */
export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  text: string;
}

/** 工具开始事件 */
export interface ToolStartEvent {
  type: "tool_start";
  tool_id: string;
  tool_name: string;
  arguments?: string;
}

/** 工具结束事件 */
export interface ToolEndEvent {
  type: "tool_end";
  tool_id: string;
  result: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

/** 权限请求事件 */
export interface ActionRequiredEvent {
  type: "action_required";
  request_id: string;
  action_type: string;
  tool_name?: string;
  arguments?: string;
  prompt?: string;
  questions?: unknown[];
  requested_schema?: unknown;
}

/** Harness 事件 */
export interface HarnessEvent {
  type: "harness_event";
  event: HarnessEventPayload;
}

/** 产物快照事件 */
export interface ArtifactSnapshotEvent {
  type: "artifact_snapshot";
  artifact: HarnessArtifactSnapshot;
}

/** 完成事件 */
export interface DoneEvent {
  type: "done";
}

/** 最终完成事件 */
export interface FinalDoneEvent {
  type: "final_done";
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/** 错误事件 */
export interface ErrorEvent {
  type: "error";
  message: string;
}

/** 流式事件联合类型 */
export type StreamEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | HarnessEvent
  | ArtifactSnapshotEvent
  | ActionRequiredEvent
  | DoneEvent
  | FinalDoneEvent
  | ErrorEvent;
