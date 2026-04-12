import type {
  AgentContextTraceStep as ContextTraceStep,
  AgentToolCallState as ToolCallState,
  AgentTokenUsage as TokenUsage,
} from "@/lib/api/agentProtocol";
import type { Artifact, ArtifactStatus } from "@/lib/artifact/types";
import { safeInvoke } from "@/lib/dev-bridge";

export type {
  AgentThreadItem,
  AgentThreadItemStatus,
  AgentThreadTurn,
} from "@/lib/api/agentProtocol";

export interface MessageImage {
  data: string;
  mediaType: string;
}

export interface MessageImageWorkbenchPreview {
  taskId: string;
  prompt: string;
  mode?: "generate" | "edit" | "variation";
  status: "running" | "complete" | "partial" | "failed" | "cancelled";
  projectId?: string | null;
  contentId?: string | null;
  imageUrl?: string | null;
  imageCount?: number;
  sourceImageUrl?: string | null;
  sourceImagePrompt?: string | null;
  sourceImageRef?: string | null;
  sourceImageCount?: number;
  size?: string;
  phase?: string | null;
  statusMessage?: string | null;
  retryable?: boolean;
  attemptCount?: number;
  placeholderText?: string | null;
}

export type MessageTaskPreviewStatus = MessageImageWorkbenchPreview["status"];

export interface MessageVideoTaskPreview {
  kind: "video_generate";
  taskId: string;
  taskType: "video_generate";
  prompt: string;
  status: MessageTaskPreviewStatus;
  projectId?: string | null;
  contentId?: string | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  providerId?: string | null;
  model?: string | null;
  progress?: number | null;
  phase?: string | null;
  statusMessage?: string | null;
  retryable?: boolean;
}

export interface MessageTaskPreviewImageCandidate {
  id: string;
  thumbnailUrl: string;
  contentUrl?: string | null;
  hostPageUrl?: string | null;
  width?: number;
  height?: number;
  name?: string;
}

export interface MessageGenericTaskPreview {
  kind:
    | "broadcast_generate"
    | "modal_resource_search"
    | "transcription_generate"
    | "url_parse"
    | "typesetting";
  taskId: string;
  taskType: MessageGenericTaskPreview["kind"];
  prompt: string;
  title?: string;
  status: MessageTaskPreviewStatus;
  projectId?: string | null;
  contentId?: string | null;
  artifactPath?: string | null;
  providerId?: string | null;
  model?: string | null;
  phase?: string | null;
  statusMessage?: string | null;
  retryable?: boolean;
  metaItems?: string[];
  imageCandidates?: MessageTaskPreviewImageCandidate[];
}

export type MessageTaskPreview =
  | MessageVideoTaskPreview
  | MessageGenericTaskPreview;

export type MessagePreviewTarget =
  | {
      kind: "image_workbench";
      preview: MessageImageWorkbenchPreview;
    }
  | {
      kind: "task";
      preview: MessageTaskPreview;
    };

/**
 * 内容片段类型（用于交错显示）
 *
 * 参考 aster 框架的 MessageContent 设计：
 * - text: 文本内容片段
 * - thinking: 推理内容片段（DeepSeek R1 等模型）
 * - tool_use: 工具调用（包含状态和结果）
 * - action_required: 权限确认请求
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolCall: ToolCallState }
  | { type: "action_required"; actionRequired: ActionRequired };

export type BrowserTaskRequirement =
  | "optional"
  | "required"
  | "required_with_user_step";

export interface SiteSavedContentTarget {
  projectId: string;
  contentId: string;
  title?: string;
  preferredTarget?: "saved_content" | "project_file";
  projectFile?: {
    relativePath: string;
  };
}

export type PendingA2UISource =
  | {
      kind: "assistant_message";
      messageId: string;
    }
  | {
      kind: "action_request";
      requestId: string;
    }
  | {
      kind: "scene_gate";
      gateKey: string;
      sceneKey: string;
      messageId?: undefined;
    }
  | {
      kind: "service_skill";
      skillId: string;
      requestKey: string;
      messageId?: undefined;
    };

// ============ 权限确认相关类型 ============

export interface ActionRequiredScope {
  sessionId?: string;
  threadId?: string;
  turnId?: string;
}

export interface ActionRequestGovernanceMeta {
  strategy: "single_turn_single_question";
  source: "runtime_action_required";
  originalQuestionCount?: number;
  originalFieldCount?: number;
  originalSectionCount?: number;
  retainedQuestionIndex?: number;
  retainedFieldKey?: string;
  retainedSectionIndex?: number;
  deferredQuestionCount?: number;
  deferredFieldCount?: number;
}

/** 权限确认请求类型 */
export interface ActionRequired {
  /** 请求 ID */
  requestId: string;
  /** 操作类型 */
  actionType: "tool_confirmation" | "ask_user" | "elicitation";
  /** 工具名称（tool_confirmation 类型） */
  toolName?: string;
  /** 工具参数（tool_confirmation 类型） */
  arguments?: Record<string, unknown>;
  /** 提示信息 */
  prompt?: string;
  /** 问题列表（ask_user 类型） */
  questions?: Question[];
  /** 请求的数据结构（elicitation 类型） */
  requestedSchema?: any;
  /** 运行时作用域（用于与 ask / elicitation 原始请求精确匹配） */
  scope?: ActionRequiredScope;
  /** 前端交互状态（用于保留已提交的 ask/elicitation 面板） */
  status?: "pending" | "queued" | "submitted";
  /** 是否为前端根据 Ask 工具调用生成的临时请求（尚未拿到真实 requestId） */
  isFallback?: boolean;
  /** 已提交的响应文本（用于展示回显） */
  submittedResponse?: string;
  /** 已提交的原始用户数据 */
  submittedUserData?: unknown;
  /** 附加说明 */
  detail?: string;
  /** 单轮澄清治理元数据 */
  governance?: ActionRequestGovernanceMeta;
}

/** 问题定义（用于 ask_user 类型） */
export interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

/** 问题选项 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** 权限确认响应 */
export interface ConfirmResponse {
  /** 请求 ID */
  requestId: string;
  /** 是否确认 */
  confirmed: boolean;
  /** 响应内容（用户输入或选择的答案） */
  response?: string;
  /** 操作类型（用于前端分流） */
  actionType?: ActionRequired["actionType"];
  /** 原始用户数据（用于 elicitation） */
  userData?: unknown;
}

export type ArtifactWriteSource =
  | "tool_start"
  | "artifact_snapshot"
  | "tool_result"
  | "message_content";

export type ArtifactWritePhase =
  | "preparing"
  | "streaming"
  | "persisted"
  | "completed"
  | "failed";

export interface ArtifactWriteMetadata extends Record<string, unknown> {
  writePhase?: ArtifactWritePhase;
  previewText?: string;
  latestChunk?: string;
  isPartial?: boolean;
  lastUpdateSource?: ArtifactWriteSource;
}

export interface WriteArtifactContext {
  artifact?: Artifact;
  artifactId?: string;
  source?: ArtifactWriteSource;
  sourceMessageId?: string;
  status?: ArtifactStatus;
  metadata?: ArtifactWriteMetadata;
}

export interface AgentRuntimeStatus {
  phase: "preparing" | "routing" | "context" | "failed" | "cancelled";
  title: string;
  detail: string;
  checkpoints?: string[];
  metadata?: {
    team_phase?: string;
    team_parallel_budget?: number;
    team_active_count?: number;
    team_queued_count?: number;
    concurrency_phase?: string;
    concurrency_scope?: string;
    concurrency_active_count?: number;
    concurrency_queued_count?: number;
    concurrency_budget?: number;
    provider_concurrency_group?: string;
    provider_parallel_budget?: number;
    queue_reason?: string;
    retryable_overload?: boolean;
  };
}

export interface BrowserAssistSessionState {
  sessionId?: string;
  profileKey?: string;
  url?: string;
  title?: string;
  targetId?: string;
  transportKind?: string;
  lifecycleState?: string;
  controlMode?: string;
  source: "tool_call" | "runtime_launch" | "artifact_restore";
  updatedAt: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  /** 完整文本内容（向后兼容） */
  content: string;
  images?: MessageImage[];
  timestamp: Date;
  isThinking?: boolean;
  thinkingContent?: string;
  search_results?: any[]; // For potential future use
  /** 工具调用列表（assistant 消息可能包含） - 向后兼容 */
  toolCalls?: ToolCallState[];
  /** Token 使用量（响应完成后） */
  usage?: TokenUsage;
  /** 权限确认请求列表 */
  actionRequests?: ActionRequired[];
  /**
   * 交错内容列表（按事件到达顺序排列）
   * 如果存在且非空，StreamingRenderer 会按顺序渲染
   * 否则回退到 content + toolCalls 渲染方式
   */
  contentParts?: ContentPart[];
  /** 上下文准备轨迹（可选） */
  contextTrace?: ContextTraceStep[];
  /** 与当前消息关联的产物列表 */
  artifacts?: Artifact[];
  /** 图片工作台消息卡预览 */
  imageWorkbenchPreview?: MessageImageWorkbenchPreview;
  /** 通用任务消息卡预览 */
  taskPreview?: MessageTaskPreview;
  /** 首个流式事件到达前的本地运行态 */
  runtimeStatus?: AgentRuntimeStatus;
  /** 消息用途（用于跳过特定副作用） */
  purpose?: "content_review" | "text_stylize" | "style_rewrite" | "style_audit";
}

export interface ChatSession {
  id: string;
  title: string;
  providerType: string;
  model: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export const PROVIDER_CONFIG: Record<
  string,
  { label: string; models: string[] }
> = {
  claude: {
    label: "Claude",
    models: [
      "claude-opus-4-5-20251101",
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
    ],
  },
  anthropic: {
    label: "Anthropic",
    models: [
      "claude-opus-4-5-20251101",
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
    ],
  },
  kiro: {
    label: "Kiro",
    models: [
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      "gpt-5.2",
      "gpt-5.2-codex",
      "gpt-5.1",
      "gpt-5.1-codex-max",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gpt-5",
      "gpt-5-pro",
      "gpt-5-codex",
      "gpt-5-codex-mini",
      "gpt-5-mini",
      "gpt-5-nano",
    ],
  },
  gemini: {
    label: "Gemini",
    models: ["gemini-3-pro-preview", "gemini-3-flash-preview"],
  },
  qwen: {
    label: "通义千问",
    models: ["qwen3-coder-plus", "qwen3-coder-flash"],
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-reasoner", "deepseek-chat"],
  },
  codex: {
    label: "Codex",
    models: [], // 从后端别名配置动态加载
  },
  claude_oauth: {
    label: "Claude OAuth",
    models: [
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
    ],
  },
  antigravity: {
    label: "Antigravity",
    models: [
      "gemini-3-pro-preview",
      "gemini-3-pro-image-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-flash",
      "gemini-2.5-computer-use-preview-10-2025",
      "gemini-claude-sonnet-4-5",
      "gemini-claude-sonnet-4-5-thinking",
      "gemini-claude-opus-4-5-thinking",
    ],
  },
  submodel: {
    label: "Submodel",
    models: [
      "openai/gpt-oss-120b",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
      "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8",
      "Qwen/Qwen3-235B-A22B-Thinking-2507",
      "deepseek-ai/DeepSeek-R1-0528",
      "deepseek-ai/DeepSeek-V3.1",
      "deepseek-ai/DeepSeek-V3-0324",
      "zai-org/GLM-4.5-FP8",
      "zai-org/GLM-4.5-Air",
    ],
  },
};

// ============ 动态模型配置 API ============

/** 简化的 Provider 配置（从后端返回） */
export interface SimpleProviderConfig {
  label: string;
  models: string[];
}

/** Provider 配置映射类型 */
export type ProviderConfigMap = Record<string, SimpleProviderConfig>;

/**
 * 从后端获取所有 Provider 的模型配置
 * 如果获取失败，返回默认的 PROVIDER_CONFIG
 */
export async function getProviderConfig(): Promise<ProviderConfigMap> {
  try {
    const config = await safeInvoke<ProviderConfigMap>(
      "get_all_provider_models",
    );
    return config;
  } catch (error) {
    console.warn("获取模型配置失败，使用默认配置:", error);
    return PROVIDER_CONFIG;
  }
}

/**
 * 获取指定 Provider 的模型列表
 */
export async function getProviderModels(provider: string): Promise<string[]> {
  try {
    const models = await safeInvoke<string[]>("get_provider_models", {
      provider,
    });
    return models;
  } catch (error) {
    console.warn(`获取 ${provider} 模型列表失败:`, error);
    return PROVIDER_CONFIG[provider]?.models ?? [];
  }
}
