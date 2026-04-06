import { useCallback } from "react";
import type { GeneralWorkbenchEntryPromptState } from "./useGeneralWorkbenchEntryPrompt";

interface DismissGeneralWorkbenchEntryPromptOptions {
  consumeInitialPrompt?: boolean;
  onConsumeInitialPrompt?: () => void;
}

interface UseGeneralWorkbenchEntryPromptActionsOptions {
  generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
  input: string;
  initialDispatchKey: string | null;
  onContinuePrompt: (prompt: string) => Promise<void> | void;
  dismissGeneralWorkbenchEntryPrompt: (
    options?: DismissGeneralWorkbenchEntryPromptOptions,
  ) => void;
  onConsumeInitialPrompt?: (dispatchKey: string | null) => void;
  onInputChange: (value: string) => void;
  onRequirePrompt?: () => void;
}

export function useGeneralWorkbenchEntryPromptActions({
  generalWorkbenchEntryPrompt,
  input,
  initialDispatchKey,
  onContinuePrompt,
  dismissGeneralWorkbenchEntryPrompt,
  onConsumeInitialPrompt,
  onInputChange,
  onRequirePrompt,
}: UseGeneralWorkbenchEntryPromptActionsOptions) {
  const handleContinueGeneralWorkbenchEntryPrompt = useCallback(async () => {
    if (!generalWorkbenchEntryPrompt) {
      return;
    }

    const promptToSend =
      input.trim() || generalWorkbenchEntryPrompt.prompt.trim();
    if (!promptToSend) {
      onRequirePrompt?.();
      return;
    }

    await onContinuePrompt(promptToSend);
  }, [generalWorkbenchEntryPrompt, input, onContinuePrompt, onRequirePrompt]);

  const handleRestartGeneralWorkbenchEntryPrompt = useCallback(() => {
    if (!generalWorkbenchEntryPrompt) {
      return;
    }

    dismissGeneralWorkbenchEntryPrompt({
      consumeInitialPrompt:
        generalWorkbenchEntryPrompt.kind === "initial_prompt",
      onConsumeInitialPrompt: () => {
        onConsumeInitialPrompt?.(initialDispatchKey);
      },
    });
    onInputChange("");
  }, [
    dismissGeneralWorkbenchEntryPrompt,
    generalWorkbenchEntryPrompt,
    initialDispatchKey,
    onConsumeInitialPrompt,
    onInputChange,
  ]);

  return {
    handleContinueGeneralWorkbenchEntryPrompt,
    handleRestartGeneralWorkbenchEntryPrompt,
  };
}
