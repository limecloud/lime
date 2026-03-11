/**
 * Stores 导出
 *
 * @deprecated `agentStore` 属于遗留导出，请不要在新代码中继续依赖。
 */

// Aster Agent Store
export {
  useAgentStore,
  useAgentMessages,
  useAgentStreaming,
  useAgentSessions,
  usePendingActions,
  type Message,
  type MessageImage,
  type ToolResult,
  type ToolCallState,
  type TokenUsage,
  type ContentPart,
  type SessionInfo,
  type ActionRequired,
  type ConfirmResponse,
  type TauriAgentEvent,
} from "./agentStore";
