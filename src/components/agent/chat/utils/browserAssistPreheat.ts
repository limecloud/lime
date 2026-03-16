import {
  hasBrowserAssistIntent,
  shouldAutoOpenBrowserAssistForPrompt,
} from "./browserAssistIntent";

export type BrowserAssistPreheatNavigationMode =
  | "none"
  | "explicit-url"
  | "best-effort";

export interface BrowserAssistPreheatOptions {
  activeTheme: string;
  sourceText: string;
  ensureBrowserAssistCanvas: (
    sourceText: string,
    options?: {
      silent?: boolean;
      navigationMode?: BrowserAssistPreheatNavigationMode;
    },
  ) => Promise<boolean>;
  onError?: (error: unknown) => void;
}

export function shouldPreheatBrowserAssist(sourceText: string): boolean {
  return (
    shouldAutoOpenBrowserAssistForPrompt(sourceText) ||
    hasBrowserAssistIntent(sourceText)
  );
}

export function preheatBrowserAssistInBackground(
  options: BrowserAssistPreheatOptions,
): boolean {
  if (
    options.activeTheme !== "general" ||
    !shouldPreheatBrowserAssist(options.sourceText)
  ) {
    return false;
  }

  void options
    .ensureBrowserAssistCanvas(options.sourceText, {
      silent: true,
      navigationMode: "best-effort",
    })
    .catch((error) => {
      options.onError?.(error);
    });

  return true;
}
