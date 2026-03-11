/**
 * Agent 流式事件与 UI 类型
 *
 * 聚合现役 Agent / Aster 流式协议的前端可消费类型与解析器。
 */

/**
 * Token 使用量统计
 * Requirements: 9.5 - THE Frontend SHALL display token usage statistics after each Agent response
 */
export interface TokenUsage {
  /** 输入 token 数 */
  input_tokens: number;
  /** 输出 token 数 */
  output_tokens: number;
}

/**
 * 工具执行结果图片
 * Requirements: 9.2 - THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface ToolResultImage {
  src: string;
  mimeType?: string;
  origin?: "data_url" | "tool_payload" | "file_path";
}

export type ToolResultMetadata = Record<string, unknown>;

/**
 * 工具执行结果
 * Requirements: 9.2 - THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息（如果失败） */
  error?: string;
  /** 工具返回的图片（可选） */
  images?: ToolResultImage[];
  /** 工具返回的结构化元数据（可选） */
  metadata?: ToolResultMetadata;
}

/**
 * 流式事件类型
 * Requirements: 9.1, 9.2, 9.3
 */
export type StreamEvent =
  | StreamEventTextDelta
  | StreamEventReasoningDelta
  | StreamEventToolStart
  | StreamEventToolEnd
  | StreamEventActionRequired
  | StreamEventContextTrace
  | StreamEventDone
  | StreamEventFinalDone
  | StreamEventWarning
  | StreamEventError;

/**
 * 文本增量事件
 * Requirements: 9.3 - THE Frontend SHALL distinguish between text responses and tool call responses visually
 */
export interface StreamEventTextDelta {
  type: "text_delta";
  text: string;
}

/**
 * 推理内容增量事件（DeepSeek reasoner 等模型的思考过程）
 * Requirements: 9.3 - THE Frontend SHALL distinguish between text responses and tool call responses visually
 */
export interface StreamEventReasoningDelta {
  type: "thinking_delta";
  text: string;
}

/**
 * 工具调用开始事件
 * Requirements: 9.1 - WHEN a tool is being executed, THE Frontend SHALL display a tool execution indicator with the tool name
 */
export interface StreamEventToolStart {
  type: "tool_start";
  /** 工具名称 */
  tool_name: string;
  /** 工具调用 ID */
  tool_id: string;
  /** 工具参数（JSON 字符串） */
  arguments?: string;
}

/**
 * 工具调用结束事件
 * Requirements: 9.2 - WHEN a tool completes, THE Frontend SHALL display a collapsible section showing the tool result
 */
export interface StreamEventToolEnd {
  type: "tool_end";
  /** 工具调用 ID */
  tool_id: string;
  /** 工具执行结果 */
  result: ToolExecutionResult;
}

/**
 * 权限确认请求事件
 * 当 Agent 需要用户确认某个操作时发送
 */
export interface StreamEventActionRequired {
  type: "action_required";
  /** 请求 ID */
  request_id: string;
  /** 操作类型 */
  action_type: "tool_confirmation" | "ask_user" | "elicitation";
  /** 工具名称（工具确认时） */
  tool_name?: string;
  /** 工具参数（工具确认时） */
  arguments?: Record<string, unknown>;
  /** 提示信息 */
  prompt?: string;
  /** 问题列表（ask_user 时） */
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
  }>;
  /** 请求的数据结构（elicitation 时） */
  requested_schema?: Record<string, unknown>;
}

export interface ContextTraceStep {
  stage: string;
  detail: string;
}

export interface StreamEventContextTrace {
  type: "context_trace";
  steps: ContextTraceStep[];
}

/**
 * 完成事件（单次 API 响应完成，工具循环可能继续）
 * Requirements: 9.5 - THE Frontend SHALL display token usage statistics after each Agent response
 */
export interface StreamEventDone {
  type: "done";
  /** Token 使用量（可选） */
  usage?: TokenUsage;
}

/**
 * 最终完成事件（整个对话完成，包括所有工具调用循环）
 * 前端收到此事件后才能取消监听
 */
export interface StreamEventFinalDone {
  type: "final_done";
  /** Token 使用量（可选） */
  usage?: TokenUsage;
}

/**
 * 错误事件
 */
export interface StreamEventError {
  type: "error";
  /** 错误信息 */
  message: string;
}

/**
 * 告警事件（不中断流程）
 */
export interface StreamEventWarning {
  type: "warning";
  /** 告警代码（可选） */
  code?: string;
  /** 告警信息 */
  message: string;
}

/**
 * 工具调用状态（用于 UI 显示）
 */
export interface ToolCallState {
  /** 工具调用 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数（JSON 字符串） */
  arguments?: string;
  /** 执行状态 */
  status: "running" | "completed" | "failed";
  /** 执行结果（完成后） */
  result?: ToolExecutionResult;
  /** 开始时间 */
  startTime: Date;
  /** 结束时间（完成后） */
  endTime?: Date;
  /** 执行日志（实时更新） */
  logs?: string[];
}

/**
 * 解析流式事件
 * @param data - 原始事件数据
 * @returns 解析后的流式事件
 */
export function parseStreamEvent(data: unknown): StreamEvent | null {
  if (!data || typeof data !== "object") return null;

  const event = data as Record<string, unknown>;
  const type = event.type as string;

  switch (type) {
    case "text_delta":
      return {
        type: "text_delta",
        text: (event.text as string) || "",
      };
    case "reasoning_delta":
    case "thinking_delta":
      return {
        type: "thinking_delta",
        text: (event.text as string) || "",
      };
    case "tool_start":
      return {
        type: "tool_start",
        tool_name: (event.tool_name as string) || "",
        tool_id: (event.tool_id as string) || "",
        arguments: event.arguments as string | undefined,
      };
    case "tool_end":
      return {
        type: "tool_end",
        tool_id: (event.tool_id as string) || "",
        result: event.result as ToolExecutionResult,
      };
    case "action_required": {
      const actionData =
        (event.data as Record<string, unknown> | undefined) || {};
      const requestId =
        (event.request_id as string | undefined) ||
        (actionData.request_id as string | undefined) ||
        (actionData.id as string | undefined) ||
        "";
      const actionType =
        (event.action_type as string | undefined) ||
        (actionData.action_type as string | undefined) ||
        (actionData.type as string | undefined) ||
        "tool_confirmation";

      return {
        type: "action_required",
        request_id: requestId,
        action_type: actionType as
          | "tool_confirmation"
          | "ask_user"
          | "elicitation",
        tool_name:
          (event.tool_name as string | undefined) ||
          (actionData.tool_name as string | undefined),
        arguments:
          (event.arguments as Record<string, unknown> | undefined) ||
          (actionData.arguments as Record<string, unknown> | undefined),
        prompt:
          (event.prompt as string | undefined) ||
          (actionData.prompt as string | undefined) ||
          (actionData.message as string | undefined),
        questions:
          (event.questions as
            | Array<{
                question: string;
                header?: string;
                options?: Array<{
                  label: string;
                  description?: string;
                }>;
                multiSelect?: boolean;
              }>
            | undefined) ||
          (actionData.questions as
            | Array<{
                question: string;
                header?: string;
                options?: Array<{
                  label: string;
                  description?: string;
                }>;
                multiSelect?: boolean;
              }>
            | undefined),
        requested_schema:
          (event.requested_schema as Record<string, unknown> | undefined) ||
          (actionData.requested_schema as Record<string, unknown> | undefined),
      };
    }
    case "done":
      return {
        type: "done",
        usage: event.usage as TokenUsage | undefined,
      };
    case "context_trace":
      return {
        type: "context_trace",
        steps: Array.isArray(event.steps)
          ? (event.steps as ContextTraceStep[])
          : [],
      };
    case "final_done":
      return {
        type: "final_done",
        usage: event.usage as TokenUsage | undefined,
      };
    case "error":
      return {
        type: "error",
        message: (event.message as string) || "Unknown error",
      };
    case "warning":
      return {
        type: "warning",
        code: event.code as string | undefined,
        message: (event.message as string) || "Unknown warning",
      };
    default:
      return null;
  }
}
