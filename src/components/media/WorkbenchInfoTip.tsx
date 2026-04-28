import React from "react";
import { CircleHelp } from "lucide-react";
import styled, { css } from "styled-components";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type WorkbenchInfoTipTone = "slate" | "sky" | "mint";
type WorkbenchInfoTipVariant = "icon" | "pill";

interface WorkbenchInfoTipProps {
  content: React.ReactNode;
  ariaLabel: string;
  label?: string;
  tone?: WorkbenchInfoTipTone;
  variant?: WorkbenchInfoTipVariant;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

const toneStyles: Record<WorkbenchInfoTipTone, ReturnType<typeof css>> = {
  slate: css`
    border: 1px solid var(--lime-surface-border, hsl(var(--border) / 0.9));
    background: var(--lime-surface, hsl(var(--background) / 0.92));
    color: var(--lime-text-muted, hsl(var(--muted-foreground)));
  `,
  sky: css`
    border: 1px solid var(--lime-info-border, hsl(203 82% 88%));
    background: var(--lime-info-soft, hsl(200 100% 97%));
    color: var(--lime-info, hsl(211 58% 38%));
  `,
  mint: css`
    border: 1px solid var(--lime-surface-border-strong, hsl(154 36% 82%));
    background: var(--lime-brand-soft, hsl(154 48% 97%));
    color: var(--lime-brand-strong, hsl(154 50% 28%));
  `,
};

const TipTriggerButton = styled.button<{
  $tone: WorkbenchInfoTipTone;
  $variant: WorkbenchInfoTipVariant;
}>`
  flex-shrink: 0;
  border-radius: 999px;
  outline: none;
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
  ${({ $tone }) => toneStyles[$tone]};
  ${({ $variant }) =>
    $variant === "pill"
      ? css`
          height: 30px;
          padding: 0 10px;
          font-size: 12px;
          font-weight: 700;
        `
      : css`
          width: 28px;
          height: 28px;
          padding: 0;
        `};

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px var(--lime-shadow-color, hsl(215 30% 14% / 0.08));
  }

  &:focus-visible {
    box-shadow: 0 0 0 4px var(--lime-focus-ring, hsl(211 100% 96%));
  }
`;

const TipTriggerText = styled.span`
  line-height: 1;
`;

const TipCard = styled.div`
  max-width: min(320px, calc(100vw - 24px));
  border-radius: 18px;
  border: 1px solid var(--lime-surface-border, hsl(var(--border) / 0.9));
  background: var(
    --lime-card-subtle,
    linear-gradient(180deg, hsl(var(--background)), hsl(var(--muted) / 0.16))
  );
  padding: 10px 12px;
  box-shadow: 0 18px 36px var(--lime-shadow-color, hsl(215 30% 14% / 0.14));
  font-size: 12px;
  line-height: 1.65;
  color: var(--lime-text, hsl(var(--foreground)));
  white-space: normal;
`;

export function WorkbenchInfoTip({
  content,
  ariaLabel,
  label = "Tips",
  tone = "slate",
  variant = "icon",
  side = "top",
  align = "center",
}: WorkbenchInfoTipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <TipTriggerButton
            type="button"
            aria-label={ariaLabel}
            title={ariaLabel}
            $tone={tone}
            $variant={variant}
          >
            <CircleHelp size={14} />
            {variant === "pill" ? (
              <TipTriggerText>{label}</TipTriggerText>
            ) : null}
          </TipTriggerButton>
        </TooltipTrigger>
        <TooltipContent side={side} align={align} className="whitespace-normal">
          <TipCard>{content}</TipCard>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
