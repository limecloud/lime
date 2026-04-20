import type { ProviderType } from "@/lib/types/provider";
const LOCAL_OPENAI_LIKE_PROVIDER_IDS = new Set([
  "ollama",
  "lmstudio",
  "gpustack",
  "ovms",
]);

function normalize(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function isLikelyLocalHost(apiHost?: string | null): boolean {
  const host = normalize(apiHost);
  if (!host) {
    return false;
  }

  return (
    host.includes("://localhost") ||
    host.includes("://127.0.0.1") ||
    host.includes("://0.0.0.0") ||
    host.includes("://host.docker.internal")
  );
}

interface ProviderModelAutoFetchCapability {
  supported: boolean;
  requiresApiKey: boolean;
  requiresLiveModelTruth: boolean;
  unsupportedReason?: string;
}

export function getProviderModelAutoFetchCapability(input: {
  providerId?: string | null;
  providerType?: string | null;
  apiHost?: string | null;
}): ProviderModelAutoFetchCapability {
  const providerId = normalize(input.providerId);
  const providerType = normalize(input.providerType) as ProviderType | "";
  const localHost = isLikelyLocalHost(input.apiHost);

  switch (providerType) {
    case "openai":
    case "openai-response":
    case "codex":
    case "new-api":
    case "gateway":
    case "fal":
      return {
        supported: true,
        requiresApiKey:
          !LOCAL_OPENAI_LIKE_PROVIDER_IDS.has(providerId) && !localHost,
        requiresLiveModelTruth: true,
      };
    case "anthropic":
      return {
        supported: true,
        requiresApiKey: true,
        requiresLiveModelTruth: true,
      };
    case "anthropic-compatible":
      return {
        supported: true,
        requiresApiKey: true,
        requiresLiveModelTruth: false,
      };
    case "gemini":
      return {
        supported: true,
        requiresApiKey: true,
        requiresLiveModelTruth: true,
      };
    case "ollama":
      return {
        supported: true,
        requiresApiKey: false,
        requiresLiveModelTruth: true,
      };
    case "azure-openai":
      return {
        supported: false,
        requiresApiKey: true,
        requiresLiveModelTruth: false,
        unsupportedReason:
          "Azure OpenAI 的模型枚举仍需单独适配资源端点与 API Version，当前不展示自动获取入口。",
      };
    case "vertexai":
      return {
        supported: false,
        requiresApiKey: false,
        requiresLiveModelTruth: false,
        unsupportedReason:
          "Vertex AI 需要单独的云端认证与项目上下文，当前不展示自动获取入口。",
      };
    case "aws-bedrock":
      return {
        supported: false,
        requiresApiKey: false,
        requiresLiveModelTruth: false,
        unsupportedReason:
          "AWS Bedrock 需要专门的云凭证签名流程，当前不展示自动获取入口。",
      };
    default:
      return {
        supported: false,
        requiresApiKey: true,
        requiresLiveModelTruth: false,
        unsupportedReason: "当前协议暂不支持自动获取最新模型。",
      };
  }
}
