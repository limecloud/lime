import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { isTeamRuntimeRecommendation } from "../utils/contextualRecommendations";
import {
  matchAutoLaunchSiteSkillFromText,
  type AutoMatchedSiteSkill,
} from "../service-skills/autoMatchSiteSkill";
import {
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ThemeWorkbenchSendBoundaryState } from "../hooks/useThemeWorkbenchSendBoundary";
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { MessageImage } from "../types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import {
  buildRuntimeTeamDispatchPreview,
  buildWorkspaceRequestMetadata,
  buildWorkspaceSendText,
  primeBrowserAssistBeforeSend,
  type ContextWorkspaceSummary,
  type EnsureBrowserAssistCanvasOptions,
} from "./workspaceSendHelpers";
import type { Character } from "@/lib/api/memory";
import type { ThemeType } from "@/components/content-creator/types";
import type { ServiceSkillHomeItem } from "../service-skills/types";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type SetStringState = (value: string) => void;
type ParsedImageWorkbenchCommand = NonNullable<
  ReturnType<typeof parseImageWorkbenchCommand>
>;

interface UseWorkspaceSendActionsParams {
  input: string;
  setInput: SetStringState;
  mentionedCharacters: Character[];
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  chatToolPreferences: ChatToolPreferences;
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  serviceSkills: ServiceSkillHomeItem[];
  activeTheme: string;
  mappedTheme: ThemeType;
  isThemeWorkbench: boolean;
  contextWorkspace: ContextWorkspaceSummary;
  runtimeStyleMessagePrompt: string;
  projectId?: string | null;
  executionStrategy: ExecutionStrategy;
  accessMode?: AgentAccessMode;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
  browserAssistProfileKey?: string | null;
  browserAssistPreferredBackend?:
    | "aster_compat"
    | "lime_extension_bridge"
    | "cdp_direct"
    | null;
  browserAssistAutoLaunch?: boolean | null;
  workspaceRequestMetadataBase?: Record<string, unknown>;
  messagesCount: number;
  sendMessage: SendMessageFn;
  resolveSendBoundary: (input: {
    sourceText: string;
    sendOptions?: HandleSendOptions;
  }) => ThemeWorkbenchSendBoundaryState;
  maybeStartBrowserTaskPreflight: (input: {
    boundary: ThemeWorkbenchSendBoundaryState;
    images?: MessageImage[];
    webSearch?: boolean;
    thinking?: boolean;
    sendExecutionStrategy?: ExecutionStrategy;
    autoContinuePayload?: AutoContinueRequestPayload;
    sendOptions?: HandleSendOptions;
  }) => boolean;
  finalizeAfterSendSuccess: (boundary: ThemeWorkbenchSendBoundaryState) => void;
  rollbackAfterSendFailure: (boundary: ThemeWorkbenchSendBoundaryState) => void;
  prepareRuntimeTeamBeforeSend: UseRuntimeTeamFormationResult["prepareRuntimeTeamBeforeSend"];
  setRuntimeTeamDispatchPreview: Dispatch<
    SetStateAction<RuntimeTeamDispatchPreviewSnapshot | null>
  >;
  ensureBrowserAssistCanvas: (
    target: string,
    options?: EnsureBrowserAssistCanvasOptions,
  ) => Promise<boolean>;
  handleAutoLaunchMatchedSiteSkill: (
    match: AutoMatchedSiteSkill<ServiceSkillHomeItem>,
  ) => Promise<void>;
  handleImageWorkbenchCommand: (input: {
    rawText: string;
    parsedCommand: ParsedImageWorkbenchCommand;
    images: MessageImage[];
  }) => Promise<boolean>;
}

interface WorkspaceResolvedSendState {
  sourceText: string;
  sendBoundary: ThemeWorkbenchSendBoundaryState;
  effectiveToolPreferences: ChatToolPreferences;
  effectiveWebSearch?: boolean;
  effectiveThinking?: boolean;
}

interface WorkspaceSendPlan extends WorkspaceResolvedSendState {
  text: string;
  images: MessageImage[];
  sendExecutionStrategy?: ExecutionStrategy;
  autoContinuePayload?: AutoContinueRequestPayload;
  sendOptions?: HandleSendOptions;
}

type WorkspaceSendResolution =
  | {
      kind: "done";
      result: boolean;
    }
  | {
      kind: "ready";
      plan: WorkspaceSendPlan;
    };

export type WorkspaceHandleSend = (
  images?: MessageImage[],
  webSearch?: boolean,
  thinking?: boolean,
  textOverride?: string,
  sendExecutionStrategy?: ExecutionStrategy,
  autoContinuePayload?: AutoContinueRequestPayload,
  sendOptions?: HandleSendOptions,
) => Promise<boolean>;

export function useWorkspaceSendActions({
  input,
  setInput,
  mentionedCharacters,
  setMentionedCharacters,
  chatToolPreferences,
  setChatToolPreferences,
  serviceSkills,
  activeTheme,
  mappedTheme,
  isThemeWorkbench,
  contextWorkspace,
  runtimeStyleMessagePrompt,
  projectId,
  executionStrategy,
  accessMode,
  preferredTeamPresetId,
  selectedTeam,
  selectedTeamLabel,
  selectedTeamSummary,
  currentGateKey,
  themeWorkbenchActiveQueueTitle,
  contentId,
  browserAssistProfileKey,
  browserAssistPreferredBackend,
  browserAssistAutoLaunch,
  workspaceRequestMetadataBase,
  messagesCount,
  sendMessage,
  resolveSendBoundary,
  maybeStartBrowserTaskPreflight,
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  prepareRuntimeTeamBeforeSend: _prepareRuntimeTeamBeforeSend,
  setRuntimeTeamDispatchPreview,
  ensureBrowserAssistCanvas,
  handleAutoLaunchMatchedSiteSkill,
  handleImageWorkbenchCommand,
}: UseWorkspaceSendActionsParams) {
  const resolveSendExecutionPlan = useCallback(
    async (
      images?: MessageImage[],
      webSearch?: boolean,
      thinking?: boolean,
      textOverride?: string,
      sendExecutionStrategy?: ExecutionStrategy,
      autoContinuePayload?: AutoContinueRequestPayload,
      sendOptions?: HandleSendOptions,
    ): Promise<WorkspaceSendResolution> => {
      let sourceText = textOverride ?? input;
      if (!sourceText.trim() && (!images || images.length === 0)) {
        return { kind: "done", result: false };
      }

      const sendBoundary = resolveSendBoundary({
        sourceText,
        sendOptions,
      });
      sourceText = sendBoundary.sourceText;

      const effectiveToolPreferences =
        sendOptions?.toolPreferencesOverride ?? chatToolPreferences;
      const { browserRequirementMatch } = sendBoundary;
      const requestedWebSearch =
        webSearch ?? effectiveToolPreferences.webSearch;
      const effectiveWebSearch =
        browserRequirementMatch &&
        browserRequirementMatch.requirement !== "optional"
          ? false
          : requestedWebSearch;
      const effectiveThinking = thinking ?? effectiveToolPreferences.thinking;

      if (!projectId) {
        sendOptions?.observer?.onError?.("请先选择项目后再开始对话");
        toast.error("请先选择项目后再开始对话");
        return { kind: "done", result: false };
      }

      const parsedImageWorkbenchCommand =
        !sendOptions?.purpose && sourceText.trim()
          ? parseImageWorkbenchCommand(sourceText)
          : null;
      if (parsedImageWorkbenchCommand) {
        return {
          kind: "done",
          result: await handleImageWorkbenchCommand({
            rawText: sourceText,
            parsedCommand: parsedImageWorkbenchCommand,
            images: images || [],
          }),
        };
      }

      const trimmedSourceText = sourceText.trim();
      if (
        activeTheme === "general" &&
        !sendOptions?.purpose &&
        !images?.length &&
        trimmedSourceText &&
        !trimmedSourceText.startsWith("/") &&
        !trimmedSourceText.startsWith("@")
      ) {
        const matchedSiteSkill = matchAutoLaunchSiteSkillFromText({
          inputText: trimmedSourceText,
          serviceSkills,
        });
        if (matchedSiteSkill) {
          await handleAutoLaunchMatchedSiteSkill(matchedSiteSkill);
          return { kind: "done", result: true };
        }
      }

      if (
        maybeStartBrowserTaskPreflight({
          boundary: sendBoundary,
          images,
          webSearch,
          thinking,
          sendExecutionStrategy,
          autoContinuePayload,
          sendOptions,
        })
      ) {
        return { kind: "done", result: true };
      }

      primeBrowserAssistBeforeSend({
        activeTheme,
        sourceText,
        browserRequirementMatch,
        ensureBrowserAssistCanvas,
      });

      const text = await buildWorkspaceSendText({
        sourceText,
        contextWorkspace,
        mentionedCharacters,
        runtimeStyleMessagePrompt,
        sendOptions,
      });

      return {
        kind: "ready",
        plan: {
          sourceText,
          text,
          images: images || [],
          sendBoundary,
          effectiveToolPreferences,
          effectiveWebSearch,
          effectiveThinking,
          sendExecutionStrategy,
          autoContinuePayload,
          sendOptions,
        },
      };
    },
    [
      activeTheme,
      chatToolPreferences,
      contextWorkspace,
      ensureBrowserAssistCanvas,
      handleAutoLaunchMatchedSiteSkill,
      handleImageWorkbenchCommand,
      input,
      maybeStartBrowserTaskPreflight,
      mentionedCharacters,
      projectId,
      resolveSendBoundary,
      runtimeStyleMessagePrompt,
      serviceSkills,
    ],
  );

  const executeSendPlan = useCallback(
    async (plan: WorkspaceSendPlan): Promise<boolean> => {
      const {
        sourceText,
        text,
        images,
        sendBoundary,
        effectiveToolPreferences,
        effectiveWebSearch,
        effectiveThinking,
        sendExecutionStrategy,
        autoContinuePayload,
        sendOptions,
      } = plan;

      setRuntimeTeamDispatchPreview(null);

      try {
        const preparedRuntimeTeamState = await _prepareRuntimeTeamBeforeSend({
          input: sourceText,
          purpose: sendOptions?.purpose,
          subagentEnabled: effectiveToolPreferences.subagent,
        });
        if (preparedRuntimeTeamState) {
          setRuntimeTeamDispatchPreview(
            buildRuntimeTeamDispatchPreview(
              preparedRuntimeTeamState,
              sourceText,
              images,
              messagesCount,
            ),
          );
        }

        setInput("");
        setMentionedCharacters([]);

        const nextRequestMetadata = buildWorkspaceRequestMetadata({
          workspaceRequestMetadataBase,
          sendOptions: {
            ...(sendOptions || {}),
            toolPreferencesOverride: effectiveToolPreferences,
          },
          effectiveToolPreferences,
          accessMode,
          mappedTheme,
          isThemeWorkbench,
          currentGateKey,
          themeWorkbenchActiveQueueTitle,
          contentId,
          browserRequirementMatch: sendBoundary.browserRequirementMatch,
          browserAssistProfileKey,
          browserAssistPreferredBackend,
          browserAssistAutoLaunch,
          preferredTeamPresetId,
          selectedTeam,
          selectedTeamLabel,
          selectedTeamSummary,
        });
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          requestMetadata: nextRequestMetadata,
        };

        await sendMessage(
          text,
          images,
          effectiveWebSearch,
          effectiveThinking,
          false,
          sendExecutionStrategy,
          undefined,
          autoContinuePayload,
          nextSendOptions,
        );

        finalizeAfterSendSuccess(sendBoundary);
        return true;
      } catch (error) {
        rollbackAfterSendFailure(sendBoundary);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        setRuntimeTeamDispatchPreview((current) =>
          current
            ? {
                ...current,
                status: "failed",
                failureMessage: errorMessage,
              }
            : null,
        );
        sendOptions?.observer?.onError?.(errorMessage);
        console.error("[AgentChat] 发送消息失败:", error);
        toast.error(`发送失败: ${errorMessage}`);
        setInput(sourceText);
        return false;
      }
    },
    [
      _prepareRuntimeTeamBeforeSend,
      browserAssistAutoLaunch,
      browserAssistPreferredBackend,
      browserAssistProfileKey,
      contentId,
      currentGateKey,
      finalizeAfterSendSuccess,
      isThemeWorkbench,
      mappedTheme,
      messagesCount,
      accessMode,
      preferredTeamPresetId,
      rollbackAfterSendFailure,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      sendMessage,
      setInput,
      setMentionedCharacters,
      setRuntimeTeamDispatchPreview,
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
      return executeSendPlan(resolution.plan);
    },
    [executeSendPlan, resolveSendExecutionPlan],
  );

  const handleRecommendationClick = useCallback(
    (shortLabel: string, fullPrompt: string) => {
      setInput(fullPrompt);

      if (
        activeTheme !== "general" ||
        !isTeamRuntimeRecommendation(shortLabel, fullPrompt)
      ) {
        return;
      }

      const nextToolPreferences = chatToolPreferences.subagent
        ? chatToolPreferences
        : {
            ...chatToolPreferences,
            subagent: true,
          };

      if (!chatToolPreferences.subagent) {
        setChatToolPreferences(nextToolPreferences);
      }
      saveChatToolPreferences(nextToolPreferences, activeTheme);
      void handleSend(
        [],
        nextToolPreferences.webSearch,
        nextToolPreferences.thinking,
        fullPrompt,
        executionStrategy,
        undefined,
        {
          toolPreferencesOverride: nextToolPreferences,
        },
      );
    },
    [
      activeTheme,
      chatToolPreferences,
      executionStrategy,
      handleSend,
      setChatToolPreferences,
      setInput,
    ],
  );

  const handleSendRef = useRef(handleSend);
  const webSearchPreferenceRef = useRef(chatToolPreferences.webSearch);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    webSearchPreferenceRef.current = chatToolPreferences.webSearch;
  }, [chatToolPreferences.webSearch]);

  return {
    handleSend,
    handleRecommendationClick,
    handleSendRef,
    webSearchPreferenceRef,
  };
}
