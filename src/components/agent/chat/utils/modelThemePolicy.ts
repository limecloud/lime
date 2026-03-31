import type { EnhancedModelMetadata } from "@/lib/types/modelRegistry";

export interface ThemeModelFilterResult {
  models: EnhancedModelMetadata[];
  usedFallback: boolean;
  filteredOutCount: number;
  policyName: string;
}

const IMAGE_INCLUDE_KEYWORDS = [
  "image",
  "imagen",
  "dall-e",
  "flux",
  "stable-diffusion",
  "sdxl",
  "sd3",
  "midjourney",
  "mj",
  "picture",
  "绘图",
  "图像",
  "生图",
];

const IMAGE_EXCLUDE_KEYWORDS = [
  "embedding",
  "rerank",
  "tts",
  "stt",
  "asr",
  "transcribe",
  "audio",
  "speech",
  "reasoner",
  "thinking",
  "computer-use",
];

const NON_CHAT_KEYWORDS = [
  "embedding",
  "rerank",
  "tts",
  "stt",
  "asr",
  "transcribe",
  "audio",
  "speech",
  "whisper",
];

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildModelSearchText(model: EnhancedModelMetadata): string {
  return [
    model.id,
    model.display_name,
    model.family || "",
    model.description || "",
  ]
    .join(" ")
    .toLowerCase();
}

function looksLikeImageGenerationModel(model: EnhancedModelMetadata): boolean {
  const text = buildModelSearchText(model);

  if (
    containsAnyKeyword(text, IMAGE_EXCLUDE_KEYWORDS) ||
    containsAnyKeyword(text, NON_CHAT_KEYWORDS)
  ) {
    return false;
  }

  if (containsAnyKeyword(text, IMAGE_INCLUDE_KEYWORDS)) {
    return true;
  }

  return (
    model.capabilities.vision &&
    !model.capabilities.tools &&
    !model.capabilities.function_calling &&
    !model.capabilities.json_mode
  );
}

function looksLikeChatModel(model: EnhancedModelMetadata): boolean {
  const text = buildModelSearchText(model);

  if (containsAnyKeyword(text, NON_CHAT_KEYWORDS)) {
    return false;
  }

  return !looksLikeImageGenerationModel(model);
}

const CHAT_THEME_IDS = new Set([
  "social-media",
  "document",
  "video",
]);

export function filterModelsByTheme(
  theme: string | undefined,
  models: EnhancedModelMetadata[],
): ThemeModelFilterResult {
  const normalizedTheme = theme?.toLowerCase() || "";
  if (models.length === 0) {
    return {
      models,
      usedFallback: false,
      filteredOutCount: 0,
      policyName: "none",
    };
  }

  if (normalizedTheme === "knowledge" || normalizedTheme === "planning") {
    const reasoningModels = models.filter(
      (model) => looksLikeChatModel(model) && model.capabilities.reasoning,
    );

    if (reasoningModels.length > 0) {
      return {
        models: reasoningModels,
        usedFallback: false,
        filteredOutCount: models.length - reasoningModels.length,
        policyName: "reasoning-priority",
      };
    }

    const chatModels = models.filter(looksLikeChatModel);
    if (chatModels.length > 0) {
      return {
        models: chatModels,
        usedFallback: false,
        filteredOutCount: models.length - chatModels.length,
        policyName: "chat-fallback",
      };
    }

    return {
      models,
      usedFallback: true,
      filteredOutCount: 0,
      policyName: "fallback-all",
    };
  }

  if (CHAT_THEME_IDS.has(normalizedTheme)) {
    const chatModels = models.filter(looksLikeChatModel);
    if (chatModels.length > 0) {
      return {
        models: chatModels,
        usedFallback: false,
        filteredOutCount: models.length - chatModels.length,
        policyName: "chat-only",
      };
    }

    return {
      models,
      usedFallback: true,
      filteredOutCount: 0,
      policyName: "fallback-all",
    };
  }

  return {
    models,
    usedFallback: false,
    filteredOutCount: 0,
    policyName: "none",
  };
}
