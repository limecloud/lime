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
import {
  formatCompactTokenCount,
  resolvePromptCacheActivity,
  resolvePromptCacheMetaText,
} from "../utils/tokenUsageSummary";

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
  inline?: boolean;
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
  inline = false,
}) => {
  const total = usage.input_tokens + usage.output_tokens;
  const totalPromptCacheTokens = resolvePromptCacheActivity(usage);
  const promptCacheMetaText = resolvePromptCacheMetaText(usage);
  const missingPromptCacheNotice =
    totalPromptCacheTokens > 0 ? null : (promptCacheNotice ?? null);

  return (
    <UsageContainer
      className={className}
      style={inline ? { marginTop: 0 } : undefined}
      title={missingPromptCacheNotice?.detail}
    >
      <UsageIcon />
      <UsageText>{formatCompactTokenCount(total)} tokens</UsageText>
      {promptCacheMetaText ? (
        <UsageMeta>{`· ${promptCacheMetaText}`}</UsageMeta>
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
