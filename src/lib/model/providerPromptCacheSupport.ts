import type {
  ProviderDeclaredPromptCacheMode,
  ProviderPromptCacheMode,
} from "@/lib/types/provider";
import promptCacheCatalog from "./anthropicCompatiblePromptCacheCatalog.json";

export interface PromptCacheSupportNoticeInput {
  providerType?: string | null;
  configuredProviderType?: string | null;
  configuredApiHost?: string | null;
  providerPromptCacheMode?: ProviderDeclaredPromptCacheMode | null;
  configuredPromptCacheMode?: ProviderDeclaredPromptCacheMode | null;
}

export interface PromptCacheSupportNotice {
  label: string;
  detail: string;
  source: "configured_provider" | "selection_fallback";
}

const AUTOMATIC_PROMPT_CACHE_PROVIDER_TYPES = new Set([
  "anthropic",
  "claude",
  "claude-oauth",
]);

const EXPLICIT_ONLY_PROMPT_CACHE_PROVIDER_TYPES = new Set([
  "anthropic-compatible",
]);

const KNOWN_AUTOMATIC_ANTHROPIC_COMPATIBLE_HOSTS =
  promptCacheCatalog.automaticAnthropicCompatibleHosts.map((rule) =>
    rule.contains.trim().toLowerCase(),
  );

function normalizeProviderType(value?: string | null): string {
  return (value || "").trim().toLowerCase().replace(/_/g, "-");
}

function normalizeApiHost(value?: string | null): string {
  return (value || "").trim().toLowerCase().replace(/\/+$/, "");
}

export function isKnownAutomaticAnthropicCompatibleHost(
  apiHost?: string | null,
): boolean {
  const normalizedApiHost = normalizeApiHost(apiHost);
  if (!normalizedApiHost) {
    return false;
  }

  return KNOWN_AUTOMATIC_ANTHROPIC_COMPATIBLE_HOSTS.some((needle) =>
    normalizedApiHost.includes(needle),
  );
}

function normalizePromptCacheMode(
  value?: string | null,
): ProviderPromptCacheMode | null {
  const normalizedValue = (value || "").trim().toLowerCase().replace(/-/g, "_");
  switch (normalizedValue) {
    case "automatic":
      return "automatic";
    case "explicit_only":
      return "explicit_only";
    case "not_applicable":
      return "not_applicable";
    default:
      return null;
  }
}

function inferProviderManagedPromptCacheMode(
  providerType?: string | null,
  apiHost?: string | null,
): ProviderPromptCacheMode | null {
  const normalizedProviderType = normalizeProviderType(providerType);

  if (
    normalizedProviderType === "anthropic-compatible" &&
    isKnownAutomaticAnthropicCompatibleHost(apiHost)
  ) {
    return "automatic";
  }

  return null;
}

export function getProviderPromptCacheMode(
  providerType?: string | null,
  declaredMode?: string | null,
  apiHost?: string | null,
): ProviderPromptCacheMode {
  const inferredManagedMode = inferProviderManagedPromptCacheMode(
    providerType,
    apiHost,
  );
  if (inferredManagedMode) {
    return inferredManagedMode;
  }

  const normalizedDeclaredMode = normalizePromptCacheMode(declaredMode);
  if (normalizedDeclaredMode) {
    return normalizedDeclaredMode;
  }

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
  configuredApiHost,
  providerPromptCacheMode,
  configuredPromptCacheMode,
}: PromptCacheSupportNoticeInput): PromptCacheSupportNotice | null {
  const configuredMode = getProviderPromptCacheMode(
    configuredProviderType,
    configuredPromptCacheMode,
    configuredApiHost,
  );
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

  const selectionMode = getProviderPromptCacheMode(
    providerType,
    providerPromptCacheMode,
  );
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
