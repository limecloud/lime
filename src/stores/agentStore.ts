/**
 * Aster Agent Zustand Store
 *
 * 基于 Aster 框架的 Agent 状态管理
 * 参考 Claude-Cowork 的设计模式
 *
 * @deprecated 当前仓库已迁移到 `useAgentChat` / `useAsterAgentChat` 主链路；
 * 请不要在新代码中继续依赖这个遗留 store。
 */

import { create } from "zustand";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeListen } from "@/lib/dev-bridge";
import {
  confirmAsterAction,
  createAsterSession,
  deleteAsterSession,
  getAsterSession,
  initAsterAgent,
  listAsterSessions,
  sendAsterMessageStream,
  stopAsterSession,
  submitAsterElicitationResponse,
  type AsterSessionDetail,
} from "@/lib/api/agentRuntime";
import {
  parseStreamEvent,
  type StreamEvent,
  type ToolExecutionResult,
  type TokenUsage,
} from "@/lib/api/agentStream";
import { requireDefaultProjectId } from "@/lib/api/project";
import {
  isAsterSessionNotFoundError,
  resolveRestorableSessionId,
} from "@/lib/asterSessionRecovery";

// ============ 类型定义 ============

/** 消息图片 */
export interface MessageImage {
  data: string;
  mediaType: string;
}

/** 工具调用结果 */
export type ToolResult = ToolExecutionResult;
export type { TokenUsage } from "@/lib/api/agentStream";

/** 工具调用状态 */
export interface ToolCallState {
  id: string;
  name: string;
  arguments?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: ToolResult;
  startTime?: Date;
  endTime?: Date;
}

/** 内容片段类型 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolCall: ToolCallState };

/** 消息 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: MessageImage[];
  timestamp: Date;
  isThinking?: boolean;
  thinkingContent?: string;
  toolCalls?: ToolCallState[];
  usage?: TokenUsage;
  contentParts?: ContentPart[];
}

/** 会话信息 */
export interface SessionInfo {
  id: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  messagesCount: number;
}

/** 权限确认请求 */
export interface ActionRequired {
  requestId: string;
  actionType:
    | "tool_confirmation"
    | "ask_user"
    | "elicitation"
    | "permission_request";
  toolName?: string;
  arguments?: Record<string, unknown>;
  prompt?: string;
  requestedSchema?: Record<string, unknown>;
  options?: Array<{
    label: string;
    description?: string;
  }>;
  timestamp: Date;
}

/** 确认响应 */
export interface ConfirmResponse {
  requestId: string;
  confirmed: boolean;
  response?: string;
  actionType?: ActionRequired["actionType"];
  userData?: unknown;
}

// ============ Tauri 事件类型 ============

/** Tauri Agent 事件 */
export type TauriAgentEvent = StreamEvent;

// ============ Store 状态类型 ============

interface AgentState {
  currentSessionId: string | null;
  sessions: SessionInfo[];
  messages: Message[];
  isStreaming: boolean;
  currentAssistantMsgId: string | null;
  pendingActions: ActionRequired[];
  isInitialized: boolean;
  initialize: () => Promise<void>;
  sendMessage: (content: string, images?: MessageImage[]) => Promise<void>;
  stopStreaming: () => Promise<void>;
  confirmAction: (response: ConfirmResponse) => Promise<void>;
  switchSession: (sessionId: string) => Promise<void>;
  createSession: (name?: string) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  clearMessages: () => void;
  loadSessions: () => Promise<void>;
  _handleEvent: (event: StreamEvent) => void;
  _cleanup: () => void;
}

// ============ Store 实现 ============

let eventUnlisten: UnlistenFn | null = null;

const resolveDefaultWorkspaceId = async (): Promise<string> => {
  return requireDefaultProjectId("未找到默认工作区，请先创建并设为默认工作区");
};

const toRuntimeImages = (images?: MessageImage[]) =>
  images?.map((image) => ({
    data: image.data,
    media_type: image.mediaType,
  }));

const extractSessionMessageText = (
  content: AsterSessionDetail["messages"][number]["content"],
): string => {
  const segments = content
    .map((block) => {
      if (typeof block.text === "string" && block.text.trim()) {
        return block.text.trim();
      }
      if (typeof block.output === "string" && block.output.trim()) {
        return block.output.trim();
      }
      if (typeof block.error === "string" && block.error.trim()) {
        return `错误: ${block.error.trim()}`;
      }
      return "";
    })
    .filter(Boolean);

  return segments.join("\n\n");
};

export const useAgentStore = create<AgentState>((set, get) => ({
  currentSessionId: null,
  sessions: [],
  messages: [],
  isStreaming: false,
  currentAssistantMsgId: null,
  pendingActions: [],
  isInitialized: false,

  initialize: async () => {
    try {
      await initAsterAgent();
      set({ isInitialized: true });
      console.log("[AgentStore] Agent 初始化成功");
      await get().loadSessions();
    } catch (error) {
      console.error("[AgentStore] Agent 初始化失败:", error);
      throw error;
    }
  },

  sendMessage: async (content: string, images?: MessageImage[]) => {
    const state = get();

    if (!state.isInitialized) {
      await state.initialize();
    }

    let sessionId = state.currentSessionId;
    if (!sessionId) {
      sessionId = await state.createSession();
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      images,
      timestamp: new Date(),
    };

    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isThinking: true,
      thinkingContent: "思考中...",
      contentParts: [],
    };

    set((currentState) => ({
      messages: [...currentState.messages, userMsg, assistantMsg],
      isStreaming: true,
      currentAssistantMsgId: assistantMsgId,
    }));

    const eventName = `aster_stream_${assistantMsgId}`;

    try {
      const workspaceId = await resolveDefaultWorkspaceId();

      get()._cleanup();
      eventUnlisten = await safeListen<unknown>(eventName, (event) => {
        const parsedEvent = parseStreamEvent(event.payload);
        if (!parsedEvent) {
          return;
        }
        get()._handleEvent(parsedEvent);
      });

      await sendAsterMessageStream(
        content,
        sessionId,
        eventName,
        workspaceId,
        toRuntimeImages(images),
      );
    } catch (error) {
      console.error("[AgentStore] 发送消息失败:", error);

      set((currentState) => ({
        messages: currentState.messages.map((message) =>
          message.id === assistantMsgId
            ? {
                ...message,
                isThinking: false,
                content: `错误: ${error}`,
              }
            : message,
        ),
        isStreaming: false,
        currentAssistantMsgId: null,
      }));

      get()._cleanup();
      throw error;
    }
  },

  stopStreaming: async () => {
    const state = get();
    if (!state.currentSessionId) return;

    try {
      await stopAsterSession(state.currentSessionId);
    } catch (error) {
      console.error("[AgentStore] 停止失败:", error);
    }

    set((currentState) => ({
      messages: currentState.messages.map((message) =>
        message.id === currentState.currentAssistantMsgId
          ? {
              ...message,
              isThinking: false,
              content: message.content || "(已停止生成)",
            }
          : message,
      ),
      isStreaming: false,
      currentAssistantMsgId: null,
    }));

    get()._cleanup();
  },

  confirmAction: async (response: ConfirmResponse) => {
    try {
      const state = get();
      const actionType =
        response.actionType ||
        state.pendingActions.find(
          (item) => item.requestId === response.requestId,
        )?.actionType;

      if (actionType === "elicitation" || actionType === "ask_user") {
        if (!state.currentSessionId) {
          throw new Error("缺少会话 ID，无法提交 elicitation 响应");
        }

        let userData: unknown;
        if (!response.confirmed) {
          userData = "";
        } else if (response.userData !== undefined) {
          userData = response.userData;
        } else if (response.response !== undefined) {
          const rawResponse = response.response.trim();
          if (!rawResponse) {
            userData = "";
          } else {
            try {
              userData = JSON.parse(rawResponse);
            } catch {
              userData = rawResponse;
            }
          }
        } else {
          userData = "";
        }

        await submitAsterElicitationResponse(
          state.currentSessionId,
          response.requestId,
          userData,
        );
      } else {
        await confirmAsterAction(
          response.requestId,
          response.confirmed,
          response.response,
        );
      }

      set((currentState) => ({
        pendingActions: currentState.pendingActions.filter(
          (item) => item.requestId !== response.requestId,
        ),
      }));
    } catch (error) {
      console.error("[AgentStore] 确认失败:", error);
      throw error;
    }
  },

  switchSession: async (sessionId: string) => {
    try {
      const detail = await getAsterSession(sessionId);
      const messages: Message[] = detail.messages.map((message, index) => ({
        id: `${sessionId}-${index}`,
        role: message.role === "user" ? "user" : "assistant",
        content: extractSessionMessageText(message.content),
        timestamp: new Date(message.timestamp),
      }));

      set({
        currentSessionId: sessionId,
        messages,
        pendingActions: [],
        isStreaming: false,
        currentAssistantMsgId: null,
      });
    } catch (error) {
      console.error("[AgentStore] 切换会话失败:", error);
      if (isAsterSessionNotFoundError(error)) {
        try {
          const sessions = await listAsterSessions();
          const recoveredSessionId = resolveRestorableSessionId({
            candidateSessionId: null,
            sessions: sessions.map((item) => ({
              id: item.id,
              createdAt: item.created_at,
              updatedAt: item.updated_at,
            })),
          });

          if (recoveredSessionId && recoveredSessionId !== sessionId) {
            await get().switchSession(recoveredSessionId);
            return;
          }

          await get().createSession();
          set({
            messages: [],
            pendingActions: [],
            isStreaming: false,
            currentAssistantMsgId: null,
          });
          return;
        } catch (recoveryError) {
          console.error("[AgentStore] 恢复会话失败:", recoveryError);
        }
      }
      throw error;
    }
  },

  createSession: async (name?: string) => {
    try {
      const workspaceId = await resolveDefaultWorkspaceId();
      const sessionId = await createAsterSession(workspaceId, undefined, name);

      set((currentState) => ({
        currentSessionId: sessionId,
        messages: [],
        pendingActions: [],
        isStreaming: false,
        currentAssistantMsgId: null,
        sessions: [
          {
            id: sessionId,
            name,
            createdAt: new Date(),
            updatedAt: new Date(),
            messagesCount: 0,
          },
          ...currentState.sessions,
        ],
      }));

      return sessionId;
    } catch (error) {
      console.error("[AgentStore] 创建会话失败:", error);
      throw error;
    }
  },

  deleteSession: async (sessionId: string) => {
    await deleteAsterSession(sessionId);

    set((currentState) => ({
      sessions: currentState.sessions.filter(
        (session) => session.id !== sessionId,
      ),
      ...(currentState.currentSessionId === sessionId
        ? {
            currentSessionId: null,
            messages: [],
            pendingActions: [],
            isStreaming: false,
            currentAssistantMsgId: null,
          }
        : {}),
    }));
  },

  clearMessages: () => {
    set({
      messages: [],
      currentSessionId: null,
      pendingActions: [],
      isStreaming: false,
      currentAssistantMsgId: null,
    });
  },

  loadSessions: async () => {
    try {
      const sessions = await listAsterSessions();
      set({
        sessions: sessions.map((session) => ({
          id: session.id,
          name: session.name,
          createdAt: new Date(session.created_at),
          updatedAt: new Date(session.updated_at),
          messagesCount: session.messages_count || 0,
        })),
      });
    } catch (error) {
      console.error("[AgentStore] 加载会话列表失败:", error);
    }
  },

  _handleEvent: (event: StreamEvent) => {
    const state = get();
    const msgId = state.currentAssistantMsgId;
    if (!msgId) return;

    console.log("[AgentStore] 收到事件:", event.type, event);

    switch (event.type) {
      case "text_delta":
        set((currentState) => ({
          messages: currentState.messages.map((message) => {
            if (message.id !== msgId) return message;

            const nextContent = message.content + event.text;
            const nextParts = [...(message.contentParts || [])];
            const lastPart = nextParts[nextParts.length - 1];

            if (lastPart && lastPart.type === "text") {
              nextParts[nextParts.length - 1] = {
                type: "text",
                text: lastPart.text + event.text,
              };
            } else {
              nextParts.push({ type: "text", text: event.text });
            }

            return {
              ...message,
              content: nextContent,
              isThinking: false,
              thinkingContent: undefined,
              contentParts: nextParts,
            };
          }),
        }));
        break;

      case "thinking_delta":
        set((currentState) => ({
          messages: currentState.messages.map((message) => {
            if (message.id !== msgId) return message;

            const nextParts = [...(message.contentParts || [])];
            const lastPart = nextParts[nextParts.length - 1];

            if (lastPart && lastPart.type === "thinking") {
              nextParts[nextParts.length - 1] = {
                type: "thinking",
                text: lastPart.text + event.text,
              };
            } else {
              nextParts.push({ type: "thinking", text: event.text });
            }

            return {
              ...message,
              thinkingContent: (message.thinkingContent || "") + event.text,
              contentParts: nextParts,
            };
          }),
        }));
        break;

      case "tool_start": {
        const newToolCall: ToolCallState = {
          id: event.tool_id,
          name: event.tool_name,
          arguments: event.arguments,
          status: "running",
          startTime: new Date(),
        };

        set((currentState) => ({
          messages: currentState.messages.map((message) => {
            if (message.id !== msgId) return message;
            if (
              message.toolCalls?.find(
                (toolCall) => toolCall.id === event.tool_id,
              )
            ) {
              return message;
            }

            return {
              ...message,
              toolCalls: [...(message.toolCalls || []), newToolCall],
              contentParts: [
                ...(message.contentParts || []),
                { type: "tool_use", toolCall: newToolCall },
              ],
            };
          }),
        }));
        break;
      }

      case "tool_end":
        set((currentState) => ({
          messages: currentState.messages.map((message) => {
            if (message.id !== msgId) return message;

            const nextToolCalls = (message.toolCalls || []).map((toolCall) =>
              toolCall.id === event.tool_id
                ? {
                    ...toolCall,
                    status: event.result.success ? "completed" : "failed",
                    result: event.result,
                    endTime: new Date(),
                  }
                : toolCall,
            );

            const nextContentParts = (message.contentParts || []).map(
              (part) => {
                if (
                  part.type !== "tool_use" ||
                  part.toolCall.id !== event.tool_id
                ) {
                  return part;
                }

                return {
                  ...part,
                  toolCall: {
                    ...part.toolCall,
                    status: event.result.success ? "completed" : "failed",
                    result: event.result,
                    endTime: new Date(),
                  },
                };
              },
            );

            return {
              ...message,
              toolCalls: nextToolCalls,
              contentParts: nextContentParts,
            };
          }),
        }));
        break;

      case "action_required":
        set((currentState) => ({
          pendingActions: [
            ...currentState.pendingActions,
            {
              requestId: event.request_id,
              actionType: event.action_type as ActionRequired["actionType"],
              toolName: event.tool_name,
              arguments: event.arguments,
              prompt: event.prompt || event.questions?.[0]?.question,
              requestedSchema: event.requested_schema,
              options: event.questions?.[0]?.options,
              timestamp: new Date(),
            },
          ],
        }));
        break;

      case "done":
        console.log("[AgentStore] done 事件，等待 final_done...");
        break;

      case "final_done":
        set((currentState) => ({
          messages: currentState.messages.map((message) =>
            message.id === msgId
              ? {
                  ...message,
                  isThinking: false,
                  usage: event.usage,
                }
              : message,
          ),
          isStreaming: false,
          currentAssistantMsgId: null,
        }));
        get()._cleanup();
        break;

      case "error":
        set((currentState) => ({
          messages: currentState.messages.map((message) =>
            message.id === msgId
              ? {
                  ...message,
                  isThinking: false,
                  content: message.content || `错误: ${event.message}`,
                }
              : message,
          ),
          isStreaming: false,
          currentAssistantMsgId: null,
        }));
        get()._cleanup();
        break;

      case "warning":
        console.warn("[AgentStore] warning:", event.code, event.message);
        break;
    }
  },

  _cleanup: () => {
    const cleanup = eventUnlisten;
    eventUnlisten = null;
    cleanup?.();
  },
}));

export const useAgentMessages = () => useAgentStore((state) => state.messages);
export const useAgentStreaming = () =>
  useAgentStore((state) => state.isStreaming);
export const useAgentSessions = () => useAgentStore((state) => state.sessions);
export const usePendingActions = () =>
  useAgentStore((state) => state.pendingActions);
