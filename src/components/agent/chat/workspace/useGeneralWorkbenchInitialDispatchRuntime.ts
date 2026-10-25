import { isRuntimeSubmissionAccepted } from "../hooks/agentSendResult";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { executionRunGetGeneralWorkbenchState } from "@/lib/api/executionRun";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { MessageImage } from "../types";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import {
  buildGeneralWorkbenchResumePromptFromRunState,
  buildGeneralWorkbenchSendBoundaryState,
  buildInitialDispatchKey,
  type GeneralWorkbenchEntryPromptState,
  type GeneralWorkbenchSendBoundaryState,
  type InitialDispatchPreviewSnapshot,
} from "./workspaceSendHelpers";
import { isCanvasStateEmpty } from "./generalWorkbenchHelpers";
import { getDefaultGuidePromptByTheme } from "../utils/defaultGuidePrompt";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";

const INITIAL_AUTO_SEND_CLAIM_TTL_MS = 30_000;
const claimedInitialAutoSendKeys = new Map<string, number>();

function pruneInitialAutoSendClaims(now: number): void {
  for (const [key, claimedAt] of claimedInitialAutoSendKeys.entries()) {
    if (now - claimedAt > INITIAL_AUTO_SEND_CLAIM_TTL_MS) {
      claimedInitialAutoSendKeys.delete(key);
    }
  }
}

function readNestedString(
  value: unknown,
  path: readonly string[],
): string | null {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : null;
}

function buildInitialAutoSendClaimKey(params: {
  initialDispatchKey: string;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
}): string {
  const launchRequestId =
    readNestedString(params.initialAutoSendRequestMetadata, [
      "harness",
      "plugin_activation_intent",
      "launch_request_id",
    ]) ??
    readNestedString(params.initialAutoSendRequestMetadata, [
      "harness",
      "skill_launch",
      "request_id",
    ]);
  return launchRequestId
    ? `${params.initialDispatchKey}::${launchRequestId}`
    : params.initialDispatchKey;
}

function claimInitialAutoSend(key: string): boolean {
  const now = Date.now();
  pruneInitialAutoSendClaims(now);
  if (claimedInitialAutoSendKeys.has(key)) {
    return false;
  }
  claimedInitialAutoSendKeys.set(key, now);
  return true;
}

function releaseInitialAutoSendClaim(key: string): void {
  claimedInitialAutoSendKeys.delete(key);
}

interface UseGeneralWorkbenchInitialDispatchRuntimeParams {
  activeTheme: string;
  autoRunInitialPromptOnMount: boolean;
  contentId?: string;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  isSending: boolean;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  messagesLength: number;
  onInitialUserPromptConsumed?: () => void;
  queuedTurnsLength: number;
  sessionId?: string | null;
  setInput: Dispatch<SetStateAction<string>>;

  shouldUseCompactGeneralWorkbench: boolean;
}

export interface GeneralWorkbenchInitialDispatchRuntime {
  bootstrapDispatchPreview: InitialDispatchPreviewSnapshot | null;
  clearGeneralWorkbenchEntryPrompt: () => void;
  consumeInitialPrompt: (dispatchKey: string | null) => void;
  consumedInitialPromptRef: MutableRefObject<string | null>;
  dismissGeneralWorkbenchEntryPrompt: (options?: {
    consumeInitialPrompt?: boolean;
    onConsumeInitialPrompt?: () => void;
  }) => void;
  finalizeAfterSendSuccess: (
    boundary: GeneralWorkbenchSendBoundaryState,
  ) => void;
  generalWorkbenchEntryCheckPending: boolean;
  generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
  hasTriggeredGuideRef: MutableRefObject<boolean>;
  initialDispatchKey: string | null;
  isBootstrapDispatchPending: boolean;
  resetGuideState: () => void;
  resolveSendBoundary: (input: {
    sourceText: string;
    sendOptions?: HandleSendOptions;
  }) => GeneralWorkbenchSendBoundaryState;
  rollbackAfterSendFailure: (
    boundary: GeneralWorkbenchSendBoundaryState,
  ) => void;
}

export function useGeneralWorkbenchInitialDispatchRuntime({
  activeTheme,
  autoRunInitialPromptOnMount,
  contentId,
  initialUserPrompt,
  initialUserImages,
  isSending,
  isThemeWorkbench,
  mappedTheme,
  messagesLength,
  onInitialUserPromptConsumed,
  queuedTurnsLength,
  sessionId,
  setInput,

  shouldUseCompactGeneralWorkbench,
}: UseGeneralWorkbenchInitialDispatchRuntimeParams): GeneralWorkbenchInitialDispatchRuntime {
  const hasTriggeredGuideRef = useRef(false);
  const consumedInitialPromptRef = useRef<string | null>(null);
  const consumedInitialPromptKey = consumedInitialPromptRef.current;
  const [bootstrapDispatchSnapshot, setBootstrapDispatchSnapshot] =
    useState<InitialDispatchPreviewSnapshot | null>(null);
  const [generalWorkbenchEntryPrompt, setGeneralWorkbenchEntryPrompt] =
    useState<GeneralWorkbenchEntryPromptState | null>(null);
  const [
    generalWorkbenchEntryCheckPending,
    setGeneralWorkbenchEntryCheckPending,
  ] = useState(false);
  const hydratedPromptSignatureRef = useRef<string | null>(null);
  const dismissedPromptSignatureRef = useRef<string | null>(null);
  const initialDispatchKey = useMemo(
    () => buildInitialDispatchKey(initialUserPrompt, initialUserImages),
    [initialUserImages, initialUserPrompt],
  );

  useEffect(() => {
    if (!initialDispatchKey) {
      return;
    }

    setBootstrapDispatchSnapshot((current) => {
      if (current?.key === initialDispatchKey) {
        return current;
      }
      return {
        key: initialDispatchKey,
        prompt: initialUserPrompt,
        images: initialUserImages || [],
      };
    });
  }, [initialDispatchKey, initialUserImages, initialUserPrompt]);

  useEffect(() => {
    if (messagesLength > 0) {
      setBootstrapDispatchSnapshot(null);
      return;
    }

    if (!initialDispatchKey && !isSending && queuedTurnsLength === 0) {
      setBootstrapDispatchSnapshot(null);
    }
  }, [initialDispatchKey, isSending, messagesLength, queuedTurnsLength]);

  const activeBootstrapDispatch = useMemo(() => {
    if (
      initialDispatchKey &&
      ((initialUserPrompt || "").trim() || (initialUserImages || []).length > 0)
    ) {
      return {
        key: initialDispatchKey,
        prompt: initialUserPrompt,
        images: initialUserImages || [],
      };
    }

    return bootstrapDispatchSnapshot;
  }, [
    bootstrapDispatchSnapshot,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
  ]);
  const isBootstrapDispatchPending =
    activeBootstrapDispatch !== null &&
    consumedInitialPromptKey !== activeBootstrapDispatch.key;
  const bootstrapDispatchPreview =
    !shouldUseCompactGeneralWorkbench &&
    activeBootstrapDispatch &&
    messagesLength === 0 &&
    (isSending || queuedTurnsLength > 0)
      ? activeBootstrapDispatch
      : null;

  useEffect(() => {
    hydratedPromptSignatureRef.current = null;
    dismissedPromptSignatureRef.current = null;
    setGeneralWorkbenchEntryPrompt(null);
    setGeneralWorkbenchEntryCheckPending(false);
  }, [activeTheme, contentId, initialDispatchKey]);

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      return;
    }

    const pendingInitialPromptText = initialUserPrompt || "";
    const pendingInitialPrompt = pendingInitialPromptText.trim();
    const pendingInitialImages = initialUserImages || [];
    if (
      !isThemeWorkbench ||
      autoRunInitialPromptOnMount ||
      !contentId ||
      !initialDispatchKey ||
      !pendingInitialPrompt ||
      pendingInitialImages.length > 0 ||
      messagesLength > 0
    ) {
      return;
    }

    if (
      consumedInitialPromptKey === initialDispatchKey ||
      hydratedPromptSignatureRef.current === initialDispatchKey
    ) {
      return;
    }

    hydratedPromptSignatureRef.current = initialDispatchKey;
    hasTriggeredGuideRef.current = true;
    setInput((previous) =>
      previous.trim() ? previous : pendingInitialPromptText,
    );
    setGeneralWorkbenchEntryPrompt({
      kind: "initial_prompt",
      signature: initialDispatchKey,
      title: "已恢复待执行创作意图",
      description: "进入页面后不会自动开始生成，确认后再继续。",
      actionLabel: "继续生成",
      prompt: pendingInitialPrompt,
    });
  }, [
    autoRunInitialPromptOnMount,
    consumedInitialPromptKey,
    contentId,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isThemeWorkbench,
    messagesLength,
    setInput,
    shouldUseCompactGeneralWorkbench,
  ]);

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      setGeneralWorkbenchEntryCheckPending(false);
      return;
    }

    if (
      !isThemeWorkbench ||
      !contentId ||
      !sessionId ||
      messagesLength > 0 ||
      Boolean(initialDispatchKey)
    ) {
      setGeneralWorkbenchEntryCheckPending(false);
      return;
    }

    let disposed = false;
    setGeneralWorkbenchEntryCheckPending(true);
    const perfT0 = performance.now();

    void (async () => {
      try {
        const backendState = await executionRunGetGeneralWorkbenchState(
          sessionId,
          3,
        ).catch(() => null);

        console.info(
          `[PERF] executionRunGetGeneralWorkbenchState: ${(performance.now() - perfT0).toFixed(0)}ms`,
        );

        if (disposed) {
          return;
        }

        const nextPrompt =
          buildGeneralWorkbenchResumePromptFromRunState(backendState);
        if (!nextPrompt) {
          setGeneralWorkbenchEntryPrompt((current) =>
            current?.kind === "resume" ? null : current,
          );
          return;
        }

        if (dismissedPromptSignatureRef.current === nextPrompt.signature) {
          return;
        }

        setGeneralWorkbenchEntryPrompt((current) =>
          current?.kind === "initial_prompt" ? current : nextPrompt,
        );
      } finally {
        if (!disposed) {
          setGeneralWorkbenchEntryCheckPending(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    contentId,
    initialDispatchKey,
    isThemeWorkbench,
    messagesLength,
    sessionId,
    shouldUseCompactGeneralWorkbench,
  ]);

  const clearGeneralWorkbenchEntryPrompt = useCallback(() => {
    setGeneralWorkbenchEntryPrompt(null);
  }, []);

  const dismissGeneralWorkbenchEntryPrompt = useCallback(
    (options?: {
      consumeInitialPrompt?: boolean;
      onConsumeInitialPrompt?: () => void;
    }) => {
      setGeneralWorkbenchEntryPrompt((current) => {
        if (!current) {
          return current;
        }

        if (
          current.kind === "initial_prompt" &&
          options?.consumeInitialPrompt &&
          initialDispatchKey
        ) {
          options.onConsumeInitialPrompt?.();
        } else {
          dismissedPromptSignatureRef.current = current.signature;
        }

        return null;
      });
    },
    [initialDispatchKey],
  );

  const consumeInitialPrompt = useCallback(
    (dispatchKey: string | null) => {
      consumedInitialPromptRef.current = dispatchKey;
      onInitialUserPromptConsumed?.();
    },
    [onInitialUserPromptConsumed],
  );

  const resetConsumedInitialPrompt = useCallback(() => {
    consumedInitialPromptRef.current = null;
  }, []);

  const resetGuideState = useCallback(() => {
    hasTriggeredGuideRef.current = false;
    consumedInitialPromptRef.current = null;
  }, []);

  const resolveSendBoundary = useCallback(
    ({
      sourceText,
      sendOptions,
    }: {
      sourceText: string;
      sendOptions?: HandleSendOptions;
    }): GeneralWorkbenchSendBoundaryState =>
      buildGeneralWorkbenchSendBoundaryState({
        isThemeWorkbench,
        contentId,
        initialDispatchKey,
        consumedInitialPromptKey,
        initialUserImages,
        mappedTheme,
        sourceText,
        sendOptions,
      }),
    [
      contentId,
      consumedInitialPromptKey,
      initialDispatchKey,
      initialUserImages,
      isThemeWorkbench,
      mappedTheme,
    ],
  );

  const finalizeAfterSendSuccess = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (
        boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt &&
        initialDispatchKey
      ) {
        consumeInitialPrompt(initialDispatchKey);
      }

      if (boundary.shouldDismissGeneralWorkbenchEntryPrompt) {
        clearGeneralWorkbenchEntryPrompt();
      }
    },
    [
      clearGeneralWorkbenchEntryPrompt,
      consumeInitialPrompt,
      initialDispatchKey,
    ],
  );

  const rollbackAfterSendFailure = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt) {
        resetConsumedInitialPrompt();
      }
    },
    [resetConsumedInitialPrompt],
  );

  return {
    bootstrapDispatchPreview,
    clearGeneralWorkbenchEntryPrompt,
    consumeInitialPrompt,
    consumedInitialPromptRef,
    dismissGeneralWorkbenchEntryPrompt,
    finalizeAfterSendSuccess,
    generalWorkbenchEntryCheckPending,
    generalWorkbenchEntryPrompt,
    hasTriggeredGuideRef,
    initialDispatchKey,
    isBootstrapDispatchPending,
    resetGuideState,
    resolveSendBoundary,
    rollbackAfterSendFailure,
  };
}

interface UseGeneralWorkbenchInitialAutoGuideRuntimeParams {
  autoRunInitialPromptOnMount: boolean;
  canvasState: CanvasStateUnion | null;
  contentId?: string;
  generalWorkbenchEntryCheckPending: boolean;
  generalWorkbenchEntryPrompt: GeneralWorkbenchEntryPromptState | null;
  handleSend: WorkspaceHandleSend;
  hasProject: boolean;
  hasTriggeredGuideRef: MutableRefObject<boolean>;
  initialAutoSendAllowsDetachedSession: boolean;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  initialDispatchKey: string | null;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  isSending: boolean;
  isThemeWorkbench: boolean;
  mappedTheme: ThemeType;
  messagesLength: number;
  onInitialUserPromptConsumed?: () => void;
  projectId?: string | null;
  sessionId?: string | null;
  setInput: Dispatch<SetStateAction<string>>;
  shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt: boolean;
  shouldUseCompactGeneralWorkbench: boolean;
  consumedInitialPromptRef: MutableRefObject<string | null>;
  triggerAIGuideRef: MutableRefObject<() => void>;
}

export function useGeneralWorkbenchInitialAutoGuideRuntime({
  autoRunInitialPromptOnMount,
  canvasState,
  contentId,
  generalWorkbenchEntryCheckPending,
  generalWorkbenchEntryPrompt,
  handleSend,
  hasProject,
  hasTriggeredGuideRef,
  initialAutoSendAllowsDetachedSession,
  initialAutoSendRequestMetadata,
  initialDispatchKey,
  initialUserPrompt,
  initialUserImages,
  isSending,
  isThemeWorkbench,
  mappedTheme,
  messagesLength,
  onInitialUserPromptConsumed,
  projectId,
  sessionId,
  setInput,
  shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
  shouldUseCompactGeneralWorkbench,
  consumedInitialPromptRef,
  triggerAIGuideRef,
}: UseGeneralWorkbenchInitialAutoGuideRuntimeParams): void {
  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      return;
    }

    const canvasEmpty = isCanvasStateEmpty(canvasState);
    const pendingInitialPromptText = initialUserPrompt || "";
    const pendingInitialPrompt = pendingInitialPromptText.trim();
    const pendingInitialImages = initialUserImages || [];
    const defaultGuidePrompt =
      contentId && canvasEmpty && !isThemeWorkbench
        ? getDefaultGuidePromptByTheme(mappedTheme)
        : undefined;

    if (
      !contentId ||
      messagesLength > 0 ||
      !hasProject ||
      isSending ||
      !canvasEmpty
    ) {
      return;
    }

    if (!initialDispatchKey && generalWorkbenchEntryCheckPending) {
      return;
    }

    if (initialDispatchKey) {
      if (
        isThemeWorkbench &&
        pendingInitialImages.length === 0 &&
        !autoRunInitialPromptOnMount
      ) {
        return;
      }
      if (consumedInitialPromptRef.current === initialDispatchKey) {
        return;
      }

      const claimKey = buildInitialAutoSendClaimKey({
        initialDispatchKey,
        initialAutoSendRequestMetadata,
      });
      if (!claimInitialAutoSend(claimKey)) {
        return;
      }

      let disposed = false;
      consumedInitialPromptRef.current = initialDispatchKey;
      hasTriggeredGuideRef.current = true;
      if (import.meta.env.MODE !== "test") {
        console.log("[LocalConversationPage] 自动发送首条创作意图消息");
      }

      void (async () => {
        const started = await handleSend(
          pendingInitialImages,
          undefined,
          undefined,
          pendingInitialPrompt,
          undefined,
          undefined,
          initialAutoSendRequestMetadata
            ? {
                requestMetadata: initialAutoSendRequestMetadata,
              }
            : undefined,
        );
        if (!isRuntimeSubmissionAccepted(started)) {
          releaseInitialAutoSendClaim(claimKey);
          if (disposed) {
            return;
          }
          consumedInitialPromptRef.current = null;
          return;
        }
        if (disposed) {
          return;
        }
        onInitialUserPromptConsumed?.();
      })();

      return () => {
        disposed = true;
      };
    }

    if (hasTriggeredGuideRef.current) {
      return;
    }

    if (generalWorkbenchEntryPrompt?.kind === "resume") {
      return;
    }

    if (defaultGuidePrompt) {
      hasTriggeredGuideRef.current = true;
      setInput((previous) => previous.trim() || defaultGuidePrompt);
      return;
    }

    if (isThemeWorkbench) {
      if (shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt) {
        return;
      }

      hasTriggeredGuideRef.current = true;
      if (import.meta.env.MODE !== "test") {
        console.log("[LocalConversationPage] 工作区上下文：触发 AI 引导");
      }
      triggerAIGuideRef.current();
      return;
    }

    hasTriggeredGuideRef.current = true;
    if (import.meta.env.MODE !== "test") {
      console.log("[LocalConversationPage] 自动触发 AI 创作引导");
    }
    triggerAIGuideRef.current();
  }, [
    autoRunInitialPromptOnMount,
    canvasState,
    contentId,
    generalWorkbenchEntryCheckPending,
    generalWorkbenchEntryPrompt,
    handleSend,
    hasProject,
    initialAutoSendRequestMetadata,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isSending,
    isThemeWorkbench,
    mappedTheme,
    messagesLength,
    onInitialUserPromptConsumed,
    setInput,
    shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
    shouldUseCompactGeneralWorkbench,
    consumedInitialPromptRef,
    hasTriggeredGuideRef,
    triggerAIGuideRef,
  ]);

  useEffect(() => {
    const pendingInitialPromptText = initialUserPrompt || "";
    const pendingInitialPrompt = pendingInitialPromptText.trim();
    const pendingInitialImages = initialUserImages || [];

    if (
      shouldUseCompactGeneralWorkbench ||
      !initialDispatchKey ||
      contentId ||
      messagesLength > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === initialDispatchKey) {
      return;
    }

    if (!autoRunInitialPromptOnMount) {
      hasTriggeredGuideRef.current = true;
      setInput((previous) =>
        previous.trim() ? previous : pendingInitialPromptText,
      );
      return;
    }

    if (!projectId && !initialAutoSendAllowsDetachedSession) {
      return;
    }

    const claimKey = buildInitialAutoSendClaimKey({
      initialDispatchKey,
      initialAutoSendRequestMetadata,
    });
    if (!claimInitialAutoSend(claimKey)) {
      return;
    }

    let disposed = false;
    consumedInitialPromptRef.current = initialDispatchKey;

    void (async () => {
      const started = await handleSend(
        pendingInitialImages,
        undefined,
        undefined,
        pendingInitialPrompt,
        undefined,
        undefined,
        {
          ...(initialAutoSendRequestMetadata
            ? { requestMetadata: initialAutoSendRequestMetadata }
            : {}),
          skipSessionRestore: true,
        },
      );
      if (!isRuntimeSubmissionAccepted(started)) {
        releaseInitialAutoSendClaim(claimKey);
        if (disposed) {
          return;
        }
        consumedInitialPromptRef.current = null;
        return;
      }
      if (disposed) {
        return;
      }
      onInitialUserPromptConsumed?.();
    })();

    return () => {
      disposed = true;
    };
  }, [
    autoRunInitialPromptOnMount,
    contentId,
    handleSend,
    initialAutoSendRequestMetadata,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    initialAutoSendAllowsDetachedSession,
    isSending,
    messagesLength,
    onInitialUserPromptConsumed,
    projectId,
    sessionId,
    setInput,
    shouldUseCompactGeneralWorkbench,
    consumedInitialPromptRef,
    hasTriggeredGuideRef,
  ]);

  useEffect(() => {
    hasTriggeredGuideRef.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId, consumedInitialPromptRef, hasTriggeredGuideRef]);
}
