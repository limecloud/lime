import { useCallback } from "react";
import type { ThemeWorkbenchEntryPromptState } from "./useThemeWorkbenchEntryPrompt";

interface DismissThemeWorkbenchEntryPromptOptions {
  consumeInitialPrompt?: boolean;
  onConsumeInitialPrompt?: () => void;
}

interface UseThemeWorkbenchEntryPromptActionsOptions {
  themeWorkbenchEntryPrompt: ThemeWorkbenchEntryPromptState | null;
  input: string;
  initialDispatchKey: string | null;
  onContinuePrompt: (prompt: string) => Promise<void> | void;
  dismissThemeWorkbenchEntryPrompt: (
    options?: DismissThemeWorkbenchEntryPromptOptions,
  ) => void;
  onConsumeInitialPrompt?: (dispatchKey: string | null) => void;
  onInputChange: (value: string) => void;
  onRequirePrompt?: () => void;
}

export function useThemeWorkbenchEntryPromptActions({
  themeWorkbenchEntryPrompt,
  input,
  initialDispatchKey,
  onContinuePrompt,
  dismissThemeWorkbenchEntryPrompt,
  onConsumeInitialPrompt,
  onInputChange,
  onRequirePrompt,
}: UseThemeWorkbenchEntryPromptActionsOptions) {
  const handleContinueThemeWorkbenchEntryPrompt = useCallback(async () => {
    if (!themeWorkbenchEntryPrompt) {
      return;
    }

    const promptToSend =
      input.trim() || themeWorkbenchEntryPrompt.prompt.trim();
    if (!promptToSend) {
      onRequirePrompt?.();
      return;
    }

    await onContinuePrompt(promptToSend);
  }, [input, onContinuePrompt, onRequirePrompt, themeWorkbenchEntryPrompt]);

  const handleRestartThemeWorkbenchEntryPrompt = useCallback(() => {
    if (!themeWorkbenchEntryPrompt) {
      return;
    }

    dismissThemeWorkbenchEntryPrompt({
      consumeInitialPrompt: themeWorkbenchEntryPrompt.kind === "initial_prompt",
      onConsumeInitialPrompt: () => {
        onConsumeInitialPrompt?.(initialDispatchKey);
      },
    });
    onInputChange("");
  }, [
    dismissThemeWorkbenchEntryPrompt,
    initialDispatchKey,
    onConsumeInitialPrompt,
    onInputChange,
    themeWorkbenchEntryPrompt,
  ]);

  return {
    handleContinueThemeWorkbenchEntryPrompt,
    handleRestartThemeWorkbenchEntryPrompt,
  };
}
