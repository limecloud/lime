import { useCallback } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type { BrowserTaskRequirementMatch } from "../utils/browserTaskRequirement";
import { detectBrowserTaskRequirement } from "../utils/browserTaskRequirement";
import type { MessageImage } from "../types";
import type { BrowserTaskPreflight, HandleSendOptions } from "./handleSendTypes";

interface BuildThemeWorkbenchSendBoundaryStateOptions {
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

export interface ThemeWorkbenchSendBoundaryState {
  sourceText: string;
  browserRequirementMatch: BrowserTaskRequirementMatch | null;
  shouldConsumePendingThemeWorkbenchInitialPrompt: boolean;
  shouldDismissThemeWorkbenchEntryPrompt: boolean;
}

interface CreateBrowserTaskPreflightOptions {
  sourceText: string;
  images?: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  sendExecutionStrategy?: "react" | "code_orchestrated" | "auto";
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
  browserRequirementMatch: BrowserTaskRequirementMatch;
  createRequestId?: () => string;
  now?: () => number;
}

interface UseThemeWorkbenchSendBoundaryOptions {
  isThemeWorkbench: boolean;
  contentId?: string;
  initialDispatchKey: string | null;
  consumedInitialPromptKey: string | null;
  initialUserImages?: MessageImage[];
  mappedTheme: string;
  socialArticleSkillKey: string;
  isBrowserAssistReady: boolean;
  onConsumeInitialPrompt: (dispatchKey: string) => void;
  onResetConsumedInitialPrompt: () => void;
  onClearEntryPrompt: () => void;
  onPrepareBrowserTaskPreflight: (preflight: BrowserTaskPreflight) => void;
}

interface StartBrowserTaskPreflightOptions {
  boundary: ThemeWorkbenchSendBoundaryState;
  images?: MessageImage[];
  webSearch?: boolean;
  thinking?: boolean;
  sendExecutionStrategy?: "react" | "code_orchestrated" | "auto";
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
}

function defaultCreateBrowserTaskPreflightRequestId() {
  return `browser-preflight:${crypto.randomUUID()}`;
}

export function buildThemeWorkbenchSendBoundaryState({
  isThemeWorkbench,
  contentId,
  initialDispatchKey,
  consumedInitialPromptKey,
  initialUserImages,
  mappedTheme,
  socialArticleSkillKey,
  sourceText,
  sendOptions,
}: BuildThemeWorkbenchSendBoundaryStateOptions): ThemeWorkbenchSendBoundaryState {
  const shouldConsumePendingThemeWorkbenchInitialPrompt =
    isThemeWorkbench &&
    Boolean(contentId) &&
    Boolean(initialDispatchKey) &&
    consumedInitialPromptKey !== initialDispatchKey &&
    (initialUserImages || []).length === 0 &&
    !sendOptions?.purpose;
  const shouldDismissThemeWorkbenchEntryPrompt =
    isThemeWorkbench && !sendOptions?.purpose;

  let nextSourceText = sourceText;

  if (
    isThemeWorkbench &&
    mappedTheme === "social-media" &&
    nextSourceText.trim() &&
    !nextSourceText.trimStart().startsWith("/") &&
    !sendOptions?.skipThemeSkillPrefix
  ) {
    nextSourceText = `/${socialArticleSkillKey} ${nextSourceText}`.trim();
  }

  const browserRequirementMatch =
    mappedTheme === "general" && !sendOptions?.purpose
      ? detectBrowserTaskRequirement(nextSourceText)
      : null;

  return {
    sourceText: nextSourceText,
    browserRequirementMatch,
    shouldConsumePendingThemeWorkbenchInitialPrompt,
    shouldDismissThemeWorkbenchEntryPrompt,
  };
}

export function createBrowserTaskPreflight({
  sourceText,
  images,
  webSearch,
  thinking,
  sendExecutionStrategy,
  autoContinuePayload,
  sendOptions,
  browserRequirementMatch,
  createRequestId = defaultCreateBrowserTaskPreflightRequestId,
  now = () => Date.now(),
}: CreateBrowserTaskPreflightOptions): BrowserTaskPreflight {
  return {
    requestId: createRequestId(),
    createdAt: now(),
    sourceText,
    images: images || [],
    webSearch,
    thinking,
    sendExecutionStrategy,
    autoContinuePayload,
    sendOptions,
    requirement: browserRequirementMatch.requirement,
    reason: browserRequirementMatch.reason,
    phase: "launching",
    launchUrl: browserRequirementMatch.launchUrl,
    platformLabel: browserRequirementMatch.platformLabel,
    detail: "正在尝试建立浏览器会话，请稍候...",
  };
}

export function useThemeWorkbenchSendBoundary({
  isThemeWorkbench,
  contentId,
  initialDispatchKey,
  consumedInitialPromptKey,
  initialUserImages,
  mappedTheme,
  socialArticleSkillKey,
  isBrowserAssistReady,
  onConsumeInitialPrompt,
  onResetConsumedInitialPrompt,
  onClearEntryPrompt,
  onPrepareBrowserTaskPreflight,
}: UseThemeWorkbenchSendBoundaryOptions) {
  const resolveSendBoundary = useCallback(
    ({ sourceText, sendOptions }: { sourceText: string; sendOptions?: HandleSendOptions }) =>
      buildThemeWorkbenchSendBoundaryState({
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

  const maybeStartBrowserTaskPreflight = useCallback(
    ({
      boundary,
      images,
      webSearch,
      thinking,
      sendExecutionStrategy,
      autoContinuePayload,
      sendOptions,
    }: StartBrowserTaskPreflightOptions) => {
      if (!boundary.browserRequirementMatch || isBrowserAssistReady) {
        return false;
      }

      const preflight = createBrowserTaskPreflight({
        sourceText: boundary.sourceText,
        images,
        webSearch,
        thinking,
        sendExecutionStrategy,
        autoContinuePayload,
        sendOptions,
        browserRequirementMatch: boundary.browserRequirementMatch,
      });

      onPrepareBrowserTaskPreflight(preflight);

      if (
        boundary.shouldConsumePendingThemeWorkbenchInitialPrompt &&
        initialDispatchKey
      ) {
        onConsumeInitialPrompt(initialDispatchKey);
      }

      if (boundary.shouldDismissThemeWorkbenchEntryPrompt) {
        onClearEntryPrompt();
      }

      return true;
    },
    [
      initialDispatchKey,
      isBrowserAssistReady,
      onClearEntryPrompt,
      onConsumeInitialPrompt,
      onPrepareBrowserTaskPreflight,
    ],
  );

  const finalizeAfterSendSuccess = useCallback(
    (boundary: ThemeWorkbenchSendBoundaryState) => {
      if (
        boundary.shouldConsumePendingThemeWorkbenchInitialPrompt &&
        initialDispatchKey
      ) {
        onConsumeInitialPrompt(initialDispatchKey);
      }

      if (boundary.shouldDismissThemeWorkbenchEntryPrompt) {
        onClearEntryPrompt();
      }
    },
    [initialDispatchKey, onClearEntryPrompt, onConsumeInitialPrompt],
  );

  const rollbackAfterSendFailure = useCallback(
    (boundary: ThemeWorkbenchSendBoundaryState) => {
      if (boundary.shouldConsumePendingThemeWorkbenchInitialPrompt) {
        onResetConsumedInitialPrompt();
      }
    },
    [onResetConsumedInitialPrompt],
  );

  return {
    resolveSendBoundary,
    maybeStartBrowserTaskPreflight,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
  };
}
