import { useCallback } from "react";
import type { BrowserTaskRequirementMatch } from "../utils/browserTaskRequirement";
import { detectBrowserTaskRequirement } from "../utils/browserTaskRequirement";
import type { MessageImage } from "../types";
import type { HandleSendOptions } from "./handleSendTypes";

interface BuildGeneralWorkbenchSendBoundaryStateOptions {
  isThemeWorkbench: boolean;
  contentId?: string;
  initialDispatchKey: string | null;
  consumedInitialPromptKey: string | null;
  initialUserImages?: MessageImage[];
  mappedTheme: string;
  socialArticleSkillKey: string;
  sourceText: string;
  sendOptions?: HandleSendOptions;
}

export interface GeneralWorkbenchSendBoundaryState {
  sourceText: string;
  browserRequirementMatch: BrowserTaskRequirementMatch | null;
  shouldConsumePendingGeneralWorkbenchInitialPrompt: boolean;
  shouldDismissGeneralWorkbenchEntryPrompt: boolean;
}

interface UseGeneralWorkbenchSendBoundaryOptions {
  isThemeWorkbench: boolean;
  contentId?: string;
  initialDispatchKey: string | null;
  consumedInitialPromptKey: string | null;
  initialUserImages?: MessageImage[];
  mappedTheme: string;
  socialArticleSkillKey: string;
  onConsumeInitialPrompt: (dispatchKey: string) => void;
  onResetConsumedInitialPrompt: () => void;
  onClearEntryPrompt: () => void;
}

export function buildGeneralWorkbenchSendBoundaryState({
  isThemeWorkbench,
  contentId,
  initialDispatchKey,
  consumedInitialPromptKey,
  initialUserImages,
  mappedTheme,
  socialArticleSkillKey,
  sourceText,
  sendOptions,
}: BuildGeneralWorkbenchSendBoundaryStateOptions): GeneralWorkbenchSendBoundaryState {
  const shouldConsumePendingGeneralWorkbenchInitialPrompt =
    isThemeWorkbench &&
    Boolean(contentId) &&
    Boolean(initialDispatchKey) &&
    consumedInitialPromptKey !== initialDispatchKey &&
    (initialUserImages || []).length === 0 &&
    !sendOptions?.purpose;
  const shouldDismissGeneralWorkbenchEntryPrompt =
    isThemeWorkbench && !sendOptions?.purpose;

  const trimmedSourceText = sourceText.trim();
  const shouldWrapWithGeneralWorkbenchSkill =
    isThemeWorkbench &&
    mappedTheme === "general" &&
    !sendOptions?.purpose &&
    trimmedSourceText.length > 0 &&
    !trimmedSourceText.startsWith("/") &&
    !trimmedSourceText.startsWith("@");
  const nextSourceText = shouldWrapWithGeneralWorkbenchSkill
    ? `/${socialArticleSkillKey} ${trimmedSourceText}`
    : sourceText;
  const browserRequirementSourceText = shouldWrapWithGeneralWorkbenchSkill
    ? trimmedSourceText
    : nextSourceText;

  const browserRequirementMatch =
    mappedTheme === "general" && !sendOptions?.purpose
      ? detectBrowserTaskRequirement(browserRequirementSourceText)
      : null;

  return {
    sourceText: nextSourceText,
    browserRequirementMatch,
    shouldConsumePendingGeneralWorkbenchInitialPrompt,
    shouldDismissGeneralWorkbenchEntryPrompt,
  };
}

export function useGeneralWorkbenchSendBoundary({
  isThemeWorkbench,
  contentId,
  initialDispatchKey,
  consumedInitialPromptKey,
  initialUserImages,
  mappedTheme,
  socialArticleSkillKey,
  onConsumeInitialPrompt,
  onResetConsumedInitialPrompt,
  onClearEntryPrompt,
}: UseGeneralWorkbenchSendBoundaryOptions) {
  const resolveSendBoundary = useCallback(
    ({
      sourceText,
      sendOptions,
    }: {
      sourceText: string;
      sendOptions?: HandleSendOptions;
    }) =>
      buildGeneralWorkbenchSendBoundaryState({
        isThemeWorkbench,
        contentId,
        initialDispatchKey,
        consumedInitialPromptKey,
        initialUserImages,
        mappedTheme,
        socialArticleSkillKey,
        sourceText,
        sendOptions,
      }),
    [
      consumedInitialPromptKey,
      contentId,
      initialDispatchKey,
      initialUserImages,
      isThemeWorkbench,
      mappedTheme,
      socialArticleSkillKey,
    ],
  );

  const finalizeAfterSendSuccess = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (
        boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt &&
        initialDispatchKey
      ) {
        onConsumeInitialPrompt(initialDispatchKey);
      }

      if (boundary.shouldDismissGeneralWorkbenchEntryPrompt) {
        onClearEntryPrompt();
      }
    },
    [initialDispatchKey, onClearEntryPrompt, onConsumeInitialPrompt],
  );

  const rollbackAfterSendFailure = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt) {
        onResetConsumedInitialPrompt();
      }
    },
    [onResetConsumedInitialPrompt],
  );

  return {
    resolveSendBoundary,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
  };
}
