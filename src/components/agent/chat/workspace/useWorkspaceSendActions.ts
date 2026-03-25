import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { Character } from "@/lib/api/memory";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { preheatBrowserAssistInBackground } from "../utils/browserAssistPreheat";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "../utils/harnessRequestMetadata";
import { isTeamRuntimeRecommendation } from "../utils/contextualRecommendations";
import { saveChatToolPreferences, type ChatToolPreferences } from "../utils/chatToolPreferences";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ThemeWorkbenchSendBoundaryState } from "../hooks/useThemeWorkbenchSendBoundary";
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { MessageImage } from "../types";
import type { ThemeType } from "@/components/content-creator/types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type SetStringState = (value: string) => void;

interface ContextWorkspaceSummary {
  enabled: boolean;
  prepareActiveContextPrompt: () => Promise<string>;
}

interface EnsureBrowserAssistCanvasOptions {
  silent?: boolean;
  navigationMode?: "none" | "explicit-url" | "best-effort";
}

interface UseWorkspaceSendActionsParams {
  input: string;
  setInput: SetStringState;
  mentionedCharacters: Character[];
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  chatToolPreferences: ChatToolPreferences;
  setChatToolPreferences: Dispatch<SetStateAction<ChatToolPreferences>>;
  activeTheme: string;
  mappedTheme: ThemeType;
  isThemeWorkbench: boolean;
  contextWorkspace: ContextWorkspaceSummary;
  runtimeStyleMessagePrompt: string;
  projectId?: string | null;
  executionStrategy: ExecutionStrategy;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
  workspaceRequestMetadataBase?: Record<string, unknown>;
  messagesCount: number;
  sendMessage: SendMessageFn;
  resolveSendBoundary: (input: {
    sourceText: string;
    sendOptions?: HandleSendOptions;
  }) => ThemeWorkbenchSendBoundaryState;
  isBlockedByBrowserPreflight: (sendOptions?: HandleSendOptions) => boolean;
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
  handleImageWorkbenchCommand: (input: {
    rawText: string;
    parsedCommand: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>;
    images: MessageImage[];
  }) => Promise<boolean>;
}

function applyActiveContextPrompt(text: string, activeContextPrompt: string): string {
  if (!activeContextPrompt.trim()) {
    return text;
  }

  const slashCommandMatch = text.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (slashCommandMatch) {
    const [, skillName, skillArgs] = slashCommandMatch;
    const mergedArgs = [activeContextPrompt, skillArgs.trim()]
      .filter((part) => part.length > 0)
      .join("\n\n");
    return `/${skillName} ${mergedArgs}`.trim();
  }

  return `${activeContextPrompt}\n\n${text}`;
}

function applyMentionedCharacterContext(
  text: string,
  mentionedCharacters: Character[],
): string {
  if (mentionedCharacters.length === 0) {
    return text;
  }

  const characterContext = mentionedCharacters
    .map((char) => {
      let context = `角色：${char.name}`;
      if (char.description) context += `\n简介：${char.description}`;
      if (char.personality) context += `\n性格：${char.personality}`;
      if (char.background) context += `\n背景：${char.background}`;
      return context;
    })
    .join("\n\n");

  return `[角色上下文]\n${characterContext}\n\n[用户输入]\n${text}`;
}

function applyRuntimeStyleMessagePrompt(
  text: string,
  runtimeStyleMessagePrompt: string,
  sendOptions?: HandleSendOptions,
): string {
  if (sendOptions?.purpose || !runtimeStyleMessagePrompt.trim()) {
    return text;
  }

  return `[本次任务风格要求]\n${runtimeStyleMessagePrompt}\n\n[用户输入]\n${text}`;
}

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
  activeTheme,
  mappedTheme,
  isThemeWorkbench,
  contextWorkspace,
  runtimeStyleMessagePrompt,
  projectId,
  executionStrategy,
  preferredTeamPresetId,
  selectedTeam,
  selectedTeamLabel,
  selectedTeamSummary,
  currentGateKey,
  themeWorkbenchActiveQueueTitle,
  contentId,
  workspaceRequestMetadataBase,
  messagesCount,
  sendMessage,
  resolveSendBoundary,
  isBlockedByBrowserPreflight,
  maybeStartBrowserTaskPreflight,
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  prepareRuntimeTeamBeforeSend: _prepareRuntimeTeamBeforeSend,
  setRuntimeTeamDispatchPreview,
  ensureBrowserAssistCanvas,
  handleImageWorkbenchCommand,
}: UseWorkspaceSendActionsParams) {
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
      let sourceText = textOverride ?? input;
      if (!sourceText.trim() && (!images || images.length === 0)) {
        return false;
      }

      const sendBoundary = resolveSendBoundary({
        sourceText,
        sendOptions,
      });
      sourceText = sendBoundary.sourceText;

      if (isBlockedByBrowserPreflight(sendOptions)) {
        toast.info("请先完成当前浏览器准备后，再继续发送新的任务");
        return false;
      }

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
        return false;
      }

      const parsedImageWorkbenchCommand =
        !sendOptions?.purpose && sourceText.trim()
          ? parseImageWorkbenchCommand(sourceText)
          : null;
      if (parsedImageWorkbenchCommand) {
        return handleImageWorkbenchCommand({
          rawText: sourceText,
          parsedCommand: parsedImageWorkbenchCommand,
          images: images || [],
        });
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
        return true;
      }

      let text = sourceText;
      const preparedActiveContextPrompt = contextWorkspace.enabled
        ? await contextWorkspace.prepareActiveContextPrompt()
        : "";
      if (contextWorkspace.enabled && preparedActiveContextPrompt) {
        text = applyActiveContextPrompt(text, preparedActiveContextPrompt);
      }

      text = applyMentionedCharacterContext(text, mentionedCharacters);
      text = applyRuntimeStyleMessagePrompt(
        text,
        runtimeStyleMessagePrompt,
        sendOptions,
      );

      if (browserRequirementMatch) {
        void ensureBrowserAssistCanvas(
          browserRequirementMatch.launchUrl || sourceText,
          {
            silent: true,
            navigationMode:
              browserRequirementMatch.launchUrl &&
              browserRequirementMatch.launchUrl !== sourceText
                ? "explicit-url"
                : "best-effort",
          },
        ).catch((error) => {
          console.warn(
            "[AgentChatPage] 强浏览器任务发送前准备浏览器失败，继续由主流程处理:",
            error,
          );
        });
      } else {
        preheatBrowserAssistInBackground({
          activeTheme,
          sourceText,
          ensureBrowserAssistCanvas,
          onError: (error) => {
            console.warn(
              "[AgentChatPage] 发送前预热浏览器协助失败，继续发送消息:",
              error,
            );
          },
        });
      }

      setRuntimeTeamDispatchPreview(null);

      try {
        const preparedRuntimeTeamState = await _prepareRuntimeTeamBeforeSend({
          input: sourceText,
          purpose: sendOptions?.purpose,
          subagentEnabled: effectiveToolPreferences.subagent,
        });
        if (preparedRuntimeTeamState) {
          setRuntimeTeamDispatchPreview({
            key: preparedRuntimeTeamState.requestId,
            prompt: sourceText,
            images: images || [],
            baseMessageCount: messagesCount,
            status: preparedRuntimeTeamState.status,
            formationState: preparedRuntimeTeamState,
            failureMessage:
              preparedRuntimeTeamState.errorMessage?.trim() || null,
          });
        }

        setInput("");
        setMentionedCharacters([]);

        const existingHarnessMetadata = extractExistingHarnessMetadata({
          ...(workspaceRequestMetadataBase || {}),
          ...(sendOptions?.requestMetadata || {}),
        });
        const nextRequestMetadata: Record<string, unknown> = {
          ...(workspaceRequestMetadataBase || {}),
          ...(sendOptions?.requestMetadata || {}),
          harness: buildHarnessRequestMetadata({
            base: existingHarnessMetadata,
            theme: mappedTheme,
            turnPurpose: sendOptions?.purpose,
            preferences: {
              webSearch: effectiveWebSearch,
              thinking: effectiveThinking,
              task: effectiveToolPreferences.task,
              subagent: effectiveToolPreferences.subagent,
            },
            sessionMode: isThemeWorkbench ? "theme_workbench" : "default",
            gateKey: isThemeWorkbench ? currentGateKey : undefined,
            runTitle: themeWorkbenchActiveQueueTitle?.trim() || undefined,
            contentId: contentId || undefined,
            browserRequirement: browserRequirementMatch?.requirement,
            browserRequirementReason: browserRequirementMatch?.reason,
            browserLaunchUrl: browserRequirementMatch?.launchUrl,
            browserAssistProfileKey:
              mappedTheme === "general"
                ? GENERAL_BROWSER_ASSIST_PROFILE_KEY
                : undefined,
            preferredTeamPresetId,
            selectedTeamId: selectedTeam?.id,
            selectedTeamSource: selectedTeam?.source,
            selectedTeamLabel,
            selectedTeamSummary,
            selectedTeamRoles: selectedTeam?.roles,
          }),
        };
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          requestMetadata: nextRequestMetadata,
        };

        await sendMessage(
          text,
          images || [],
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
      activeTheme,
      chatToolPreferences,
      contentId,
      contextWorkspace,
      currentGateKey,
      ensureBrowserAssistCanvas,
      finalizeAfterSendSuccess,
      handleImageWorkbenchCommand,
      input,
      isBlockedByBrowserPreflight,
      isThemeWorkbench,
      mappedTheme,
      maybeStartBrowserTaskPreflight,
      mentionedCharacters,
      messagesCount,
      preferredTeamPresetId,
      _prepareRuntimeTeamBeforeSend,
      projectId,
      resolveSendBoundary,
      rollbackAfterSendFailure,
      runtimeStyleMessagePrompt,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      sendMessage,
      setMentionedCharacters,
      setInput,
      setRuntimeTeamDispatchPreview,
      themeWorkbenchActiveQueueTitle,
      workspaceRequestMetadataBase,
    ],
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
