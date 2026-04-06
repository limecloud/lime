import { memo } from "react";
import { Info } from "lucide-react";
import styled from "styled-components";
import type { GeneralWorkbenchEntryPromptState } from "../hooks/useGeneralWorkbenchEntryPrompt";

interface GeneralWorkbenchEntryPromptAccessoryProps {
  prompt: GeneralWorkbenchEntryPromptState;
  onRestart: () => void;
  onContinue: () => Promise<void> | void;
}

const GeneralWorkbenchEntryPromptCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: min(360px, calc(100vw - 48px));
  max-width: min(420px, calc(100vw - 48px));
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(191, 219, 254, 0.92);
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.98) 0%,
    rgba(239, 246, 255, 0.96) 100%
  );
  color: #0f172a;
  box-shadow: 0 18px 34px -28px rgba(15, 23, 42, 0.26);
`;

const GeneralWorkbenchEntryPromptHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

const GeneralWorkbenchEntryPromptTitleWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const GeneralWorkbenchEntryPromptTitle = styled.span`
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
`;

const GeneralWorkbenchEntryPromptDescription = styled.span`
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
`;

const GeneralWorkbenchEntryPromptActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const GeneralWorkbenchEntryPromptButton = styled.button<{
  $variant?: "primary" | "ghost";
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 88px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "ghost"
        ? "rgba(191, 219, 254, 0.92)"
        : "rgba(59, 130, 246, 0.94)"};
  background: ${({ $variant }) =>
    $variant === "ghost"
      ? "rgba(255, 255, 255, 0.92)"
      : "linear-gradient(180deg, rgba(59,130,246,0.96) 0%, rgba(37,99,235,0.96) 100%)"};
  color: ${({ $variant }) => ($variant === "ghost" ? "#1e293b" : "#eff6ff")};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 24px -18px rgba(37, 99, 235, 0.46);
    background: ${({ $variant }) =>
      $variant === "ghost"
        ? "rgba(239, 246, 255, 0.98)"
        : "linear-gradient(180deg, rgba(37,99,235,0.98) 0%, rgba(29,78,216,0.98) 100%)"};
  }
`;

export const GeneralWorkbenchEntryPromptAccessory = memo(
  function GeneralWorkbenchEntryPromptAccessory({
    prompt,
    onRestart,
    onContinue,
  }: GeneralWorkbenchEntryPromptAccessoryProps) {
    return (
      <GeneralWorkbenchEntryPromptCard data-testid="theme-workbench-entry-prompt">
        <GeneralWorkbenchEntryPromptHeader>
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <GeneralWorkbenchEntryPromptTitleWrap>
            <GeneralWorkbenchEntryPromptTitle>
              {prompt.title}
            </GeneralWorkbenchEntryPromptTitle>
            <GeneralWorkbenchEntryPromptDescription>
              {prompt.description}
            </GeneralWorkbenchEntryPromptDescription>
          </GeneralWorkbenchEntryPromptTitleWrap>
        </GeneralWorkbenchEntryPromptHeader>
        <GeneralWorkbenchEntryPromptActions>
          <GeneralWorkbenchEntryPromptButton
            type="button"
            $variant="ghost"
            data-testid="theme-workbench-entry-restart"
            onClick={onRestart}
          >
            重新开始
          </GeneralWorkbenchEntryPromptButton>
          <GeneralWorkbenchEntryPromptButton
            type="button"
            data-testid="theme-workbench-entry-continue"
            onClick={() => {
              void onContinue();
            }}
          >
            {prompt.actionLabel}
          </GeneralWorkbenchEntryPromptButton>
        </GeneralWorkbenchEntryPromptActions>
      </GeneralWorkbenchEntryPromptCard>
    );
  },
);
