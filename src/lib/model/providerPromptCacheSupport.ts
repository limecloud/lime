export interface PromptCacheSupportNoticeInput {
  providerType?: string | null;
  configuredProviderType?: string | null;
}

export interface PromptCacheSupportNotice {
  label: string;
  detail: string;
  source: "configured_provider" | "selection_fallback";
}

export type PromptCacheMode = "automatic" | "explicit_only" | "not_applicable";

const AUTOMATIC_PROMPT_CACHE_PROVIDER_TYPES = new Set([
  "anthropic",
  "claude",
  "claude-oauth",
]);

const EXPLICIT_ONLY_PROMPT_CACHE_PROVIDER_TYPES = new Set([
  "anthropic-compatible",
]);

function normalizeProviderType(value?: string | null): string {
  return (value || "").trim().toLowerCase().replace(/_/g, "-");
}

export function getProviderPromptCacheMode(
  providerType?: string | null,
): PromptCacheMode {
  const normalizedProviderType = normalizeProviderType(providerType);
  if (!normalizedProviderType) {
    return "not_applicable";
  }
  if (AUTOMATIC_PROMPT_CACHE_PROVIDER_TYPES.has(normalizedProviderType)) {
    return "automatic";
  }
  if (EXPLICIT_ONLY_PROMPT_CACHE_PROVIDER_TYPES.has(normalizedProviderType)) {
    return "explicit_only";
  }
  return "not_applicable";
}

export function resolvePromptCacheSupportNotice({
  providerType,
  configuredProviderType,
}: PromptCacheSupportNoticeInput): PromptCacheSupportNotice | null {
  const configuredMode = getProviderPromptCacheMode(configuredProviderType);
  if (configuredMode === "explicit_only") {
    return {
      label: "未声明自动缓存",
      detail:
        "当前 Provider 未声明支持自动 Prompt Cache；如需复用前缀，请使用显式 cache_control 标记。",
      source: "configured_provider",
    };
  }
  if (configuredProviderType?.trim()) {
    return null;
  }

  const selectionMode = getProviderPromptCacheMode(providerType);
  if (selectionMode !== "explicit_only") {
    return null;
  }

  return {
    label: "未声明自动缓存",
    detail:
      "当前 Provider 未声明支持自动 Prompt Cache；当前提示基于 Provider 选择器回退判断，如需复用前缀，请使用显式 cache_control 标记。",
    source: "selection_fallback",
  };
}
