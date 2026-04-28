/**
 * 模型注册表类型定义
 *
 * 借鉴 opencode 的模型管理方式，定义增强的模型元数据结构
 */

/** 模型能力 */
export interface ModelCapabilities {
  /** 是否支持视觉输入 */
  vision: boolean;
  /** 是否支持工具调用 */
  tools: boolean;
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 是否支持 JSON 模式 */
  json_mode: boolean;
  /** 是否支持函数调用 */
  function_calling: boolean;
  /** 是否支持推理/思考 */
  reasoning: boolean;
}

/** 模型任务族 */
export type ModelTaskFamily =
  | "chat"
  | "reasoning"
  | "vision_understanding"
  | "image_generation"
  | "image_edit"
  | "speech_to_text"
  | "text_to_speech"
  | "embedding"
  | "rerank"
  | "moderation";

/** 模型输入/输出模态 */
export type ModelModality =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "embedding"
  | "json";

/** 运行时特性 */
export type ModelRuntimeFeature =
  | "streaming"
  | "tool_calling"
  | "json_schema"
  | "reasoning"
  | "prompt_cache"
  | "responses_api"
  | "chat_completions_api"
  | "images_api";

/** 模型部署来源 */
export type ModelDeploymentSource = "local" | "user_cloud" | "oem_cloud";

/** 模型管理面 */
export type ModelManagementPlane =
  | "local_settings"
  | "oem_control_plane"
  | "hybrid";

/** 模型别名来源 */
export type ModelAliasSource = "official" | "relay" | "oem" | "local";

/** 模型定价 */
export interface ModelPricing {
  /** 输入价格（每百万 token） */
  input_per_million: number | null;
  /** 输出价格（每百万 token） */
  output_per_million: number | null;
  /** 缓存读取价格（每百万 token） */
  cache_read_per_million: number | null;
  /** 缓存写入价格（每百万 token） */
  cache_write_per_million: number | null;
  /** 货币单位 */
  currency: string;
}

/** 模型限制 */
export interface ModelLimits {
  /** 上下文长度 */
  context_length: number | null;
  /** 最大输出 token 数 */
  max_output_tokens: number | null;
  /** 每分钟请求数限制 */
  requests_per_minute: number | null;
  /** 每分钟 token 数限制 */
  tokens_per_minute: number | null;
}

/** 模型状态 */
export type ModelStatus =
  | "active"
  | "preview"
  | "alpha"
  | "beta"
  | "deprecated"
  | "legacy";

/** 模型服务等级 */
export type ModelTier = "mini" | "pro" | "max";

/** 模型数据来源 */
export type ModelSource =
  | "embedded"
  | "models.dev"
  | "local"
  | "custom"
  | "api";

/** 增强的模型元数据 */
export interface EnhancedModelMetadata {
  /** 模型 ID (如 "claude-sonnet-4-5-20250514") */
  id: string;
  /** 显示名称 (如 "Claude Sonnet 4.5") */
  display_name: string;
  /** Provider ID (如 "anthropic", "openai", "dashscope") */
  provider_id: string;
  /** Provider 显示名称 */
  provider_name: string;
  /** 模型家族 (如 "sonnet", "gpt-4", "qwen") */
  family: string | null;
  /** 服务等级 */
  tier: ModelTier;
  /** 模型能力 */
  capabilities: ModelCapabilities;
  /** 任务族 */
  task_families?: ModelTaskFamily[];
  /** 输入模态 */
  input_modalities?: ModelModality[];
  /** 输出模态 */
  output_modalities?: ModelModality[];
  /** 运行时特性 */
  runtime_features?: ModelRuntimeFeature[];
  /** 部署来源 */
  deployment_source?: ModelDeploymentSource;
  /** 管理面 */
  management_plane?: ModelManagementPlane;
  /** 规范化模型 ID */
  canonical_model_id?: string | null;
  /** 实际 Provider 返回的模型 ID */
  provider_model_id?: string | null;
  /** 别名来源 */
  alias_source?: ModelAliasSource | null;
  /** 定价信息 */
  pricing: ModelPricing | null;
  /** 限制信息 */
  limits: ModelLimits;
  /** 模型状态 */
  status: ModelStatus;
  /** 发布日期 */
  release_date: string | null;
  /** 是否为最新版本 */
  is_latest: boolean;
  /** 描述 */
  description: string | null;
  /** 数据来源 */
  source: ModelSource;
  /** 创建时间 (Unix 时间戳) */
  created_at: number;
  /** 最后更新时间 (Unix 时间戳) */
  updated_at: number;
}

/** 用户模型偏好 */
export interface UserModelPreference {
  /** 模型 ID */
  model_id: string;
  /** 是否收藏 */
  is_favorite: boolean;
  /** 是否隐藏 */
  is_hidden: boolean;
  /** 自定义别名 */
  custom_alias: string | null;
  /** 使用次数 */
  usage_count: number;
  /** 最后使用时间 (Unix 时间戳) */
  last_used_at: number | null;
  /** 创建时间 (Unix 时间戳) */
  created_at: number;
  /** 更新时间 (Unix 时间戳) */
  updated_at: number;
}

/** 模型同步状态 */
export interface ModelSyncState {
  /** 最后同步时间 (Unix 时间戳) */
  last_sync_at: number | null;
  /** 同步的模型数量 */
  model_count: number;
  /** 是否正在同步 */
  is_syncing: boolean;
  /** 最后同步错误 */
  last_error: string | null;
}

/** 模型注册表状态 */
export interface ModelRegistryState {
  /** 模型列表 */
  models: EnhancedModelMetadata[];
  /** 用户偏好 */
  preferences: Map<string, UserModelPreference>;
  /** 最后同步时间 */
  lastSyncAt: number | null;
  /** 是否加载中 */
  isLoading: boolean;
  /** 错误信息 */
  error: string | null;
}

/** 单个模型别名映射 */
export interface ModelAlias {
  /** 实际模型 ID（如 "claude-sonnet-4-5-20250929"） */
  actual: string;
  /** 内部 API 名称 */
  internal_name: string | null;
  /** 原始 Provider（如 "anthropic"） */
  provider: string | null;
  /** 描述 */
  description: string | null;
}

/** Provider 的别名配置 */
export interface ProviderAliasConfig {
  /** Provider ID（如 "kiro"、"codex"） */
  provider: string;
  /** 描述 */
  description: string | null;
  /** 支持的模型列表 */
  models: string[];
  /** 别名映射（模型名 -> 别名配置） */
  aliases: Record<string, ModelAlias>;
  /** 更新时间 */
  updated_at: string | null;
}
