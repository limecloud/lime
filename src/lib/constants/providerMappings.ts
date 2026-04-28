/**
 * @file Provider 映射常量和工具函数
 * @description 统一管理 Provider 类型映射、别名配置等共享常量
 * @module lib/constants/providerMappings
 */

import { resolveKnownAnthropicCompatibleProvider } from "@/lib/model/providerPromptCacheSupport";

// ============================================================================
// 别名配置相关常量
// ============================================================================

/**
 * 凭证池 Provider 别名已退役；模型列表统一从模型注册表读取。
 */
const ALIAS_PROVIDERS = [] as const;

type AliasProvider = (typeof ALIAS_PROVIDERS)[number];

/**
 * 别名配置文件名映射
 * 某些 Provider 共享同一个别名配置文件
 */
const ALIAS_CONFIG_MAPPING: Record<string, string> = {};

// ============================================================================
// Provider 类型映射
// ============================================================================

/**
 * Provider 类型到模型注册表 provider_id 的映射
 * 用于从模型注册表获取对应 Provider 的模型列表。
 *
 * 注意：
 * - 这里只做“模型目录 / 别名”层的归一化，不代表运行时能力等价；
 * - 已知官方 Anthropic 兼容 Host 需要按真实厂商目录分流，不能一律回落到 Anthropic。
 */
const PROVIDER_TYPE_TO_REGISTRY_ID: Record<string, string> = {
  // 主流 AI
  openai: "openai",
  anthropic: "anthropic",
  "anthropic-compatible": "anthropic",
  gemini: "google",
  // 云服务
  "azure-openai": "openai",
  vertexai: "google",
  // 本地/自托管
  ollama: "ollama",
  fal: "fal",
  // 特殊 Provider
  claude: "anthropic",
  qwen: "alibaba",
  codex: "openai",
  iflow: "openai",
};

/**
 * Provider 显示名称映射
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  gemini: "Gemini",
  qwen: "通义千问",
  codex: "Codex",
  claude: "Claude",
  openai: "OpenAI",
  anthropic: "Anthropic",
  "anthropic-compatible": "Anthropic Compatible",
  "azure-openai": "Azure OpenAI",
  vertexai: "VertexAI",
  ollama: "Ollama",
  fal: "Fal",
  iflow: "iFlow",
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取 Provider 类型对应的模型注册表 ID
 * @param providerType Provider 类型
 * @param apiHost 可选的 Provider API Host，用于识别官方 Anthropic 兼容厂商
 * @returns 模型注册表中的 provider_id
 */
export function getRegistryIdFromType(
  providerType: string,
  apiHost?: string | null,
): string {
  const managedRegistryId = resolveKnownAnthropicCompatibleProvider(apiHost);
  if (managedRegistryId) {
    return managedRegistryId;
  }

  const normalizedType = providerType.toLowerCase();

  return PROVIDER_TYPE_TO_REGISTRY_ID[normalizedType] || normalizedType;
}

/**
 * 获取 Provider 的显示标签
 * @param providerType Provider 类型
 * @returns 用于 UI 显示的标签
 */
export function getProviderLabel(providerType: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[providerType.toLowerCase()] ||
    providerType.charAt(0).toUpperCase() + providerType.slice(1)
  );
}

/**
 * 获取别名配置文件的 key
 * 某些 Provider 共享同一个别名配置文件
 * @param providerKey Provider key
 * @returns 别名配置文件的 key
 */
export function getAliasConfigKey(providerKey: string): string {
  return ALIAS_CONFIG_MAPPING[providerKey] || providerKey;
}

/**
 * 检查 Provider 是否使用别名配置
 * @param providerKey Provider key
 * @returns 是否使用别名配置
 */
export function isAliasProvider(providerKey: string): boolean {
  return ALIAS_PROVIDERS.includes(providerKey as AliasProvider);
}
