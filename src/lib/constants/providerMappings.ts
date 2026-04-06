/**
 * @file Provider 映射常量和工具函数
 * @description 统一管理 Provider 类型映射、别名配置等共享常量
 * @module lib/constants/providerMappings
 */

// ============================================================================
// 别名配置相关常量
// ============================================================================

/**
 * 需要使用别名配置的 Provider 列表
 * 这些 Provider 的模型列表从别名配置文件获取，而不是从模型注册表
 */
const ALIAS_PROVIDERS = [
  "antigravity",
  "kiro",
  "codex",
  "gemini",
  "gemini_api_key",
] as const;

type AliasProvider = (typeof ALIAS_PROVIDERS)[number];

/**
 * 别名配置文件名映射
 * 某些 Provider 共享同一个别名配置文件
 */
const ALIAS_CONFIG_MAPPING: Record<string, string> = {
  gemini_api_key: "gemini", // Gemini API Key 使用 gemini 的别名配置
};

// ============================================================================
// Provider 类型映射
// ============================================================================

/**
 * Provider 类型到模型注册表 provider_id 的映射
 * 用于从模型注册表获取对应 Provider 的模型列表
 */
const PROVIDER_TYPE_TO_REGISTRY_ID: Record<string, string> = {
  // 主流 AI
  openai: "openai",
  anthropic: "anthropic",
  "anthropic-compatible": "anthropic",
  gemini: "gemini",
  // 云服务
  "azure-openai": "openai",
  vertexai: "google",
  // 本地/自托管
  ollama: "ollama",
  fal: "fal",
  // 特殊 Provider
  kiro: "kiro",
  claude: "anthropic",
  claude_oauth: "anthropic",
  qwen: "alibaba",
  codex: "codex",
  antigravity: "antigravity",
  iflow: "openai",
  gemini_api_key: "gemini",
};

/**
 * Provider 显示名称映射
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  kiro: "Kiro",
  gemini: "Gemini OAuth",
  qwen: "通义千问",
  antigravity: "Antigravity",
  codex: "Codex",
  claude_oauth: "Claude OAuth",
  claude: "Claude",
  openai: "OpenAI",
  anthropic: "Anthropic",
  "anthropic-compatible": "Anthropic Compatible",
  "azure-openai": "Azure OpenAI",
  vertexai: "VertexAI",
  ollama: "Ollama",
  fal: "Fal",
  gemini_api_key: "Gemini API Key",
  iflow: "iFlow",
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取 Provider 类型对应的模型注册表 ID
 * @param providerType Provider 类型
 * @returns 模型注册表中的 provider_id
 */
export function getRegistryIdFromType(providerType: string): string {
  return (
    PROVIDER_TYPE_TO_REGISTRY_ID[providerType.toLowerCase()] ||
    providerType.toLowerCase()
  );
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
