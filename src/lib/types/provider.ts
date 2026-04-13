/**
 * @file Provider 类型定义
 * @description API Key Provider 系统的核心类型定义
 * @module lib/types/provider
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 5.1**
 */

// ============================================================================
// Provider API 类型
// ============================================================================

/**
 * Provider API 类型
 * 定义不同 Provider 使用的 API 协议
 */
export type ProviderType =
  | "openai" // 标准 OpenAI Chat Completions API
  | "openai-response" // OpenAI Responses API (支持 Reasoning)
  | "codex" // Codex CLI 协议 (使用 /responses 端点)
  | "anthropic" // Anthropic Messages API
  | "anthropic-compatible" // Anthropic 兼容格式 (system 为数组格式)
  | "gemini" // Google Gemini API
  | "azure-openai" // Azure OpenAI API
  | "vertexai" // Google Vertex AI API
  | "aws-bedrock" // AWS Bedrock API
  | "ollama" // Ollama 本地 API
  | "fal" // fal.ai API
  | "new-api" // New API 兼容格式
  | "gateway"; // Vercel AI Gateway 格式

/**
 * Provider 声明的 Prompt Cache 模式
 * - `automatic`: 上游明确声明支持自动 Prompt Cache
 * - `explicit_only`: 仅支持显式 `cache_control`
 * - `not_applicable`: 当前 Provider 默认不参与这套提示语义
 */
export type ProviderPromptCacheMode =
  | "automatic"
  | "explicit_only"
  | "not_applicable";

/** 可由 Provider 显式声明的 Prompt Cache 模式 */
export type ProviderDeclaredPromptCacheMode = Exclude<
  ProviderPromptCacheMode,
  "not_applicable"
>;

// ============================================================================
// Provider 分组类型
// ============================================================================

/**
 * Provider 分组类型
 * 用于在 UI 中对 Provider 进行分类显示
 */
export type ProviderGroup =
  | "mainstream" // 主流 AI
  | "chinese" // 国内 AI
  | "cloud" // 云服务
  | "aggregator" // API 聚合
  | "local" // 本地服务
  | "specialized" // 专用服务
  | "custom"; // 自定义

// ============================================================================
// System Provider ID 类型
// ============================================================================

/**
 * System Provider ID 类型
 * 所有系统预设 Provider 的唯一标识符
 */
export type SystemProviderId =
  // ===== 主流 AI (10个) =====
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "moonshot"
  | "groq"
  | "grok"
  | "mistral"
  | "perplexity"
  | "cohere"
  // ===== 国内 AI (15个) =====
  | "zhipu"
  | "baichuan"
  | "dashscope"
  | "stepfun"
  | "doubao"
  | "minimax"
  | "yi"
  | "hunyuan"
  | "tencent-cloud-ti"
  | "baidu-cloud"
  | "infini"
  | "modelscope"
  | "xirang"
  | "mimo"
  | "zhinao"
  // ===== 云服务 (5个) =====
  | "azure-openai"
  | "vertexai"
  | "aws-bedrock"
  | "github"
  | "copilot"
  // ===== API 聚合 (25个) =====
  | "silicon"
  | "openrouter"
  | "aihubmix"
  | "302ai"
  | "together"
  | "fireworks"
  | "nvidia"
  | "hyperbolic"
  | "cerebras"
  | "ppio"
  | "qiniu"
  | "tokenflux"
  | "cephalon"
  | "lanyun"
  | "ph8"
  | "sophnet"
  | "ocoolai"
  | "dmxapi"
  | "aionly"
  | "burncloud"
  | "alayanew"
  | "longcat"
  | "poe"
  | "huggingface"
  | "vercel-gateway"
  // ===== 本地服务 (5个) =====
  | "ollama"
  | "lmstudio"
  | "new-api"
  | "gpustack"
  | "ovms"
  // ===== 专用服务 (3个) =====
  | "jina"
  | "voyageai"
  | "cherryin";

// ============================================================================
// Provider 配置接口
// ============================================================================

/**
 * Provider 配置接口
 * 定义单个 Provider 的完整配置信息
 */
export interface ProviderConfig {
  /** Provider 唯一标识符 */
  id: string;
  /** 显示名称 */
  name: string;
  /** API 类型 */
  type: ProviderType;
  /** API Host/Base URL */
  apiHost: string;
  /** 是否为系统预设 Provider */
  isSystem: boolean;
  /** 所属分组 */
  group: ProviderGroup;
  /** 是否启用 */
  enabled: boolean;
  /** 排序顺序 */
  sortOrder: number;
  /** Azure OpenAI API 版本 (仅 azure-openai 类型) */
  apiVersion?: string;
  /** VertexAI 项目 ID (仅 vertexai 类型) */
  project?: string;
  /** VertexAI 位置 (仅 vertexai 类型) */
  location?: string;
  /** AWS Bedrock 区域 (仅 aws-bedrock 类型) */
  region?: string;
  /** 创建时间 */
  createdAt?: string;
  /** 更新时间 */
  updatedAt?: string;
}

// ============================================================================
// API Key 条目接口
// ============================================================================

/**
 * API Key 条目接口
 * 定义单个 API Key 的完整信息
 */
export interface ApiKeyEntry {
  /** 唯一标识符 */
  id: string;
  /** 所属 Provider ID */
  providerId: string;
  /** API Key (加密存储，前端显示时为掩码) */
  apiKey: string;
  /** 别名 (可选，用于区分多个 Key) */
  alias?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 使用次数 */
  usageCount: number;
  /** 错误次数 */
  errorCount: number;
  /** 最后使用时间 */
  lastUsedAt?: string;
  /** 创建时间 */
  createdAt: string;
}

// ============================================================================
// Provider 完整数据接口
// ============================================================================

/**
 * Provider 完整数据接口
 * 包含 Provider 配置和其所有 API Keys
 */
export interface ProviderWithKeys extends ProviderConfig {
  /** 该 Provider 的所有 API Keys */
  apiKeys: ApiKeyEntry[];
}

// ============================================================================
// Provider 分组配置接口
// ============================================================================

/**
 * Provider 分组配置接口
 * 定义分组的显示信息
 */
export interface ProviderGroupConfig {
  /** 分组显示标签 */
  label: string;
  /** 排序顺序 */
  order: number;
}

// ============================================================================
// 连接测试结果接口
// ============================================================================

/**
 * 连接测试结果接口
 */
export interface ConnectionTestResult {
  /** 是否成功 */
  success: boolean;
  /** 响应时间 (毫秒) */
  latencyMs?: number;
  /** 错误信息 (失败时) */
  error?: string;
  /** 模型列表 (成功时，如果 API 支持) */
  models?: string[];
}

// ============================================================================
// 导入导出相关接口
// ============================================================================

/**
 * 导出配置接口
 */
export interface ExportConfig {
  /** 导出版本 */
  version: string;
  /** 导出时间 */
  exportedAt: string;
  /** Provider 配置列表 */
  providers: ProviderConfig[];
  /** API Keys (可选，根据用户选择) */
  apiKeys?: Omit<ApiKeyEntry, "apiKey">[];
}

/**
 * 导入结果接口
 */
export interface ImportResult {
  /** 是否成功 */
  success: boolean;
  /** 导入的 Provider 数量 */
  importedProviders: number;
  /** 导入的 API Key 数量 */
  importedApiKeys: number;
  /** 跳过的 Provider 数量 (已存在) */
  skippedProviders: number;
  /** 错误信息 */
  errors: string[];
}
