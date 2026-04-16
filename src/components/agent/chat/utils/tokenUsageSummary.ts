import type { AgentTokenUsage as TokenUsage } from "@/lib/api/agentProtocol";

const COMPACT_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const;

export function formatCompactTokenCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const normalized = Math.max(0, value);
  for (const unit of COMPACT_UNITS) {
    if (normalized >= unit.threshold) {
      return `${(normalized / unit.threshold).toFixed(1)}${unit.suffix}`;
    }
  }

  return normalized.toLocaleString();
}

export function resolvePromptCacheActivity(usage?: {
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): number {
  return (
    Math.max(0, usage?.cached_input_tokens ?? 0) +
    Math.max(0, usage?.cache_creation_input_tokens ?? 0)
  );
}

export function resolveUsageInputOutputSummary(
  usage?: TokenUsage,
): string | null {
  if (!usage) {
    return null;
  }

  return `输入 ${formatCompactTokenCount(usage.input_tokens)} / 输出 ${formatCompactTokenCount(
    usage.output_tokens,
  )}`;
}

export function resolvePromptCacheMetaText(
  usage?: TokenUsage,
): string | null {
  const hasCachedRead = Number.isFinite(usage?.cached_input_tokens);
  const hasCacheCreation = Number.isFinite(usage?.cache_creation_input_tokens);

  if (!hasCachedRead && !hasCacheCreation) {
    return null;
  }

  const cachedRead = Math.max(0, usage?.cached_input_tokens ?? 0);
  const cacheCreation = Math.max(0, usage?.cache_creation_input_tokens ?? 0);
  const totalCached = cachedRead + cacheCreation;

  if (totalCached <= 0) {
    return "缓存 0";
  }

  if (hasCacheCreation) {
    if (hasCachedRead) {
      return `缓存 ${formatCompactTokenCount(totalCached)}（读 ${formatCompactTokenCount(
        cachedRead,
      )} / 写 ${formatCompactTokenCount(cacheCreation)}）`;
    }
    return `缓存写 ${formatCompactTokenCount(cacheCreation)}`;
  }

  return `缓存 ${formatCompactTokenCount(cachedRead)}`;
}
