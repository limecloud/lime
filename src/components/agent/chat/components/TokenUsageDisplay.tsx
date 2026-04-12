/**
 * Token 使用量显示组件
 *
 * 在响应完成后显示 token 使用量
 * Requirements: 9.5 - THE Frontend SHALL display token usage statistics after each Agent response
 */

import React from "react";
import styled from "styled-components";
import { Coins } from "lucide-react";
import type { AgentTokenUsage as TokenUsage } from "@/lib/api/agentProtocol";

const COMPACT_UNITS = [
  { threshold: 1_000_000_000, suffix: "B" },
  { threshold: 1_000_000, suffix: "M" },
  { threshold: 1_000, suffix: "K" },
] as const;

const UsageContainer = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  background-color: hsl(var(--muted) / 0.5);
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  margin-top: 8px;
`;

const UsageIcon = styled(Coins)`
  width: 12px;
  height: 12px;
  opacity: 0.55;
`;

const UsageText = styled.span`
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
`;

const UsageMeta = styled.span`
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
`;

export interface TokenUsagePromptCacheNotice {
  label: string;
  detail?: string;
  source?: "configured_provider" | "selection_fallback";
}

interface TokenUsageDisplayProps {
  usage: TokenUsage;
  className?: string;
  promptCacheNotice?: TokenUsagePromptCacheNotice | null;
}

function formatCompactTokenCount(value: number): string {
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

/**
 * Token 使用量显示组件
 *
 * 显示输入/输出 token 数量
 */
export const TokenUsageDisplay: React.FC<TokenUsageDisplayProps> = ({
  usage,
  className,
  promptCacheNotice,
}) => {
  const total = usage.input_tokens + usage.output_tokens;
  const cachedInput = Math.max(0, usage.cached_input_tokens ?? 0);
  const missingPromptCacheNotice =
    cachedInput > 0 ? null : (promptCacheNotice ?? null);

  return (
    <UsageContainer
      className={className}
      title={missingPromptCacheNotice?.detail}
    >
      <UsageIcon />
      <UsageText>{formatCompactTokenCount(total)} tokens</UsageText>
      {cachedInput > 0 ? (
        <UsageMeta>{`· 命中缓存 ${formatCompactTokenCount(cachedInput)}`}</UsageMeta>
      ) : null}
      {missingPromptCacheNotice ? (
        <UsageMeta data-testid="token-usage-prompt-cache-notice">
          {`· ${missingPromptCacheNotice.label}`}
        </UsageMeta>
      ) : null}
    </UsageContainer>
  );
};

export default TokenUsageDisplay;
