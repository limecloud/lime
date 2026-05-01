import type {
  AsterExecutionStrategy,
  AsterSessionInfo,
  AutoContinueRequestPayload,
} from "@/lib/api/agentRuntime";
import type {
  AgentRuntimeStatus,
  Message,
  MessageImage,
  WriteArtifactContext,
} from "../types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import { normalizeExecutionStrategy } from "./agentChatCoreUtils";
import { sanitizeMessageTextForPreview } from "../utils/internalImagePlaceholder";

export type TaskStatus = "draft" | "running" | "waiting" | "done" | "failed";
export type TaskStatusReason =
  | "default"
  | "workspace_error"
  | "user_action"
  | "tool_failure";

interface RecentSessionLabelSource {
  status: TaskStatus;
  statusReason?: TaskStatusReason;
  messagesCount?: number;
}

export interface Topic {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  workspaceId?: string | null;
  messagesCount: number;
  executionStrategy: AsterExecutionStrategy;
  status: TaskStatus;
  statusReason?: TaskStatusReason;
  lastPreview: string;
  isPinned: boolean;
  hasUnread: boolean;
  tag?: string | null;
  sourceSessionId: string;
}

export interface UseAsterAgentChatOptions {
  systemPrompt?: string;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  workspaceId: string;
  disableSessionRestore?: boolean;
  initialTopicsLoadMode?: "immediate" | "deferred";
  initialTopicsDeferredDelayMs?: number;
  getSyncedSessionRecentPreferences?: (
    sessionId: string,
  ) => ChatToolPreferences | null;
}

export interface SendMessageObserver {
  onTextDelta?: (delta: string, accumulated: string) => void;
  onComplete?: (content: string) => void;
  onError?: (message: string) => void;
}

export interface AssistantDraftState {
  content?: string;
  initialRuntimeStatus?: AgentRuntimeStatus;
  waitingRuntimeStatus?: AgentRuntimeStatus;
}

export interface SlashSkillRequest {
  images?: MessageImage[];
  requestContext?: Record<string, unknown>;
}

export interface SendMessageOptions {
  purpose?: Message["purpose"];
  observer?: SendMessageObserver;
  requestMetadata?: Record<string, unknown>;
  assistantDraft?: AssistantDraftState;
  displayContent?: string;
  skillRequest?: SlashSkillRequest;
  providerOverride?: string;
  modelOverride?: string;
  systemPromptOverride?: string;
  skipSessionRestore?: boolean;
  skipSessionStartHooks?: boolean;
  skipPreSubmitResume?: boolean;
}

export interface WorkspacePathMissingState {
  content: string;
  images: MessageImage[];
}

export interface AgentPreferences {
  providerType: string;
  model: string;
}

export interface AgentPreferenceKeys {
  providerKey: string;
  modelKey: string;
  migratedKey: string;
}

export interface SessionModelPreference {
  providerType: string;
  model: string;
}

export interface ClearMessagesOptions {
  showToast?: boolean;
  toastMessage?: string;
}

export interface LiveTaskSnapshot {
  updatedAt?: Date;
  messagesCount: number;
  status: TaskStatus;
  statusReason?: TaskStatusReason;
  lastPreview: string;
  hasUnread: boolean;
}

export interface LiveTaskStatusDescriptor {
  status: TaskStatus;
  statusReason: TaskStatusReason;
}

export type SendMessageFn = (
  content: string,
  images: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  skipUserMessage?: boolean,
  executionStrategyOverride?: AsterExecutionStrategy,
  modelOverride?: string,
  autoContinue?: AutoContinueRequestPayload,
  options?: SendMessageOptions,
) => Promise<void>;

export const getScopedStorageKey = (
  workspaceId: string | null | undefined,
  prefix: string,
): string => {
  const resolvedWorkspaceId = workspaceId?.trim();
  return `${prefix}_${resolvedWorkspaceId || "global"}`;
};

function normalizeTaskPreviewText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 96);
}

function extractMessageTextContent(message: Message): string {
  const sanitizedContent = sanitizeMessageTextForPreview(
    message.content || "",
    {
      role: message.role,
      hasImages: Array.isArray(message.images) && message.images.length > 0,
    },
  );
  if (sanitizedContent) {
    return normalizeTaskPreviewText(sanitizedContent);
  }

  const partText = message.contentParts
    ?.filter(
      (
        part,
      ): part is Extract<
        (typeof message.contentParts)[number],
        { type: "text" | "thinking" }
      > => part.type === "text" || part.type === "thinking",
    )
    .map((part) =>
      part.type === "text"
        ? sanitizeMessageTextForPreview(part.text, {
            role: message.role,
            hasImages:
              Array.isArray(message.images) && message.images.length > 0,
          })
        : part.text,
    )
    .filter(Boolean)
    .join(" ");

  return normalizeTaskPreviewText(partText || "");
}

function extractToolCallPreview(message: Message): string {
  const latestToolCall = [...(message.toolCalls || [])].reverse().find(Boolean);
  if (!latestToolCall) {
    return "";
  }

  const toolName = latestToolCall.name?.trim() || "工具";
  if (latestToolCall.status === "failed") {
    return `执行失败：${toolName}`;
  }
  if (latestToolCall.status === "running") {
    return `正在执行：${toolName}`;
  }
  return `最近执行：${toolName}`;
}

function extractActionRequestPreview(message: Message): string {
  const pendingAction = [...(message.actionRequests || [])]
    .reverse()
    .find((item) => item.status !== "submitted");
  if (!pendingAction) {
    return "";
  }

  const questionText = pendingAction.questions
    ?.map((question) => question.question || question.header || "")
    .join(" ");

  return normalizeTaskPreviewText(
    pendingAction.prompt || questionText || "等待你确认或补充信息后继续执行。",
  );
}

function resolveLatestPendingAction(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const pendingAction = [...(messages[index].actionRequests || [])]
      .reverse()
      .find((item) => item.status !== "submitted");
    if (pendingAction) {
      return pendingAction;
    }
  }

  return null;
}

function resolvePendingActionStatusReason(
  _pendingAction: NonNullable<ReturnType<typeof resolveLatestPendingAction>>,
): TaskStatusReason {
  return "user_action";
}

export function extractTaskPreviewFromMessages(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const actionPreview = extractActionRequestPreview(message);
    if (actionPreview) {
      return actionPreview;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const textContent = extractMessageTextContent(message);
    if (textContent) {
      return textContent;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const toolPreview = extractToolCallPreview(message);
    if (toolPreview) {
      return toolPreview;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const runtimeDetail = normalizeTaskPreviewText(
      `${message.runtimeStatus?.title || ""} ${message.runtimeStatus?.detail || ""}`,
    );
    if (runtimeDetail) {
      return runtimeDetail;
    }
  }

  return "";
}

export function deriveTaskStatusFromLiveState(params: {
  messages: Message[];
  isSending: boolean;
  pendingActionCount: number;
  queuedTurnCount?: number;
  threadStatus?: string | null;
  workspaceError: boolean;
}): TaskStatus {
  return deriveTaskLiveState(params).status;
}

export function deriveTaskLiveState(params: {
  messages: Message[];
  isSending: boolean;
  pendingActionCount: number;
  queuedTurnCount?: number;
  threadStatus?: string | null;
  workspaceError: boolean;
}): LiveTaskStatusDescriptor {
  const {
    messages,
    isSending,
    pendingActionCount,
    queuedTurnCount = 0,
    threadStatus = null,
    workspaceError,
  } = params;

  if (workspaceError) {
    return {
      status: "failed",
      statusReason: "workspace_error",
    };
  }

  if (
    isSending ||
    queuedTurnCount > 0 ||
    threadStatus === "running" ||
    threadStatus === "queued"
  ) {
    return {
      status: "running",
      statusReason: "default",
    };
  }

  const pendingAction = resolveLatestPendingAction(messages);
  if (pendingActionCount > 0 || pendingAction) {
    return {
      status: "waiting",
      statusReason: pendingAction
        ? resolvePendingActionStatusReason(pendingAction)
        : "user_action",
    };
  }

  if (messages.length === 0) {
    return {
      status: "draft",
      statusReason: "default",
    };
  }

  const latestMessage = messages[messages.length - 1];
  const latestToolFailed = latestMessage?.toolCalls?.some(
    (item) => item.status === "failed",
  );
  if (latestToolFailed) {
    return {
      status: "failed",
      statusReason: "tool_failure",
    };
  }

  if (latestMessage?.role === "user") {
    return {
      status: "running",
      statusReason: "default",
    };
  }

  return {
    status: "done",
    statusReason: "default",
  };
}

export function buildLiveTaskSnapshot(params: {
  messages: Message[];
  isSending: boolean;
  pendingActionCount: number;
  queuedTurnCount?: number;
  threadStatus?: string | null;
  workspaceError: boolean;
}): LiveTaskSnapshot {
  const {
    messages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    threadStatus,
    workspaceError,
  } = params;
  const lastMessage = messages[messages.length - 1];
  const preview = extractTaskPreviewFromMessages(messages);
  const taskState = deriveTaskLiveState({
    messages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    threadStatus,
    workspaceError,
  });

  return {
    updatedAt: lastMessage?.timestamp,
    messagesCount: messages.length,
    status: taskState.status,
    statusReason: taskState.statusReason,
    lastPreview: preview || "等待你补充任务需求后开始执行。",
    hasUnread: false,
  };
}

function resolveRecentTopicPriority(topic: RecentSessionLabelSource): number {
  if (topic.status === "waiting") {
    return 0;
  }

  if (topic.status === "failed" && topic.statusReason === "workspace_error") {
    return 1;
  }

  if (topic.status === "running") {
    return 2;
  }

  if (topic.status === "done") {
    return 3;
  }

  if (topic.status === "failed") {
    return 4;
  }

  if ((topic.messagesCount ?? 0) > 0) {
    return 5;
  }

  return 6;
}

export function resolveRecentTopicCandidate(
  topics: Topic[],
  currentTopicId?: string | null,
): Topic | null {
  const candidates = topics.filter(
    (topic) => topic.id.trim() && topic.id !== currentTopicId,
  );

  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    const priorityDiff =
      resolveRecentTopicPriority(left) - resolveRecentTopicPriority(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime();
    if (updatedDiff !== 0) {
      return updatedDiff;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });

  const actionable = sorted.find(
    (topic) => topic.status !== "draft" || topic.messagesCount > 0,
  );

  return actionable ?? sorted[0] ?? null;
}

export function resolveRecentTopicActionLabel(
  topic: RecentSessionLabelSource,
): string {
  switch (topic.status) {
    case "done":
      return "回看最近结果";
    case "draft":
      return "打开最近会话";
    default:
      return "继续最近会话";
  }
}

export const mapSessionToTopic = (session: AsterSessionInfo): Topic => {
  const updatedAtEpoch = Number.isFinite(session.updated_at)
    ? session.updated_at
    : session.created_at;
  const messagesCount = session.messages_count ?? 0;

  return {
    id: session.id,
    title:
      session.name ||
      `任务 ${new Date(session.created_at * 1000).toLocaleDateString("zh-CN")}`,
    createdAt: new Date(session.created_at * 1000),
    updatedAt: new Date(updatedAtEpoch * 1000),
    workspaceId: normalizeProjectId(session.workspace_id),
    messagesCount,
    executionStrategy: normalizeExecutionStrategy(session.execution_strategy),
    status: messagesCount > 0 ? "done" : "draft",
    statusReason: "default",
    lastPreview:
      messagesCount > 0
        ? `已记录 ${messagesCount} 条消息，可继续补充或接着推进。`
        : "等待你补充任务需求后开始执行。",
    isPinned: false,
    hasUnread: false,
    tag: null,
    sourceSessionId: session.id,
  };
};
