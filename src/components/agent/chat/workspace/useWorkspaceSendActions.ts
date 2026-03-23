import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import { loadConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { loadProviderModels } from "@/hooks/useProviderModels";
import type { Character } from "@/lib/api/memory";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { preheatBrowserAssistInBackground } from "../utils/browserAssistPreheat";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { resolveProviderModelCompatibility } from "../utils/providerModelCompatibility";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
  type HarnessTurnTeamBlueprint,
} from "../utils/harnessRequestMetadata";
import { isTeamRuntimeRecommendation } from "../utils/contextualRecommendations";
import { saveChatToolPreferences, type ChatToolPreferences } from "../utils/chatToolPreferences";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ThemeWorkbenchSendBoundaryState } from "../hooks/useThemeWorkbenchSendBoundary";
import {
  shouldPrepareRuntimeTeamBeforeSend,
  type UseRuntimeTeamFormationResult,
} from "../hooks/useRuntimeTeamFormation";
import type { SendMessageFn } from "../hooks/agentChatShared";
import {
  isReasoningModel,
  resolveBaseModelOnThinkingOff,
  resolveThinkingModel,
} from "@/lib/model/thinkingModelResolver";
import { resolveVisionModel } from "@/lib/model/visionModelResolver";
import {
  loadRememberedBaseModel,
  saveRememberedBaseModel,
} from "@/lib/model/thinkingBaseModelMemory";
import type { MessageImage } from "../types";
import type { CreationMode, ThemeType } from "@/components/content-creator/types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  buildRuntimeTeamAssistantDraft,
  type RuntimeTeamDispatchPreviewSnapshot,
} from "./runtimeTeamPreview";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type ChatMode = "agent" | "general" | "creator";
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
  creationMode: CreationMode;
  chatMode: ChatMode;
  isThemeWorkbench: boolean;
  contextWorkspace: ContextWorkspaceSummary;
  runtimeStyleMessagePrompt: string;
  projectId?: string | null;
  sessionId?: string | null;
  providerType: string;
  model: string;
  setModel: SetStringState;
  executionStrategy: ExecutionStrategy;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
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

function buildPreparedRuntimeTeamBlueprint(
  runtimeTeamState: TeamWorkspaceRuntimeFormationState | null | undefined,
): HarnessTurnTeamBlueprint | undefined {
  if (!runtimeTeamState || runtimeTeamState.status !== "formed") {
    return undefined;
  }

  return {
    label:
      runtimeTeamState.label?.trim() ||
      runtimeTeamState.blueprint?.label?.trim() ||
      undefined,
    description:
      runtimeTeamState.summary?.trim() ||
      runtimeTeamState.blueprint?.summary?.trim() ||
      undefined,
    roles:
      runtimeTeamState.members.length > 0
        ? runtimeTeamState.members.map((member, index) => ({
            id: member.id?.trim() || `runtime-member-${index + 1}`,
            label: member.label?.trim() || `角色 ${index + 1}`,
            summary:
              member.summary?.trim() ||
              `${member.label?.trim() || `角色 ${index + 1}`}负责当前子任务。`,
            profileId: member.profileId?.trim() || undefined,
            roleKey: member.roleKey?.trim() || undefined,
            skillIds:
              member.skillIds.length > 0 ? [...member.skillIds] : undefined,
          }))
        : undefined,
  };
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
  creationMode,
  chatMode,
  isThemeWorkbench,
  contextWorkspace,
  runtimeStyleMessagePrompt,
  projectId,
  sessionId,
  providerType,
  model,
  setModel,
  executionStrategy,
  preferredTeamPresetId,
  selectedTeam,
  selectedTeamLabel,
  selectedTeamSummary,
  currentGateKey,
  themeWorkbenchActiveQueueTitle,
  contentId,
  messagesCount,
  sendMessage,
  resolveSendBoundary,
  isBlockedByBrowserPreflight,
  maybeStartBrowserTaskPreflight,
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  prepareRuntimeTeamBeforeSend,
  setRuntimeTeamDispatchPreview,
  ensureBrowserAssistCanvas,
  handleImageWorkbenchCommand,
}: UseWorkspaceSendActionsParams) {
  const thinkingVariantWarnedRef = useRef<Set<string>>(new Set());

  const resolveSendProviderContext = useCallback(async () => {
    const configuredProviders = await loadConfiguredProviders();
    const selectedProvider =
      configuredProviders.find((provider) => provider.key === providerType) ||
      null;
    const providerModels = await loadProviderModels(selectedProvider);

    return {
      selectedProvider,
      providerModels,
    };
  }, [providerType]);

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
        const { selectedProvider, providerModels } =
          await resolveSendProviderContext();
        const memoryParams = {
          scope: "aster" as const,
          workspaceId: projectId,
          sessionId,
          providerKey: providerType,
        };
        const rememberedBaseModel = loadRememberedBaseModel(memoryParams);
        let effectiveModel = model;

        if (effectiveThinking) {
          if (!isReasoningModel(model, providerModels)) {
            saveRememberedBaseModel({
              ...memoryParams,
              modelId: model,
            });
          }

          const thinkingResult = resolveThinkingModel({
            currentModelId: model,
            models: providerModels,
          });
          effectiveModel = thinkingResult.targetModelId;

          if (thinkingResult.switched) {
            setModel(thinkingResult.targetModelId);
          } else if (
            thinkingResult.reason === "no_variant" &&
            providerModels.length > 0
          ) {
            const warnKey = `${providerType}:${model}`;
            if (!thinkingVariantWarnedRef.current.has(warnKey)) {
              thinkingVariantWarnedRef.current.add(warnKey);
              toast.warning(
                "当前 Provider 没有可用的 Thinking 模型，已保持原模型",
              );
            }
          }
        } else {
          const restoreResult = resolveBaseModelOnThinkingOff({
            currentModelId: model,
            models: providerModels,
            rememberedBaseModel,
          });
          effectiveModel = restoreResult.targetModelId;

          if (restoreResult.switched) {
            setModel(restoreResult.targetModelId);
          }
        }

        const compatibilityResult = resolveProviderModelCompatibility({
          providerType,
          configuredProviderType: selectedProvider?.type,
          model: effectiveModel,
        });
        if (compatibilityResult.changed) {
          effectiveModel = compatibilityResult.model;
          if (model !== compatibilityResult.model) {
            setModel(compatibilityResult.model);
          }
          if (compatibilityResult.reason) {
            toast.warning(compatibilityResult.reason);
          }
        }

        if ((images?.length || 0) > 0) {
          const visionResult = resolveVisionModel({
            currentModelId: effectiveModel,
            models: providerModels,
          });

          if (visionResult.reason === "no_vision_model") {
            toast.error(
              "当前 Provider 没有可用的多模态模型，请切换到支持多模态的 Provider 或模型后再发送图片",
            );
            return false;
          }

          if (visionResult.reason !== "already_vision") {
            const suggestedModel = visionResult.targetModelId.trim();
            toast.error(
              suggestedModel
                ? `当前模型 ${effectiveModel} 不支持多模态图片理解，请切换到 ${suggestedModel} 或其他支持多模态的模型后再发送图片`
                : `当前模型 ${effectiveModel} 不支持多模态图片理解，请切换到支持多模态的模型后再发送图片`,
            );
            return false;
          }
        }

        const shouldPrepareRuntimeTeam = shouldPrepareRuntimeTeamBeforeSend({
          subagentEnabled: effectiveToolPreferences.subagent,
          projectId,
          input: sourceText,
          purpose: sendOptions?.purpose,
        });
        const runtimeTeamDispatchPreviewKey = shouldPrepareRuntimeTeam
          ? crypto.randomUUID()
          : null;
        if (shouldPrepareRuntimeTeam) {
          setRuntimeTeamDispatchPreview({
            key: runtimeTeamDispatchPreviewKey as string,
            prompt: sourceText,
            images: images || [],
            baseMessageCount: messagesCount,
            status: "forming",
            formationState: null,
          });
        }
        const preparedRuntimeTeamState = await prepareRuntimeTeamBeforeSend({
          input: sourceText,
          providerType,
          model: effectiveModel,
          executionStrategy: sendExecutionStrategy ?? executionStrategy,
          purpose: sendOptions?.purpose,
          subagentEnabled: effectiveToolPreferences.subagent,
        });
        if (runtimeTeamDispatchPreviewKey) {
          if (preparedRuntimeTeamState?.status === "formed") {
            setRuntimeTeamDispatchPreview((current) =>
              current?.key === runtimeTeamDispatchPreviewKey
                ? {
                    ...current,
                    status: "formed",
                    formationState: preparedRuntimeTeamState,
                    failureMessage: null,
                  }
                : current,
            );
          } else if (preparedRuntimeTeamState?.status === "failed") {
            setRuntimeTeamDispatchPreview((current) =>
              current?.key === runtimeTeamDispatchPreviewKey
                ? {
                    ...current,
                    status: "failed",
                    formationState: null,
                    failureMessage:
                      preparedRuntimeTeamState.errorMessage?.trim() || null,
                  }
                : current,
            );
          }
        }

        const preparedRuntimeTeamBlueprint =
          buildPreparedRuntimeTeamBlueprint(preparedRuntimeTeamState);
        const turnTeamDecision =
          preparedRuntimeTeamState?.status === "formed"
            ? "team_prepared"
            : "single_agent";
        const turnTeamReason =
          preparedRuntimeTeamState?.status === "formed"
            ? "runtime_team_prepared"
            : shouldPrepareRuntimeTeam
              ? "runtime_team_generation_failed"
              : !effectiveToolPreferences.subagent
              ? "subagent_disabled"
              : sendOptions?.purpose
                ? "turn_purpose_override"
                : "single_agent_direct";
        const assistantDraft =
          preparedRuntimeTeamState?.status === "formed"
            ? buildRuntimeTeamAssistantDraft(preparedRuntimeTeamState)
            : undefined;

        setInput("");
        setMentionedCharacters([]);

        const existingHarnessMetadata = extractExistingHarnessMetadata(
          sendOptions?.requestMetadata,
        );
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: buildHarnessRequestMetadata({
              base: existingHarnessMetadata,
              theme: mappedTheme,
              creationMode,
              chatMode,
              webSearchEnabled: effectiveWebSearch,
              thinkingEnabled: effectiveThinking,
              taskModeEnabled: effectiveToolPreferences.task,
              subagentModeEnabled: effectiveToolPreferences.subagent,
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
              turnTeamDecision,
              turnTeamReason,
              turnTeamBlueprint: preparedRuntimeTeamBlueprint,
            }),
          },
        };
        const runtimeSendOptions = assistantDraft
          ? {
              ...nextSendOptions,
              assistantDraft,
            }
          : nextSendOptions;

        await sendMessage(
          text,
          images || [],
          effectiveWebSearch,
          effectiveThinking,
          false,
          sendExecutionStrategy,
          effectiveModel,
          autoContinuePayload,
          runtimeSendOptions,
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
      chatMode,
      chatToolPreferences,
      contentId,
      contextWorkspace,
      creationMode,
      currentGateKey,
      ensureBrowserAssistCanvas,
      executionStrategy,
      finalizeAfterSendSuccess,
      handleImageWorkbenchCommand,
      input,
      isBlockedByBrowserPreflight,
      isThemeWorkbench,
      mappedTheme,
      maybeStartBrowserTaskPreflight,
      mentionedCharacters,
      messagesCount,
      model,
      preferredTeamPresetId,
      prepareRuntimeTeamBeforeSend,
      projectId,
      providerType,
      resolveSendBoundary,
      resolveSendProviderContext,
      rollbackAfterSendFailure,
      runtimeStyleMessagePrompt,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      sendMessage,
      sessionId,
      setMentionedCharacters,
      setInput,
      setModel,
      setRuntimeTeamDispatchPreview,
      themeWorkbenchActiveQueueTitle,
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
