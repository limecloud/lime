import { apiKeyProviderApi } from "@/lib/api/apiKeyProvider";
import type { CompanionPetLive2DActionPayload } from "@/lib/api/companion";
import { getConfig } from "@/lib/api/appConfig";
import {
  getCompanionDefaultsFromConfig,
  resolveCompanionQuickActionTarget,
} from "./preferences";

export { selectCompanionQuickActionProvider } from "./preferences";

export type CompanionPetQuickAction = "cheer" | "next-step";

export interface CompanionPetQuickActionResult {
  bubbleText: string;
  providerId: string;
  latencyMs?: number;
}

export interface CompanionPetConversationResult {
  bubbleText: string;
  providerId: string;
  latencyMs?: number;
  live2dAction?: CompanionPetLive2DActionPayload;
}

interface CompanionPetConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const SUPPORTED_LIVE2D_EMOTION_TAGS = [
  "neutral",
  "joy",
  "sadness",
  "surprise",
  "anger",
  "fear",
  "disgust",
  "smirk",
] as const;

const supportedLive2DEmotionTagSet = new Set<string>(
  SUPPORTED_LIVE2D_EMOTION_TAGS,
);
const MAX_PET_CONVERSATION_TURNS = 6;
const petConversationHistory: CompanionPetConversationTurn[] = [];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildPrompt(action: CompanionPetQuickAction): string {
  switch (action) {
    case "next-step":
      return [
        "你是“Lime 青柠精灵”桌宠。",
        "请只输出一句中文下一步行动建议。",
        "要求具体、轻量、可立刻执行，不超过26个汉字。",
        "不要使用表情、引号、换行、编号，也不要解释原因。",
      ].join("");
    case "cheer":
    default:
      return [
        "你是“Lime 青柠精灵”桌宠。",
        "请只输出一句中文陪伴或鼓励短句。",
        "语气温柔机灵，不超过24个汉字。",
        "不要使用表情、引号、换行、编号，也不要自我介绍。",
      ].join("");
  }
}

function buildConversationPrompt(userInput: string): string {
  const historyBlock =
    petConversationHistory.length > 0
      ? [
          "最近几轮对话如下，请自然延续语气和上下文。",
          ...petConversationHistory.map((turn) =>
            turn.role === "user"
              ? `用户：${turn.content}`
              : `青柠：${turn.content}`,
          ),
        ].join("")
      : "";

  return [
    "你是“Lime 青柠精灵”桌宠。",
    "用户正在直接和你说话。",
    historyBlock,
    "请直接用中文回复用户，最多两句，总长度不超过48个汉字。",
    `为了驱动 Live2D，你可以插入 0 到 2 个情绪标签：${SUPPORTED_LIVE2D_EMOTION_TAGS.map(
      (tag) => `[${tag}]`,
    ).join(" ")}。`,
    "标签可放在句首或句中，但除了这些标签以外，不要输出任何方括号内容。",
    "语气温柔、机灵、自然，像桌边陪伴，不要使用表情、引号、编号、标题或换行。",
    `用户输入：${userInput}`,
  ].join("");
}

function fallbackBubbleText(action: CompanionPetQuickAction): string {
  return action === "next-step" ? "先把眼前最小的一步做掉" : "青柠会一直陪着你";
}

function fallbackConversationBubbleText(): string {
  return "我在呢，我们慢慢说";
}

function sanitizeBubbleCandidate(value: string | undefined): string {
  return normalizeText(value || "")
    .replace(/^["“”'`]+/, "")
    .replace(/["“”'`]+$/, "")
    .replace(/^[\d*.\s、-]+/, "");
}

function normalizeBubbleText(
  action: CompanionPetQuickAction,
  content: string | undefined,
): string {
  const compact = sanitizeBubbleCandidate(content);

  if (!compact) {
    return fallbackBubbleText(action);
  }

  const chars = Array.from(compact);
  if (chars.length <= 30) {
    return compact;
  }

  return `${chars.slice(0, 30).join("")}…`;
}

interface NormalizedConversationBubble {
  bubbleText: string;
  emotionTags: string[];
}

function normalizeConversationBubble(
  content: string | undefined,
): NormalizedConversationBubble {
  const emotionTags: string[] = [];
  const contentWithoutTags = (content || "").replace(
    /\[([a-z0-9_-]+)\]/gi,
    (match, rawTag: string) => {
      const tag = rawTag.toLowerCase();
      if (!supportedLive2DEmotionTagSet.has(tag)) {
        return match;
      }
      if (!emotionTags.includes(tag)) {
        emotionTags.push(tag);
      }
      return " ";
    },
  );
  const compact = sanitizeBubbleCandidate(contentWithoutTags);

  if (!compact) {
    return {
      bubbleText: fallbackConversationBubbleText(),
      emotionTags,
    };
  }

  const chars = Array.from(compact);
  if (chars.length <= 56) {
    return {
      bubbleText: compact,
      emotionTags,
    };
  }

  return {
    bubbleText: `${chars.slice(0, 56).join("")}…`,
    emotionTags,
  };
}

function missingProviderMessage(): string {
  return "还没找到可聊天的 AI 服务商，先去 Lime 里配置一个吧";
}

function appendPetConversationTurn(
  role: CompanionPetConversationTurn["role"],
  content: string,
): void {
  const normalizedContent = normalizeText(content);
  if (!normalizedContent) {
    return;
  }

  petConversationHistory.push({
    role,
    content: normalizedContent,
  });

  if (petConversationHistory.length > MAX_PET_CONVERSATION_TURNS) {
    petConversationHistory.splice(
      0,
      petConversationHistory.length - MAX_PET_CONVERSATION_TURNS,
    );
  }
}

export function resetCompanionPetConversationHistory(): void {
  petConversationHistory.length = 0;
}

async function resolveGeneralChatTarget() {
  const [config, providers] = await Promise.all([
    getConfig(),
    apiKeyProviderApi.getProviders({
      forceRefresh: true,
    }),
  ]);
  const companionDefaults = getCompanionDefaultsFromConfig(config);
  return resolveCompanionQuickActionTarget(
    providers,
    companionDefaults.general,
  );
}

export async function runCompanionPetQuickAction(
  action: CompanionPetQuickAction,
): Promise<CompanionPetQuickActionResult> {
  const target = await resolveGeneralChatTarget();

  if (!target) {
    throw new Error(missingProviderMessage());
  }

  const result = await apiKeyProviderApi.testChat(
    target.provider.id,
    target.modelName,
    buildPrompt(action),
  );

  if (!result.success) {
    throw new Error(
      normalizeText(result.error || "") || "青柠这次暂时没有连上可用模型",
    );
  }

  return {
    bubbleText: normalizeBubbleText(action, result.content),
    providerId: target.provider.id,
    latencyMs: result.latency_ms,
  };
}

export async function runCompanionPetConversation(
  input: string,
): Promise<CompanionPetConversationResult> {
  const normalizedInput = normalizeText(input);
  if (!normalizedInput) {
    throw new Error("你先跟我说一句话吧");
  }

  const target = await resolveGeneralChatTarget();
  if (!target) {
    throw new Error(missingProviderMessage());
  }

  const result = await apiKeyProviderApi.testChat(
    target.provider.id,
    target.modelName,
    buildConversationPrompt(normalizedInput),
  );

  if (!result.success) {
    throw new Error(
      normalizeText(result.error || "") || "青柠这次暂时没想好怎么回你",
    );
  }

  const normalizedConversation = normalizeConversationBubble(result.content);
  appendPetConversationTurn("user", normalizedInput);
  appendPetConversationTurn("assistant", normalizedConversation.bubbleText);

  return {
    bubbleText: normalizedConversation.bubbleText,
    providerId: target.provider.id,
    latencyMs: result.latency_ms,
    live2dAction:
      normalizedConversation.emotionTags.length > 0
        ? {
            emotion_tags: normalizedConversation.emotionTags,
          }
        : undefined,
  };
}
