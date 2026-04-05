import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { parseCoverWorkbenchCommand } from "../utils/coverWorkbenchCommand";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { parseTranscriptionWorkbenchCommand } from "../utils/transcriptionWorkbenchCommand";
import { parseUrlParseWorkbenchCommand } from "../utils/urlParseWorkbenchCommand";
import { parseVideoWorkbenchCommand } from "../utils/videoWorkbenchCommand";
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
  hasServiceSkillLaunchRequestMetadata,
  primeBrowserAssistBeforeSend,
  type ContextWorkspaceSummary,
  type EnsureBrowserAssistCanvasOptions,
} from "./workspaceSendHelpers";
import {
  createSubmissionPreviewSnapshot,
  type SubmissionPreviewSnapshot,
} from "./submissionPreview";
import type { Character } from "@/lib/api/memory";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { ImageWorkbenchSkillRequest } from "./useWorkspaceImageWorkbenchActionRuntime";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type SetStringState = (value: string) => void;
type ParsedImageWorkbenchCommand = NonNullable<
  ReturnType<typeof parseImageWorkbenchCommand>
>;
type ParsedCoverWorkbenchCommand = NonNullable<
  ReturnType<typeof parseCoverWorkbenchCommand>
>;
type ParsedVideoWorkbenchCommand = NonNullable<
  ReturnType<typeof parseVideoWorkbenchCommand>
>;
type ParsedTranscriptionWorkbenchCommand = NonNullable<
  ReturnType<typeof parseTranscriptionWorkbenchCommand>
>;
type ParsedUrlParseWorkbenchCommand = NonNullable<
  ReturnType<typeof parseUrlParseWorkbenchCommand>
>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildModelSkillLaunchRequestMetadata(params: {
  existingMetadata: Record<string, unknown> | undefined;
  requestContext: Record<string, unknown>;
  launchKey:
    | "image_skill_launch"
    | "cover_skill_launch"
    | "video_skill_launch"
    | "transcription_skill_launch"
    | "url_parse_skill_launch";
  requestContextKey:
    | "image_task"
    | "cover_task"
    | "video_task"
    | "transcription_task"
    | "url_parse_task";
  defaultKind:
    | "image_task"
    | "cover_task"
    | "video_task"
    | "transcription_task"
    | "url_parse_task";
  skillName:
    | "image_generate"
    | "cover_generate"
    | "video_generate"
    | "transcription_generate"
    | "url_parse";
}): Record<string, unknown> {
  const scopedRequestContext = asRecord(
    params.requestContext[params.requestContextKey],
  );
  const existingHarness = asRecord(params.existingMetadata?.harness);

  return {
    ...(params.existingMetadata || {}),
    harness: {
      ...(existingHarness || {}),
      allow_model_skills: true,
      [params.launchKey]: {
        skill_name: params.skillName,
        kind:
          typeof params.requestContext.kind === "string"
            ? params.requestContext.kind
            : params.defaultKind,
        ...(scopedRequestContext
          ? {
              [params.requestContextKey]: scopedRequestContext,
            }
          : { request_context: params.requestContext }),
      },
    },
  };
}

function buildImageSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "image_skill_launch",
    requestContextKey: "image_task",
    defaultKind: "image_task",
    skillName: "image_generate",
  });
}

function buildCoverSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "cover_skill_launch",
    requestContextKey: "cover_task",
    defaultKind: "cover_task",
    skillName: "cover_generate",
  });
}

function buildVideoSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "video_skill_launch",
    requestContextKey: "video_task",
    defaultKind: "video_task",
    skillName: "video_generate",
  });
}

function buildTranscriptionSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "transcription_skill_launch",
    requestContextKey: "transcription_task",
    defaultKind: "transcription_task",
    skillName: "transcription_generate",
  });
}

function buildUrlParseSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "url_parse_skill_launch",
    requestContextKey: "url_parse_task",
    defaultKind: "url_parse_task",
    skillName: "url_parse",
  });
}

function buildVideoSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedVideoWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  if (!params.projectId) {
    toast.error("请先选择项目后再开始生成视频");
    return null;
  }

  const prompt = params.parsedCommand.prompt.trim();
  if (!prompt) {
    toast.error("请补充清晰的视频描述后再提交");
    return null;
  }

  return {
    kind: "video_task",
    video_task: {
      prompt,
      raw_text: params.rawText,
      duration: params.parsedCommand.duration,
      aspect_ratio: params.parsedCommand.aspectRatio,
      resolution: params.parsedCommand.resolution,
      project_id: params.projectId,
      content_id: params.contentId || undefined,
      entry_source: "at_video_command",
    },
  };
}

function buildCoverSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedCoverWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt =
    params.parsedCommand.prompt.trim() ||
    params.parsedCommand.title?.trim() ||
    "";
  if (!prompt) {
    toast.error("请补充封面主题或视觉描述后再提交");
    return null;
  }

  return {
    kind: "cover_task",
    cover_task: {
      raw_text: params.rawText,
      prompt,
      title: params.parsedCommand.title,
      platform: params.parsedCommand.platform,
      size: params.parsedCommand.size,
      style: params.parsedCommand.style,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_cover_command",
    },
  };
}

function buildTranscriptionSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedTranscriptionWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  return {
    kind: "transcription_task",
    transcription_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
      source_url: params.parsedCommand.sourceUrl,
      source_path: params.parsedCommand.sourcePath,
      language: params.parsedCommand.language,
      output_format: params.parsedCommand.outputFormat,
      speaker_labels: params.parsedCommand.speakerLabels,
      timestamps: params.parsedCommand.timestamps,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_transcription_command",
    },
  };
}

function buildUrlParseSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedUrlParseWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  return {
    kind: "url_parse_task",
    url_parse_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
      url: params.parsedCommand.url,
      extract_goal: params.parsedCommand.extractGoal,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_url_parse_command",
    },
  };
}

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
  projectId?: string | null;
  executionStrategy: ExecutionStrategy;
  accessMode?: AgentAccessMode;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
  teamMemoryShadowSnapshot?: TeamMemorySnapshot | null;
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
  resolveImageWorkbenchSkillRequest: (input: {
    rawText: string;
    parsedCommand: ParsedImageWorkbenchCommand;
    images: MessageImage[];
  }) => ImageWorkbenchSkillRequest | null;
}

interface WorkspaceResolvedSendState {
  sourceText: string;
  dispatchText: string;
  sendBoundary: ThemeWorkbenchSendBoundaryState;
  effectiveToolPreferences: ChatToolPreferences;
  effectiveWebSearch?: boolean;
  effectiveThinking?: boolean;
  submissionPreviewKey: string;
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
  projectId,
  executionStrategy,
  accessMode,
  preferredTeamPresetId,
  selectedTeam,
  selectedTeamLabel,
  selectedTeamSummary,
  teamMemoryShadowSnapshot,
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
  resolveImageWorkbenchSkillRequest,
}: UseWorkspaceSendActionsParams) {
  const [submissionPreview, setSubmissionPreview] =
    useState<SubmissionPreviewSnapshot | null>(null);

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
      let effectiveImages = images || [];
      const sendBoundary = resolveSendBoundary({
        sourceText,
        sendOptions,
      });
      sourceText = sendBoundary.sourceText;
      let dispatchText = sourceText;

      const effectiveToolPreferences =
        sendOptions?.toolPreferencesOverride ?? chatToolPreferences;
      const { browserRequirementMatch } = sendBoundary;
      const hasBoundServiceSkillLaunch = hasServiceSkillLaunchRequestMetadata({
        ...(workspaceRequestMetadataBase || {}),
        ...(sendOptions?.requestMetadata || {}),
      });
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
        if (parsedImageWorkbenchCommand.trigger.trim().startsWith("@")) {
          return {
            kind: "done",
            result: await handleImageWorkbenchCommand({
              rawText: sourceText,
              parsedCommand: parsedImageWorkbenchCommand,
              images: effectiveImages,
            }),
          };
        }
        const skillRequest = resolveImageWorkbenchSkillRequest({
          rawText: sourceText,
          parsedCommand: parsedImageWorkbenchCommand,
          images: effectiveImages,
        });
        if (!skillRequest) {
          return { kind: "done", result: false };
        }
        effectiveImages =
          skillRequest.images.length > 0
            ? skillRequest.images
            : effectiveImages;
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildImageSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            skillRequest.requestContext,
          ),
        };
      }

      const parsedCoverWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand
          ? parseCoverWorkbenchCommand(sourceText)
          : null;
      if (parsedCoverWorkbenchCommand) {
        const requestContext = buildCoverSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedCoverWorkbenchCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildCoverSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
      }

      const parsedVideoWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand
          ? parseVideoWorkbenchCommand(sourceText)
          : null;
      if (parsedVideoWorkbenchCommand) {
        const requestContext = buildVideoSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedVideoWorkbenchCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildVideoSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
      }

      const parsedTranscriptionWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand
          ? parseTranscriptionWorkbenchCommand(sourceText)
          : null;
      if (parsedTranscriptionWorkbenchCommand) {
        const requestContext = buildTranscriptionSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedTranscriptionWorkbenchCommand,
          projectId,
          contentId,
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildTranscriptionSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
      }

      const parsedUrlParseWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand
          ? parseUrlParseWorkbenchCommand(sourceText)
          : null;
      if (parsedUrlParseWorkbenchCommand) {
        const requestContext = buildUrlParseSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedUrlParseWorkbenchCommand,
          projectId,
          contentId,
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildUrlParseSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
      }

      const trimmedSourceText = sourceText.trim();
      if (
        activeTheme === "general" &&
        !sendOptions?.purpose &&
        !hasBoundServiceSkillLaunch &&
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
        !hasBoundServiceSkillLaunch &&
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

      if (!hasBoundServiceSkillLaunch) {
        primeBrowserAssistBeforeSend({
          activeTheme,
          sourceText,
          browserRequirementMatch,
          ensureBrowserAssistCanvas,
        });
      }

      const submissionPreviewKey = crypto.randomUUID();
      setSubmissionPreview(
        createSubmissionPreviewSnapshot({
          key: submissionPreviewKey,
          prompt: sourceText,
          images: images || [],
          executionStrategy: sendExecutionStrategy ?? executionStrategy,
          webSearch: effectiveWebSearch,
          thinking: effectiveThinking,
        }),
      );

      let text: string;
      try {
        text = await buildWorkspaceSendText({
          sourceText: dispatchText,
          contextWorkspace,
          mentionedCharacters,
          sendOptions,
        });
      } catch (error) {
        setSubmissionPreview((current) =>
          current?.key === submissionPreviewKey ? null : current,
        );
        throw error;
      }

      return {
        kind: "ready",
        plan: {
          sourceText,
          dispatchText,
          text,
          images: effectiveImages,
          sendBoundary,
          effectiveToolPreferences,
          effectiveWebSearch,
          effectiveThinking,
          submissionPreviewKey,
          sendExecutionStrategy,
          autoContinuePayload,
          sendOptions,
        },
      };
    },
    [
      activeTheme,
      chatToolPreferences,
      contentId,
      contextWorkspace,
      ensureBrowserAssistCanvas,
      executionStrategy,
      handleAutoLaunchMatchedSiteSkill,
      handleImageWorkbenchCommand,
      resolveImageWorkbenchSkillRequest,
      input,
      maybeStartBrowserTaskPreflight,
      mentionedCharacters,
      projectId,
      resolveSendBoundary,
      serviceSkills,
      workspaceRequestMetadataBase,
    ],
  );

  const executeSendPlan = useCallback(
    async (plan: WorkspaceSendPlan): Promise<boolean> => {
      const {
        sourceText,
        dispatchText,
        text,
        images,
        sendBoundary,
        effectiveToolPreferences,
        effectiveWebSearch,
        effectiveThinking,
        submissionPreviewKey,
        sendExecutionStrategy,
        autoContinuePayload,
        sendOptions,
      } = plan;

      setRuntimeTeamDispatchPreview(null);
      setInput("");
      setMentionedCharacters([]);

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
          teamMemoryShadowSnapshot,
        });
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          displayContent:
            dispatchText !== sourceText
              ? sourceText
              : sendOptions?.displayContent,
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
      } finally {
        setSubmissionPreview((current) =>
          current?.key === submissionPreviewKey ? null : current,
        );
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
      teamMemoryShadowSnapshot,
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
    submissionPreview,
  };
}
