/**
 * @file 图片生成 Provider 选择辅助
 * @description 统一图片 Provider 的识别、优先级选择与模型自动匹配
 * @module lib/imageGeneration
 */

import {
  IMAGE_GEN_MODELS,
  type ImageGenModel,
} from "@/components/image-gen/types";

export type ImageModelPreset = "basic" | "jimeng" | "kling";

export interface ImageProviderCandidate {
  id: string;
  type: string;
}

export interface ImageProviderModelCandidate extends ImageProviderCandidate {
  customModels?: string[];
  apiHost?: string;
}

function normalizeProviderSignature(
  providerId: string,
  providerType: string,
): string {
  return `${providerId}:${providerType}`.toLowerCase();
}

export function isImageProvider(
  providerId: string,
  providerType: string,
): boolean {
  const normalized = normalizeProviderSignature(providerId, providerType);
  return (
    normalized.includes("fal") ||
    normalized.includes("new-api") ||
    normalized.includes("openai") ||
    normalized.includes("doubao") ||
    normalized.includes("volc") ||
    normalized.includes("dashscope") ||
    normalized.includes("alibaba") ||
    normalized.includes("qwen") ||
    normalized.includes("kling") ||
    normalized.includes("minimax") ||
    normalized.includes("hailuo") ||
    normalized.includes("image")
  );
}

export function findImageProviderById<T extends ImageProviderCandidate>(
  providers: T[],
  providerId?: string | null,
): T | null {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  if (!normalizedProviderId) {
    return null;
  }

  return (
    providers.find(
      (provider) => provider.id.trim().toLowerCase() === normalizedProviderId,
    ) ?? null
  );
}

export function findImageProviderForSelection<T extends ImageProviderCandidate>(
  providers: T[],
  modelType: ImageModelPreset,
): T | null {
  const preferredKeywords: string[] =
    modelType === "jimeng"
      ? ["doubao", "volc"]
      : modelType === "kling"
        ? ["kling", "minimax", "hailuo"]
        : ["new-api", "openai", "dashscope", "alibaba", "qwen"];

  for (const keyword of preferredKeywords) {
    const matched = providers.find((provider) =>
      normalizeProviderSignature(provider.id, provider.type).includes(keyword),
    );
    if (matched) {
      return matched;
    }
  }

  return providers[0] ?? null;
}

export function pickImageModelBySelection(
  models: string[],
  modelType: ImageModelPreset,
): string {
  if (models.length === 0) {
    return modelType === "jimeng"
      ? "seedream-3.0"
      : modelType === "kling"
        ? "kling-2.6"
        : "gpt-image-1";
  }

  const normalizedModels = models.map((model) => model.toLowerCase());
  const priorities =
    modelType === "jimeng"
      ? ["jimeng", "seedream", "doubao", "volc", "pro"]
      : modelType === "kling"
        ? ["kling", "hailuo", "minimax"]
        : ["gpt-image", "flux", "sd", "image", "wanx", "seedream"];

  for (const keyword of priorities) {
    const index = normalizedModels.findIndex((model) =>
      model.includes(keyword),
    );
    if (index >= 0) {
      return models[index] ?? models[0] ?? "gpt-image-1";
    }
  }

  return models[0] ?? "gpt-image-1";
}

function isFalLikeProvider(
  providerId: string,
  providerType: string,
  apiHost?: string,
): boolean {
  const normalizedSignature = normalizeProviderSignature(
    providerId,
    providerType,
  );
  const normalizedHost = (apiHost || "").trim().toLowerCase();
  return (
    normalizedSignature.includes("fal") ||
    normalizedHost.includes("fal.run") ||
    normalizedHost.includes("queue.fal.run")
  );
}

function isLikelyFalImageModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("fal-ai/")) {
    return true;
  }

  return /(image|flux|banana|seedream|kontext|recraft|ideogram|sdxl|stable-diffusion|wanx)/.test(
    normalized,
  );
}

export function getImageModelsForProvider(
  providerId: string,
  providerType: string,
  customModels?: string[],
  apiHost?: string,
): ImageGenModel[] {
  const builtinModels =
    IMAGE_GEN_MODELS[providerId] ?? IMAGE_GEN_MODELS[providerType] ?? [];

  if (customModels && customModels.length > 0) {
    const nextCustomModels = isFalLikeProvider(
      providerId,
      providerType,
      apiHost,
    )
      ? customModels.filter((modelId) => isLikelyFalImageModel(modelId))
      : customModels;

    if (nextCustomModels.length > 0) {
      return nextCustomModels.map((modelId) => ({
        id: modelId,
        name: modelId,
        supportedSizes: [
          "1024x1024",
          "768x1344",
          "1344x768",
          "1792x1024",
          "1024x1792",
        ],
      }));
    }

    if (builtinModels.length > 0) {
      return builtinModels;
    }

    return customModels.map((modelId) => ({
      id: modelId,
      name: modelId,
      supportedSizes: [
        "1024x1024",
        "768x1344",
        "1344x768",
        "1792x1024",
        "1024x1792",
      ],
    }));
  }

  return builtinModels;
}

export function getImageModelIdsForProvider(
  providerId: string,
  providerType: string,
  customModels?: string[],
  apiHost?: string,
): string[] {
  return getImageModelsForProvider(
    providerId,
    providerType,
    customModels,
    apiHost,
  ).map((model) => model.id);
}
