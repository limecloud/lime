import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { logAgentDebug } from "@/lib/agentDebug";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime/sessionTypes";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime/toolInventoryTypes";
import type { ServiceModelsConfig } from "@/lib/api/appConfigTypes";
import type { Character } from "@/lib/api/projectMemory";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { RuntimeSearchMode } from "@limecloud/app-server-client";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parseSlashCommand } from "../commands";
import { normalizeExecutionStrategy } from "../hooks/agentChatCoreUtils";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import type {
  RuntimeAcceptanceReceipt,
  RuntimeSubmissionResult,
} from "../hooks/agentSendResult";
import type { ExecutionScope } from "../hooks/executionScope";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import type { Message, MessageImage } from "../types";
import { resolveAgentRuntimeSubmitErrorMessage } from "../utils/agentRuntimeErrorPresentation";
import { type ChatToolPreferences } from "../utils/chatToolPreferences";
import type { WorkspaceSkillRuntimeEnableInput } from "../utils/workspaceSkillBindingsMetadata";
import { buildImageWorkbenchAssistantDraft } from "./commands/imageWorkbenchHelpers";
import {
  resolveServiceModelSendOverrides,
  shouldRefreshServiceModelsBeforeSend,
  withConfiguredModelSlots,
} from "./commands/serviceModelHelpers";
import {
  resolveInputCapabilityDispatchContext,
  type CompletedInputCapabilitySlashUsage,
} from "./inputCapabilityRouting";
import { useComposerWorktree } from "./useComposerWorktree";
import {
  attachSessionIdToRequestContext,
  attachSessionIdToScopedRequestContext,
  extractBoundSessionRequestContext,
} from "./workspaceModelSkillLaunchRequestContext";
import {
  buildSubmissionPreviewMessages,
  buildWorkspaceRequestMetadata,
  buildWorkspaceSendText,
  createSubmissionPreviewSnapshot,
  type GeneralWorkbenchSendBoundaryState,
  type InitialDispatchPreviewSnapshot,
  type SubmissionPreviewSnapshot,
} from "./workspaceSendHelpers";
import {
  submitWorkspaceMessage,
  withWorkspaceSubmissionCleanup,
} from "./workspaceSendSubmission";
import { worktreeSetupErrorOptions } from "./worktreeSetupRecovery";

type CurrentExecutionStrategy = "react";

export type WorkspaceHandleSend = (
  images?: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  textOverride?: string,
  sendExecutionStrategy?: CurrentExecutionStrategy,
  autoContinuePayload?: AutoContinueRequestPayload,
  sendOptions?: HandleSendOptions,
) => Promise<RuntimeSubmissionResult>;
type SetStringState = (value: string) => void;
interface UseWorkspaceSendActionsParams {
  input: string;
  setInput: SetStringState;
  mentionedCharacters: Character[];
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  chatToolPreferences: ChatToolPreferences;
  mappedTheme: ThemeType;
  isThemeWorkbench: boolean;
  projectId?: string | null;
  projectRootPath?: string | null;
  cancelExecutionScope?: () => void;
  getComposerDraftNavigationEpoch?: () => number;
  isAcceptedExecutionScopeCurrent?: (
    scope: ExecutionScope,
    receipt: RuntimeAcceptanceReceipt,
  ) => boolean;
  onExecutionScopeAccepted?: (
    scope: ExecutionScope,
    receipt: RuntimeAcceptanceReceipt,
  ) => void;
  sessionId?: string | null;
  executionStrategy: CurrentExecutionStrategy;
  accessMode?: AgentAccessMode;
  providerType?: string | null;
  workspaceSkillBindings?: AgentRuntimeWorkspaceSkillBinding[] | null;
  workspaceSkillRuntimeEnable?: WorkspaceSkillRuntimeEnableInput | null;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
  workspaceRequestMetadataBase?: Record<string, unknown>;


  serviceModels?: ServiceModelsConfig;
  agentResponseLanguage?: string | null;
  resolveServiceModelsBeforeSend?: () => Promise<{
    serviceModels?: ServiceModelsConfig;
    agentResponseLanguage?: string | null;
  }>;
  messages: Message[];
  bootstrapDispatchPreview?: InitialDispatchPreviewSnapshot | null;
  sendMessage: SendMessageFn;
  resolveSendBoundary: (input: {
    sourceText: string;
    sendOptions?: HandleSendOptions;
  }) => GeneralWorkbenchSendBoundaryState;
  finalizeAfterSendSuccess: (
    boundary: GeneralWorkbenchSendBoundaryState,
  ) => void;
  rollbackAfterSendFailure: (
    boundary: GeneralWorkbenchSendBoundaryState,
  ) => void;
  ensureSessionForCommandMetadata?: (options?: {
    targetSessionId?: string;
    skipSessionRestore?: boolean;
    skipSessionStartHooks?: boolean;
  }) => Promise<string | null>;
}

interface WorkspaceResolvedSendState {
  sourceText: string;
  dispatchText: string;
  sendBoundary: GeneralWorkbenchSendBoundaryState;
  browserRequirementForSend: GeneralWorkbenchSendBoundaryState["browserRequirementMatch"];
  effectiveToolPreferences: ChatToolPreferences;
  effectiveWebSearch?: boolean;
  effectiveSearchMode?: RuntimeSearchMode;
  submissionPreviewKey: string | null;
}

interface WorkspaceSendPlan extends WorkspaceResolvedSendState {
  text: string;
  images: MessageImage[];
  sendExecutionStrategy?: CurrentExecutionStrategy;
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
  completedSlashUsage?: CompletedInputCapabilitySlashUsage | null;
}

type WorkspaceSendResolution =
  | {
      kind: "done";
      result: RuntimeSubmissionResult;
    }
  | {
      kind: "ready";
      plan: WorkspaceSendPlan;
    };

export function useWorkspaceSendActions({
  input,
  setInput,
  mentionedCharacters,
  setMentionedCharacters,
  chatToolPreferences,
  mappedTheme,
  isThemeWorkbench,
  projectId,
  projectRootPath,
  cancelExecutionScope,
  getComposerDraftNavigationEpoch,
  isAcceptedExecutionScopeCurrent,
  onExecutionScopeAccepted,
  sessionId: _sessionId,
  executionStrategy,
  accessMode: _accessMode,
  providerType,
  workspaceSkillBindings,
  workspaceSkillRuntimeEnable,
  currentGateKey,
  themeWorkbenchActiveQueueTitle,
  contentId,
  workspaceRequestMetadataBase,


  serviceModels,
  agentResponseLanguage,
  resolveServiceModelsBeforeSend,
  messages,
  sendMessage,
  resolveSendBoundary,
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  ensureSessionForCommandMetadata,
}: UseWorkspaceSendActionsParams) {
  const { t } = useTranslation("agent");
  const navigate = useAppNavigationRequest();
  const composerWorktree = useComposerWorktree({
    workspaceId: projectId,
    workingDir: projectRootPath,
    cancelExecutionScope,
    getNavigationEpoch: getComposerDraftNavigationEpoch,
    isAcceptedTargetCurrent: isAcceptedExecutionScopeCurrent,
    onAccepted: onExecutionScopeAccepted,
  });
  const messagesCount = messages.length;
  const [submissionPreview, setSubmissionPreview] =
    useState<SubmissionPreviewSnapshot | null>(null);
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const isPreparingSendRef = useRef(false);
  const submissionPreviewMessages = useMemo(
    () =>
      messagesCount === 0 && submissionPreview
        ? buildSubmissionPreviewMessages(submissionPreview)
        : [],
    [messagesCount, submissionPreview],
  );
  const displayMessages = useMemo(() => {
    if (submissionPreviewMessages.length > 0) {
      return submissionPreviewMessages;
    }

    return messages;
  }, [messages, submissionPreviewMessages]);

  const resolveSendExecutionPlan = useCallback(
    async (
      images?: MessageImage[],
      _webSearch?: boolean,
      _thinking?: boolean,
      textOverride?: string,
      sendExecutionStrategy?: CurrentExecutionStrategy,
      autoContinuePayload?: AutoContinueRequestPayload,
      sendOptions?: HandleSendOptions,
    ): Promise<WorkspaceSendResolution> => {
      const inputCapabilityDispatch = resolveInputCapabilityDispatchContext({
        sourceText: textOverride ?? input,
        capabilityRoute: sendOptions?.capabilityRoute,
        displayContent: sendOptions?.displayContent,
      });
      if (!inputCapabilityDispatch.sourceText.trim() && !images?.length)
        return { kind: "done", result: { kind: "rejected" } };

      const sendBoundary = resolveSendBoundary({
        sourceText: inputCapabilityDispatch.sourceText,
        sendOptions,
      });
      const sourceText = sendBoundary.sourceText;
      const nextSendOptions = inputCapabilityDispatch.capabilityRoute
        ? {
            ...sendOptions,
            capabilityRoute: inputCapabilityDispatch.capabilityRoute,
          }
        : sendOptions;
      const browserRequirementForSend = sendBoundary.browserRequirementMatch;
      const requiresBrowser =
        browserRequirementForSend &&
        browserRequirementForSend.requirement !== "optional";
      const submissionPreviewKey = crypto.randomUUID();
      if (!sendOptions?.threadGoal) {
        setSubmissionPreview(
          createSubmissionPreviewSnapshot({
            key: submissionPreviewKey,
            prompt: sourceText,
            displayContent: sendOptions?.displayContent,
            inputCapabilityRoute: nextSendOptions?.capabilityRoute,
            images: images ?? [],
          }),
        );
      }

      try {
        // 普通文本原样提交；技能和工具由同一回合中的真实运行时执行。
        const text = await buildWorkspaceSendText({
          sourceText,
          mentionedCharacters,
          sendOptions: nextSendOptions,
        });
        const metadata = {
          ...workspaceRequestMetadataBase,
          ...nextSendOptions?.requestMetadata,
        };
        const binding = extractBoundSessionRequestContext(metadata);
        if (binding && ensureSessionForCommandMetadata) {
          const sessionId = await ensureSessionForCommandMetadata({
            targetSessionId:
              nextSendOptions?.targetSessionId?.trim() || undefined,
            skipSessionRestore: nextSendOptions?.skipSessionRestore === true,
            skipSessionStartHooks:
              nextSendOptions?.skipSessionStartHooks === true,
          });
          if (binding.kind === "request_context")
            attachSessionIdToRequestContext(
              binding.requestContext,
              binding.requestContextKey,
              sessionId,
            );
          else
            attachSessionIdToScopedRequestContext(
              binding.scopedRequestContext,
              sessionId,
            );
        }
        return {
          kind: "ready",
          plan: {
            sourceText,
            dispatchText: sourceText,
            text,
            images: images ?? [],
            sendBoundary,
            browserRequirementForSend,
            effectiveToolPreferences:
              nextSendOptions?.toolPreferencesOverride ?? chatToolPreferences,
            effectiveWebSearch: requiresBrowser ? false : undefined,
            effectiveSearchMode: requiresBrowser
              ? "disabled"
              : nextSendOptions?.searchMode,
            submissionPreviewKey: sendOptions?.threadGoal
              ? null
              : submissionPreviewKey,
            sendExecutionStrategy: normalizeExecutionStrategy(
              sendExecutionStrategy ?? executionStrategy,
            ),
            autoContinuePayload,
            sendOptions: nextSendOptions,
            completedSlashUsage: inputCapabilityDispatch.completedSlashUsage,
          },
        };
      } catch (error) {
        setSubmissionPreview((current) =>
          current?.key === submissionPreviewKey ? null : current,
        );
        throw error;
      }
    },
    [
      chatToolPreferences,
      ensureSessionForCommandMetadata,
      executionStrategy,
      input,
      mentionedCharacters,
      resolveSendBoundary,
      workspaceRequestMetadataBase,
    ],
  );

  const executeSendPlan = useCallback(
    async (plan: WorkspaceSendPlan): Promise<RuntimeSubmissionResult> => {
      const {
        sourceText,
        dispatchText,
        text,
        images,
        sendBoundary,
        browserRequirementForSend,
        effectiveWebSearch,
        effectiveSearchMode,
        submissionPreviewKey,
        sendExecutionStrategy,
        autoContinuePayload,
        sendOptions,
      } = plan;

      const executeStartedAt = Date.now();
      logAgentDebug("WorkspaceSend", "execute.start", {
        imagesCount: images.length,
        messagesCount,
        sourceTextLength: sourceText.trim().length,
      });
      const effectiveToolPreferences = plan.effectiveToolPreferences;
      if (!sendOptions?.composerDraft) {
        setInput("");
        setMentionedCharacters([]);
      }

      return withWorkspaceSubmissionCleanup(
        async () => {
          try {
            let nextRequestMetadata = buildWorkspaceRequestMetadata({
              workspaceRequestMetadataBase,


              sendOptions: {
                ...(sendOptions || {}),
                toolPreferencesOverride: effectiveToolPreferences,
              },
              currentProviderType: providerType,
              effectiveToolPreferences,
              mappedTheme,
              isThemeWorkbench,
              currentGateKey,
              themeWorkbenchActiveQueueTitle,
              contentId,
              browserRequirementMatch: browserRequirementForSend,
              workspaceSkillBindings,
              workspaceSkillRuntimeEnable,
              agentResponseLanguage,
            });
            const shouldRefreshServiceModels =
              Boolean(resolveServiceModelsBeforeSend) &&
              shouldRefreshServiceModelsBeforeSend({
                requestMetadata: nextRequestMetadata,
                purpose: sendOptions?.purpose,
              });
            const serviceModelsForSend = shouldRefreshServiceModels
              ? await resolveServiceModelsBeforeSend?.()
              : null;
            const effectiveServiceModels =
              serviceModelsForSend?.serviceModels ?? serviceModels;
            const effectiveAgentResponseLanguage =
              serviceModelsForSend?.agentResponseLanguage ??
              agentResponseLanguage;
            if (shouldRefreshServiceModels) {
              nextRequestMetadata = buildWorkspaceRequestMetadata({
                workspaceRequestMetadataBase,


                sendOptions: {
                  ...(sendOptions || {}),
                  toolPreferencesOverride: effectiveToolPreferences,
                },
                currentProviderType: providerType,
                effectiveToolPreferences,
                mappedTheme,
                isThemeWorkbench,
                currentGateKey,
                themeWorkbenchActiveQueueTitle,
                contentId,
                browserRequirementMatch: browserRequirementForSend,
                workspaceSkillBindings,
                workspaceSkillRuntimeEnable,
                agentResponseLanguage: effectiveAgentResponseLanguage,
              });
            }
            const serviceModelSendOverrides = resolveServiceModelSendOverrides({
              requestMetadata: nextRequestMetadata,
              purpose: sendOptions?.purpose,
              serviceModels: effectiveServiceModels,
            });
            const nextAssistantDraft =
              sendOptions?.assistantDraft ??
              buildImageWorkbenchAssistantDraft(nextRequestMetadata);
            const nextSendOptions: HandleSendOptions = {
              ...(sendOptions || {}),
              displayContent:
                dispatchText !== sourceText
                  ? (sendOptions?.displayContent ?? sourceText)
                  : sendOptions?.displayContent,
              requestMetadata: withConfiguredModelSlots(
                nextRequestMetadata,
                effectiveServiceModels,
              ),
              ...(effectiveSearchMode
                ? { searchMode: effectiveSearchMode }
                : {}),
              providerOverride:
                sendOptions?.providerOverride ??
                serviceModelSendOverrides.providerOverride,
              modelOverride:
                sendOptions?.modelOverride ??
                serviceModelSendOverrides.modelOverride,
              systemPromptOverride: sendOptions?.systemPromptOverride,
              assistantDraft: nextAssistantDraft,
            };

            logAgentDebug("WorkspaceSend", "sendMessage.start", {
              durationMs: Date.now() - executeStartedAt,
              responsiveModelSlotConfigured: Boolean(
                effectiveServiceModels?.responsive_chat?.enabled !== false &&
                effectiveServiceModels?.responsive_chat?.preferredProviderId &&
                effectiveServiceModels?.responsive_chat?.preferredModelId,
              ),
              modelOverride: nextSendOptions.modelOverride ?? null,
              providerOverride: nextSendOptions.providerOverride ?? null,
            });
            return await submitWorkspaceMessage({
              observer: sendOptions?.observer,
              submit: (observer) =>
                sendMessage(
                  text,
                  images,
                  effectiveWebSearch,
                  undefined,
                  false,
                  sendExecutionStrategy,
                  undefined,
                  autoContinuePayload,
                  { ...nextSendOptions, observer },
                ),
              onAccepted: () => {
                logAgentDebug("WorkspaceSend", "sendMessage.done", {
                  durationMs: Date.now() - executeStartedAt,
                });

                if (plan.completedSlashUsage) {
                  recordSlashEntryUsage(plan.completedSlashUsage);
                }

                finalizeAfterSendSuccess(sendBoundary);
              },
              onRejected: (error) => {
                if (!sendOptions?.composerDraft)
                  rollbackAfterSendFailure(sendBoundary);
                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                sendOptions?.observer?.onError?.(errorMessage);
                console.error("[AgentChat] 发送消息失败:", error);
                toast.error(resolveAgentRuntimeSubmitErrorMessage(error));
                if (!sendOptions?.composerDraft) setInput(sourceText);
              },
            });
          } catch (error) {
            if (!sendOptions?.composerDraft)
              rollbackAfterSendFailure(sendBoundary);
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            sendOptions?.observer?.onError?.(errorMessage);
            console.error("[AgentChat] 发送消息失败:", error);
            toast.error(resolveAgentRuntimeSubmitErrorMessage(error));
            if (!sendOptions?.composerDraft) setInput(sourceText);
            return { kind: "rejected", error };
          }
        },
        () =>
          setSubmissionPreview((current) =>
            current?.key === submissionPreviewKey ? null : current,
          ),
      );
    },
    [
      agentResponseLanguage,
      contentId,
      currentGateKey,
      finalizeAfterSendSuccess,
      isThemeWorkbench,
      mappedTheme,
      messagesCount,
      providerType,
      rollbackAfterSendFailure,
      serviceModels,
      resolveServiceModelsBeforeSend,
      workspaceSkillBindings,
      workspaceSkillRuntimeEnable,
      sendMessage,
      setInput,
      setMentionedCharacters,
      themeWorkbenchActiveQueueTitle,
      workspaceRequestMetadataBase,


    ],
  );

  const handleSend = useCallback<WorkspaceHandleSend>(
    async (
      images,
      webSearch,
      thinking,
      textOverride,
      sendExecutionStrategy,
      autoContinuePayload,
      sendOptions,
    ) => {
      if (isPreparingSendRef.current) {
        return { kind: "rejected" };
      }

      const worktreeSubmission = composerWorktree.capture();
      isPreparingSendRef.current = true;
      setIsPreparingSend(true);

      return withWorkspaceSubmissionCleanup(
        async () => {
          const resolution = await resolveSendExecutionPlan(
            images,
            webSearch,
            thinking,
            textOverride,
            sendExecutionStrategy,
            autoContinuePayload,
            sendOptions,
          );
          if (resolution.kind === "done") {
            return resolution.result;
          }
          if (!worktreeSubmission)
            return await executeSendPlan(resolution.plan);
          if (
            sendOptions?.composerTarget &&
            sendOptions.composerTarget !== "start"
          )
            return { kind: "rejected" };
          const localCommand = parseSlashCommand(resolution.plan.text);
          if (
            resolution.plan.text.startsWith("!") ||
            (localCommand &&
              (localCommand.definition.kind !== "prompt_action" ||
                localCommand.definition.support !== "supported"))
          )
            return await executeSendPlan(resolution.plan);
          const result = await worktreeSubmission.submit((executionScope) =>
            executeSendPlan({
              ...resolution.plan,
              sendOptions: {
                ...resolution.plan.sendOptions,
                targetSessionId: undefined,
                composerTarget: "start",
                executionScope,
              },
            }),
          );
          if (result.kind === "unknown")
            toast.error(
              String(
                t(
                  "agentChat.inputbar.core.projectContext.worktreeSubmitUnknown",
                ),
              ),
            );
          else if (
            result.kind === "rejected" &&
            !(
              result.error instanceof DOMException &&
              result.error.name === "AbortError"
            )
          )
            toast.error(
              String(
                t(
                  "agentChat.inputbar.core.projectContext.worktreeCreateFailed",
                ),
              ),
              worktreeSetupErrorOptions(
                result.error,
                String(t("agentChat.navbar.appSwitcher.openWorktree")),
                navigate
                  ? (projectId) =>
                      navigate("agent", {
                        agentEntry: "conversation",
                        projectId,
                      })
                  : undefined,
              ),
            );
          return result;
        },
        () => {
          isPreparingSendRef.current = false;
          setIsPreparingSend(false);
        },
      );
    },
    [composerWorktree, navigate, executeSendPlan, resolveSendExecutionPlan, t],
  );

  const handleSendRef = useRef(handleSend);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  return {
    composerMode: composerWorktree.composerMode,
    setComposerMode: composerWorktree.setComposerMode,
    handleSend,
    handleSendRef,
    isPreparingSend,
    displayMessages,
  };
}
