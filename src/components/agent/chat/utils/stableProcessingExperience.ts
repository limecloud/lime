export interface StableProcessingExperienceOptions {
  providerType?: string | null;
  model?: string | null;
}

export type StableProcessingScope = "request" | "team";

export const STABLE_PROCESSING_LABEL = "稳妥模式";

const HIGH_RISK_PROVIDER_KEYWORDS = [
  "glm",
  "zhipu",
  "zhipuai",
  "zai",
  "bigmodel",
] as const;

function normalizeStableProcessingValue(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesHighRiskProvider(value: string): boolean {
  return HIGH_RISK_PROVIDER_KEYWORDS.some((keyword) => value.includes(keyword));
}

export function resolveStableProcessingProviderGroup(
  options: StableProcessingExperienceOptions,
): string | null {
  const candidates = [options.providerType, options.model]
    .map((value) => normalizeStableProcessingValue(value))
    .filter(Boolean);

  return candidates.some((value) => matchesHighRiskProvider(value))
    ? "zhipuai"
    : null;
}

export function shouldShowStableProcessingNotice(
  options: StableProcessingExperienceOptions,
): boolean {
  return Boolean(resolveStableProcessingProviderGroup(options));
}

export function getStableProcessingDescription(
  scope: StableProcessingScope = "request",
): string {
  if (scope === "team") {
    return "当前模型会让子任务依次开始，整体节奏更稳。";
  }

  return "当前模型会在高峰时依次开始同类请求，优先保证稳定完成。";
}
