/**
 * @file types.ts
 * @description Terminal AI 类型定义
 * @module components/terminal/ai/types
 *
 * 定义 Terminal AI 面板相关的所有类型
 */

import type { ToolCallState, TokenUsage } from "@/lib/api/agentStream";

/**
 * AI 消息图片
 */
export interface AIMessageImage {
  data: string;
  mediaType: string;
}

/**
 * 内容片段类型（用于交错显示）
 */
export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCall: ToolCallState };

/**
 * AI 消息
 */
export interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: AIMessageImage[];
  timestamp: Date;
  isThinking?: boolean;
  thinkingContent?: string;
  toolCalls?: ToolCallState[];
  usage?: TokenUsage;
  contentParts?: AIContentPart[];
}

/**
 * Terminal AI 配置
 */
export interface TerminalAIConfig {
  /** 是否启用终端上下文 */
  widgetContext: boolean;
  /** 上下文行数限制 */
  contextLines: number;
  /** 是否自动执行命令（不需要手动批准） */
  autoExecute: boolean;
}

/**
 * Terminal AI 面板状态
 */
export interface TerminalAIPanelState {
  /** 是否展开 */
  isOpen: boolean;
  /** 面板宽度 */
  width: number;
}

/**
 * 模型选择结果
 */
export interface ModelSelection {
  providerId: string;
  providerLabel: string;
  modelId: string;
}

/**
 * 待执行命令（用于 AI 控制终端）
 */
export interface PendingTerminalCommand {
  id: string;
  command: string;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "executing"
    | "completed"
    | "failed";
  createdAt: Date;
  executedAt?: Date;
  completedAt?: Date;
  error?: string;
  /** 工作目录（可选，来自后端请求） */
  workingDir?: string;
  /** 超时时间（秒，来自后端请求） */
  timeoutSecs?: number;
}

/**
 * Terminal AI Hook 返回值
 */
export interface UseTerminalAIReturn {
  // 状态
  messages: AIMessage[];
  isSending: boolean;
  config: TerminalAIConfig;

  // 模型选择
  providerId: string;
  setProviderId: (id: string) => void;
  modelId: string;
  setModelId: (id: string) => void;

  // 操作
  sendMessage: (content: string, images?: AIMessageImage[]) => Promise<void>;
  clearMessages: () => void;
  toggleWidgetContext: () => void;
  toggleAutoExecute: () => void;
  setContextLines: (lines: number) => void;

  // 终端上下文
  getTerminalContext: () => string | null;

  // 终端控制（新增）
  isTerminalConnected: boolean;
  pendingCommands: PendingTerminalCommand[];
  connectTerminal: (sessionId: string) => void;
  disconnectTerminal: () => void;
  sendCommandToTerminal: (command: string) => Promise<string>;
  approveCommand: (commandId: string) => Promise<void>;
  rejectCommand: (commandId: string) => Promise<void>;
}
