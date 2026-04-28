/**
 * @file Provider 配置工具函数
 * @description Provider 配置表单的模型与字段辅助逻辑
 * @module components/provider-pool/api-key/providerConfigUtils
 */

import type {
  ProviderDeclaredPromptCacheMode,
  ProviderType,
} from "@/lib/types/provider";
import { canonicalizeKnownProviderModelId } from "@/lib/model/xiaomiModelNormalization";
import { getProviderPromptCacheMode } from "@/lib/model/providerPromptCacheSupport";
import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

/** 支持的 Provider 类型列表 */
export const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string }[] = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "openai-response", label: "OpenAI Responses API" },
  { value: "codex", label: "Codex CLI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "anthropic-compatible", label: "Anthropic 兼容" },
  { value: "gemini", label: "Gemini" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "vertexai", label: "VertexAI" },
  { value: "aws-bedrock", label: "AWS Bedrock" },
  { value: "ollama", label: "Ollama" },
  { value: "fal", label: "Fal" },
  { value: "new-api", label: "New API" },
  { value: "gateway", label: "Vercel AI Gateway" },
];

/** 支持的 Provider 类型值列表 */
export const PROVIDER_TYPE_VALUES: ProviderType[] = PROVIDER_TYPE_OPTIONS.map(
  (option) => option.value,
);

/** Provider 类型对应的额外字段配置 */
export const PROVIDER_TYPE_FIELDS: Record<ProviderType, string[]> = {
  openai: [],
  "openai-response": [],
  codex: [],
  anthropic: [],
  "anthropic-compatible": [],
  gemini: [],
  "azure-openai": ["apiVersion"],
  vertexai: ["project", "location"],
  "aws-bedrock": ["region"],
  ollama: [],
  fal: [],
  "new-api": [],
  gateway: [],
};

const SPECIAL_PROVIDER_PROTOCOL_HINTS: Partial<Record<ProviderType, string>> = {
  codex:
    "Codex 保留 Lime 的专属协议与模型别名能力，会继续使用独立的 Codex 模型映射与鉴权链路。",
  anthropic:
    "Anthropic 继续使用原生协议，不会被收敛到普通 OpenAI 兼容请求格式。",
  "anthropic-compatible":
    "Anthropic 兼容用于接入实现 Anthropic wire format 的第三方服务，会沿用 Anthropic 请求结构与模型映射。Lime 会自动识别已知官方 Anthropic 兼容端点（如 GLM / Kimi / MiniMax / MiMo）；未知端点默认回退为仅显式缓存。",
  gemini:
    "Gemini 保留原生协议能力与专属模型映射，不按普通 OpenAI 兼容 Provider 处理。",
};

export const PROMPT_CACHE_MODE_OPTIONS: Array<{
  value: ProviderDeclaredPromptCacheMode;
  label: string;
  description: string;
}> = [
  {
    value: "explicit_only",
    label: "仅显式缓存",
    description:
      "默认选项。只有显式写入 cache_control 时才请求上游复用前缀。",
  },
  {
    value: "automatic",
    label: "已声明自动缓存",
    description:
      "仅在上游明确声明兼容 Anthropic Automatic Prompt Cache 时使用。",
  },
];

export function isSupportedProviderType(
  providerType: string,
): providerType is ProviderType {
  return PROVIDER_TYPE_VALUES.includes(providerType as ProviderType);
}

export function getProviderTypeLabel(providerType: string): string {
  return (
    PROVIDER_TYPE_OPTIONS.find((option) => option.value === providerType)
      ?.label ?? providerType
  );
}

export function isSpecialProtocolProviderType(type: ProviderType): boolean {
  return getSpecialProtocolHint(type) !== null;
}

export function getSpecialProtocolHint(type: ProviderType): string | null {
  return SPECIAL_PROVIDER_PROTOCOL_HINTS[type] ?? null;
}

export function isPromptCacheModeConfigurableProviderType(
  type: ProviderType,
  apiHost?: string | null,
): boolean {
  return (
    type === "anthropic-compatible" &&
    getProviderPromptCacheMode(type, null, apiHost) === "explicit_only"
  );
}

export function resolvePromptCacheModeFormValue(
  promptCacheMode?: ProviderDeclaredPromptCacheMode | null,
  providerType?: ProviderType,
  apiHost?: string | null,
): ProviderDeclaredPromptCacheMode {
  return getProviderPromptCacheMode(providerType, promptCacheMode, apiHost) ===
    "automatic"
    ? "automatic"
    : "explicit_only";
}

export function resolvePromptCacheModeRequestValue(
  type: ProviderType,
  promptCacheMode: ProviderDeclaredPromptCacheMode,
  apiHost?: string | null,
): ProviderDeclaredPromptCacheMode | null {
  if (type !== "anthropic-compatible") {
    return null;
  }

  return resolvePromptCacheModeFormValue(promptCacheMode, type, apiHost);
}

export function dedupeModelIds(modelIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const modelId of modelIds) {
    const trimmed = modelId.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

interface ProviderModelNormalizationOptions {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
}

function normalizeProviderModelId(
  modelId: string,
  options?: ProviderModelNormalizationOptions,
): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return "";
  }

  if (!options) {
    return trimmed;
  }

  return (
    canonicalizeKnownProviderModelId({
      providerId: options.providerId,
      providerType: options.providerType,
      apiHost: options.apiHost,
      modelId: trimmed,
    }) || trimmed
  );
}

function canonicalizeProviderModelIds(
  modelIds: string[],
  options?: ProviderModelNormalizationOptions,
): string[] {
  return dedupeModelIds(
    modelIds
      .map((modelId) => normalizeProviderModelId(modelId, options))
      .filter((modelId) => modelId.length > 0),
  );
}

export function parseCustomModelsValue(
  value: string,
  options?: ProviderModelNormalizationOptions,
): string[] {
  return canonicalizeProviderModelIds(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    options,
  );
}

export function serializeCustomModels(
  models: string[],
  options?: ProviderModelNormalizationOptions,
): string {
  return canonicalizeProviderModelIds(models, options).join(", ");
}

export function sortSelectableModels(
  models: EnhancedModelMetadata[],
): EnhancedModelMetadata[] {
  return [...models].sort((a, b) => {
    if (a.is_latest && !b.is_latest) return -1;
    if (!a.is_latest && b.is_latest) return 1;

    if (a.release_date && b.release_date && a.release_date !== b.release_date) {
      return b.release_date.localeCompare(a.release_date);
    }
    if (a.release_date && !b.release_date) return -1;
    if (!a.release_date && b.release_date) return 1;

    const tierWeight: Record<string, number> = { max: 3, pro: 2, mini: 1 };
    const aTierWeight = tierWeight[a.tier] ?? 0;
    const bTierWeight = tierWeight[b.tier] ?? 0;
    if (aTierWeight !== bTierWeight) {
      return bTierWeight - aTierWeight;
    }

    return a.display_name.localeCompare(b.display_name);
  });
}

export function getLatestSelectableModel(
  models: EnhancedModelMetadata[],
): EnhancedModelMetadata | null {
  return sortSelectableModels(models)[0] ?? null;
}

/**
 * 获取指定 Provider 类型需要显示的字段列表
 * 用于属性测试验证 Provider 类型处理正确性
 */
export function getFieldsForProviderType(type: ProviderType): string[] {
  const baseFields = ["apiHost"];
  const extraFields = PROVIDER_TYPE_FIELDS[type] || [];
  return [...baseFields, ...extraFields];
}

/**
 * 验证 Provider 类型是否需要特定字段
 */
export function providerTypeRequiresField(
  type: ProviderType,
  field: string,
): boolean {
  if (field === "apiHost") return true;
  const extraFields = PROVIDER_TYPE_FIELDS[type] || [];
  return extraFields.includes(field);
}
