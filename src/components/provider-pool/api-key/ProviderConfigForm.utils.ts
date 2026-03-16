/**
 * @file ProviderConfigForm 工具函数
 * @description Provider 配置表单的模型与字段辅助逻辑
 * @module components/provider-pool/api-key/ProviderConfigForm.utils
 */

import type { ProviderType } from "@/lib/types/provider";
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

export function isSupportedProviderType(
  providerType: string,
): providerType is ProviderType {
  return PROVIDER_TYPE_VALUES.includes(providerType as ProviderType);
}

export function getProviderTypeLabel(providerType: string): string {
  return (
    PROVIDER_TYPE_OPTIONS.find((option) => option.value === providerType)?.label ??
    providerType
  );
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

export function parseCustomModelsValue(value: string): string[] {
  return dedupeModelIds(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

export function serializeCustomModels(models: string[]): string {
  return dedupeModelIds(models).join(", ");
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
