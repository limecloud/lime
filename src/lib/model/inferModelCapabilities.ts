import type { ModelCapabilities } from "@/lib/types/modelRegistry";

const REASONING_TOKEN_PATTERN = /(^|[._/-])(thinking|reasoning)(?=$|[._/-])/i;
const VISION_HINT_PATTERN =
  /\b(vision|multimodal|multi-modal|omni|image-input|image understanding)\b/i;
const NON_VISION_PATTERN =
  /\b(embedding|embed|rerank|tts|stt|transcribe|transcription|speech|audio|moderation)\b/i;
const IMAGE_GENERATION_PATTERN =
  /\b(imagen|dall-e|dalle|stable[ -]?diffusion|sdxl|sd3|midjourney|mj|flux|image[ -]?generation|image-gen|image-preview)\b/i;
const OPENAI_VISION_PATTERN =
  /\b(gpt-5(?:[._/-]|\b)|gpt-4o(?:[._/-]|\b)|gpt-4\.1(?:[._/-]|\b)|gpt-4\.5(?:[._/-]|\b)|gpt-5.*codex)\b/i;
const GEMINI_VISION_PATTERN = /\bgemini(?:[._/-]|\b)/i;
const CLAUDE_VISION_PATTERN = /\bclaude(?:[._/-]|\b)/i;
const QWEN_VISION_PATTERN = /\bqwen(?:[._/-]|\b).*(vl|vision)|\bqvq\b/i;
const GLM_VISION_PATTERN = /\bglm-[\w.-]*v[\w.-]*\b/i;

const normalize = (value?: string | null): string =>
  (value || "").trim().toLowerCase();

function buildSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => normalize(part))
    .filter(Boolean)
    .join(" ");
}

function inferReasoningCapability(modelId: string): boolean {
  return REASONING_TOKEN_PATTERN.test(modelId.trim().toLowerCase());
}

export function inferVisionCapability(params: {
  modelId: string;
  providerId?: string | null;
  family?: string | null;
  description?: string | null;
}): boolean {
  const { modelId, providerId, family, description } = params;
  const text = buildSearchText([modelId, family, description]);
  const provider = normalize(providerId);

  if (!text) {
    return false;
  }

  if (NON_VISION_PATTERN.test(text) || IMAGE_GENERATION_PATTERN.test(text)) {
    return false;
  }

  if (VISION_HINT_PATTERN.test(text)) {
    return true;
  }

  if (OPENAI_VISION_PATTERN.test(text)) {
    return true;
  }

  if (provider === "codex" || provider === "openai") {
    return OPENAI_VISION_PATTERN.test(text);
  }

  if (provider === "gemini") {
    return GEMINI_VISION_PATTERN.test(text);
  }

  if (provider === "anthropic" || provider === "claude") {
    return CLAUDE_VISION_PATTERN.test(text);
  }

  if (provider === "qwen" || provider === "alibaba") {
    return QWEN_VISION_PATTERN.test(text);
  }

  if (provider === "zhipuai") {
    return GLM_VISION_PATTERN.test(text);
  }

  return (
    GEMINI_VISION_PATTERN.test(text) ||
    CLAUDE_VISION_PATTERN.test(text) ||
    QWEN_VISION_PATTERN.test(text) ||
    GLM_VISION_PATTERN.test(text)
  );
}

export function inferModelCapabilities(params: {
  modelId: string;
  providerId?: string | null;
  family?: string | null;
  description?: string | null;
}): ModelCapabilities {
  const { modelId, providerId, family, description } = params;
  return {
    vision: inferVisionCapability({
      modelId,
      providerId,
      family,
      description,
    }),
    tools: true,
    streaming: true,
    json_mode: true,
    function_calling: true,
    reasoning: inferReasoningCapability(modelId),
  };
}
