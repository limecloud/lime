import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import type {
  ServiceModelPreferenceConfig,
  ServiceModelsConfig,
} from "@/lib/api/appConfigTypes";
import { useGlobalMediaGenerationDefaults } from "@/hooks/useGlobalMediaGenerationDefaults";
import { getOrCreateDefaultProject } from "@/lib/api/project";
import { normalizeMediaGenerationPreference } from "@/lib/mediaGeneration";
import {
  mergeServiceModelPrompt,
  resolveServiceModelExecutionPreference,
} from "@/lib/serviceModels";
import { parseAnalysisWorkbenchCommand } from "../utils/analysisWorkbenchCommand";
import { parseBrowserWorkbenchCommand } from "../utils/browserWorkbenchCommand";
import { parseBroadcastWorkbenchCommand } from "../utils/broadcastWorkbenchCommand";
import { parseChannelPreviewWorkbenchCommand } from "../utils/channelPreviewWorkbenchCommand";
import { parseCodeWorkbenchCommand } from "../utils/codeWorkbenchCommand";
import { normalizeContentPostPlatform } from "../utils/contentPostPlatform";
import {
  DEFAULT_COMPLIANCE_FOCUS,
  DEFAULT_COMPLIANCE_OUTPUT_FORMAT,
  DEFAULT_COMPLIANCE_STYLE,
  parseComplianceWorkbenchCommand,
} from "../utils/complianceWorkbenchCommand";
import { parseCompetitorWorkbenchCommand } from "../utils/competitorWorkbenchCommand";
import { parseCoverWorkbenchCommand } from "../utils/coverWorkbenchCommand";
import { parseDeepSearchWorkbenchCommand } from "../utils/deepSearchWorkbenchCommand";
import { parseFormWorkbenchCommand } from "../utils/formWorkbenchCommand";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { parsePdfWorkbenchCommand } from "../utils/pdfWorkbenchCommand";
import { parsePosterWorkbenchCommand } from "../utils/posterWorkbenchCommand";
import { parsePresentationWorkbenchCommand } from "../utils/presentationWorkbenchCommand";
import { parsePublishWorkbenchCommand } from "../utils/publishWorkbenchCommand";
import { parseReportWorkbenchCommand } from "../utils/reportWorkbenchCommand";
import { parseResourceSearchWorkbenchCommand } from "../utils/resourceSearchWorkbenchCommand";
import { parseSearchWorkbenchCommand } from "../utils/searchWorkbenchCommand";
import { parseSiteSearchWorkbenchCommand } from "../utils/siteSearchWorkbenchCommand";
import { parseSummaryWorkbenchCommand } from "../utils/summaryWorkbenchCommand";
import { parseTranslationWorkbenchCommand } from "../utils/translationWorkbenchCommand";
import {
  buildMentionCommandReplayText,
  resolveMentionCommandMergedPrefillReplayText,
  resolveMentionCommandPrefillReplayText,
} from "../utils/mentionCommandReplayText";
import { parseTranscriptionWorkbenchCommand } from "../utils/transcriptionWorkbenchCommand";
import { parseTypesettingWorkbenchCommand } from "../utils/typesettingWorkbenchCommand";
import { parseUploadWorkbenchCommand } from "../utils/uploadWorkbenchCommand";
import {
  isUrlParseReadTrigger,
  isUrlParseScrapeTrigger,
  parseUrlParseWorkbenchCommand,
} from "../utils/urlParseWorkbenchCommand";
import { parseVideoWorkbenchCommand } from "../utils/videoWorkbenchCommand";
import { parseVoiceWorkbenchCommand } from "../utils/voiceWorkbenchCommand";
import { parseWebpageWorkbenchCommand } from "../utils/webpageWorkbenchCommand";
import { detectBrowserTaskRequirement } from "../utils/browserTaskRequirement";
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
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { SendMessageFn } from "../hooks/agentChatShared";
import type { Message, MessageImage } from "../types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import {
  buildInitialDispatchPreviewMessages,
  buildRuntimeTeamDispatchPreview,
  buildRuntimeTeamDispatchPreviewMessages,
  buildSubmissionPreviewMessages,
  type GeneralWorkbenchSendBoundaryState,
  type InitialDispatchPreviewSnapshot,
  resolveRuntimeTeamDispatchPreviewState,
  type RuntimeTeamDispatchPreviewSnapshot,
  createSubmissionPreviewSnapshot,
  type SubmissionPreviewSnapshot,
  buildWorkspaceRequestMetadata,
  buildWorkspaceSendText,
  hasModelSkillLaunchRequestMetadata,
  hasServiceSkillLaunchRequestMetadata,
  primeBrowserAssistBeforeSend,
  type ContextWorkspaceSummary,
  type EnsureBrowserAssistCanvasOptions,
} from "./workspaceSendHelpers";
import type { Character } from "@/lib/api/memory";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "../service-skills/types";
import {
  buildImageSkillLaunchRequestMetadata,
  type ImageWorkbenchSkillRequest,
} from "./imageSkillLaunch";
import {
  buildServiceSceneLaunchRequestMetadata,
  parseRuntimeSceneCommand,
  RuntimeSceneLaunchValidationError,
  resolveRuntimeSceneLaunchRequest,
} from "./serviceSkillSceneLaunch";
import {
  resolveInputCapabilityDispatchContext,
  type CompletedInputCapabilitySlashUsage,
} from "./inputCapabilityRouting";
import type { RuntimeSceneGateRequest } from "./sceneSkillGate";
import {
  getMentionEntryUsageMap,
  getMentionEntryUsageRecordKey,
  recordMentionEntryUsage,
} from "../skill-selection/mentionEntryUsage";
import { useRuntimeMentionCommandCatalog } from "../skill-selection/runtimeInputCapabilityCatalog";
import { recordServiceSkillUsage } from "../service-skills/storage";
import { composeServiceSkillPrompt } from "../service-skills/promptComposer";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import { CONTENT_POST_SKILL_KEY } from "../utils/contentPostSkill";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type SetStringState = (value: string) => void;
type ParsedImageWorkbenchCommand = NonNullable<
  ReturnType<typeof parseImageWorkbenchCommand>
>;
type ParsedCoverWorkbenchCommand = NonNullable<
  ReturnType<typeof parseCoverWorkbenchCommand>
>;
type ParsedCompetitorWorkbenchCommand = NonNullable<
  ReturnType<typeof parseCompetitorWorkbenchCommand>
>;
type ParsedBroadcastWorkbenchCommand = NonNullable<
  ReturnType<typeof parseBroadcastWorkbenchCommand>
>;
type ParsedComplianceWorkbenchCommand = NonNullable<
  ReturnType<typeof parseComplianceWorkbenchCommand>
>;
type ParsedAnalysisWorkbenchCommand = NonNullable<
  ReturnType<typeof parseAnalysisWorkbenchCommand>
>;
type ParsedResourceSearchWorkbenchCommand = NonNullable<
  ReturnType<typeof parseResourceSearchWorkbenchCommand>
>;
type ParsedReportWorkbenchCommand = NonNullable<
  ReturnType<typeof parseReportWorkbenchCommand>
>;
type ParsedPdfWorkbenchCommand = NonNullable<
  ReturnType<typeof parsePdfWorkbenchCommand>
>;
type ParsedPresentationWorkbenchCommand = NonNullable<
  ReturnType<typeof parsePresentationWorkbenchCommand>
>;
type ParsedChannelPreviewWorkbenchCommand = NonNullable<
  ReturnType<typeof parseChannelPreviewWorkbenchCommand>
>;
type ParsedFormWorkbenchCommand = NonNullable<
  ReturnType<typeof parseFormWorkbenchCommand>
>;
type ParsedPublishWorkbenchCommand = NonNullable<
  ReturnType<typeof parsePublishWorkbenchCommand>
>;
type ParsedSearchWorkbenchCommand = NonNullable<
  ReturnType<typeof parseSearchWorkbenchCommand>
>;
type ParsedDeepSearchWorkbenchCommand = NonNullable<
  ReturnType<typeof parseDeepSearchWorkbenchCommand>
>;
type ParsedSiteSearchWorkbenchCommand = NonNullable<
  ReturnType<typeof parseSiteSearchWorkbenchCommand>
>;
type ParsedSummaryWorkbenchCommand = NonNullable<
  ReturnType<typeof parseSummaryWorkbenchCommand>
>;
type ParsedTranslationWorkbenchCommand = NonNullable<
  ReturnType<typeof parseTranslationWorkbenchCommand>
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
type ParsedTypesettingWorkbenchCommand = NonNullable<
  ReturnType<typeof parseTypesettingWorkbenchCommand>
>;
type ParsedUploadWorkbenchCommand = NonNullable<
  ReturnType<typeof parseUploadWorkbenchCommand>
>;
type ParsedVoiceWorkbenchCommand = NonNullable<
  ReturnType<typeof parseVoiceWorkbenchCommand>
>;
type ParsedWebpageWorkbenchCommand = NonNullable<
  ReturnType<typeof parseWebpageWorkbenchCommand>
>;
type CompletedMentionUsage = {
  skillId: string;
  runnerType: ServiceSkillHomeItem["runnerType"];
  slotValues?: ServiceSkillSlotValues;
  launchUserInput?: string;
};
type CompletedMentionCommandUsage = {
  entryId: string;
  replayText?: string;
  slotValues?: ServiceSkillSlotValues;
};
type RewritePurpose = NonNullable<HandleSendOptions["purpose"]>;

const PROMPT_REWRITE_PURPOSES = new Set<RewritePurpose>([
  "content_review",
  "text_stylize",
  "style_rewrite",
  "style_audit",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function hasHarnessLaunchRequestMetadata(
  requestMetadata: Record<string, unknown> | undefined,
  launchKey: "translation_skill_launch" | "resource_search_skill_launch",
): boolean {
  return Boolean(asRecord(asRecord(requestMetadata?.harness)?.[launchKey]));
}

function resolveServiceModelSendOverrides(params: {
  requestMetadata: Record<string, unknown> | undefined;
  purpose?: HandleSendOptions["purpose"];
  serviceModels?: ServiceModelsConfig;
}): Pick<HandleSendOptions, "providerOverride" | "modelOverride"> {
  const { requestMetadata, purpose, serviceModels } = params;

  const harnessMetadata = asRecord(requestMetadata?.harness);
  const serviceSceneLaunch =
    asRecord(harnessMetadata?.service_scene_launch) ??
    asRecord(harnessMetadata?.serviceSceneLaunch);
  const serviceSceneRun =
    asRecord(serviceSceneLaunch?.service_scene_run) ??
    asRecord(serviceSceneLaunch?.serviceSceneRun);

  let preference: ServiceModelPreferenceConfig | undefined;
  if (
    hasHarnessLaunchRequestMetadata(requestMetadata, "translation_skill_launch")
  ) {
    preference = serviceModels?.translation;
  } else if (
    hasHarnessLaunchRequestMetadata(
      requestMetadata,
      "resource_search_skill_launch",
    )
  ) {
    preference = serviceModels?.resource_prompt_rewrite;
  } else if (purpose && PROMPT_REWRITE_PURPOSES.has(purpose)) {
    preference = serviceModels?.prompt_rewrite;
  }

  const resolvedPreference = resolveServiceModelExecutionPreference(preference);
  const serviceScenePreferredProvider = normalizeOptionalText(
    typeof serviceSceneRun?.preferred_provider_id === "string"
      ? serviceSceneRun.preferred_provider_id
      : typeof serviceSceneRun?.preferredProviderId === "string"
        ? serviceSceneRun.preferredProviderId
        : undefined,
  );
  const serviceScenePreferredModel = normalizeOptionalText(
    typeof serviceSceneRun?.preferred_model_id === "string"
      ? serviceSceneRun.preferred_model_id
      : typeof serviceSceneRun?.preferredModelId === "string"
        ? serviceSceneRun.preferredModelId
        : typeof serviceSceneRun?.model === "string"
          ? serviceSceneRun.model
          : undefined,
  );

  return {
    providerOverride:
      resolvedPreference.providerOverride ??
      (serviceScenePreferredProvider && serviceScenePreferredModel
        ? serviceScenePreferredProvider
        : undefined),
    modelOverride:
      resolvedPreference.modelOverride ??
      (serviceScenePreferredProvider && serviceScenePreferredModel
        ? serviceScenePreferredModel
        : undefined),
  };
}

function normalizeServiceSkillUsageSlotValue(
  value: unknown,
): string | undefined {
  if (typeof value === "string") {
    return normalizeOptionalText(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return undefined;
}

const MENTION_USAGE_REQUEST_FIELDS: Readonly<Record<string, readonly string[]>> =
  {
    image_task: [
      "mode",
      "prompt",
      "count",
      "size",
      "aspect_ratio",
      "target_output_ref_id",
    ],
    cover_task: ["prompt", "title", "platform", "size", "style"],
    video_task: ["prompt", "duration", "aspect_ratio", "resolution"],
    broadcast_task: [
      "prompt",
      "content",
      "title",
      "audience",
      "tone",
      "duration_hint_minutes",
    ],
    resource_search_task: [
      "prompt",
      "title",
      "resource_type",
      "query",
      "usage",
      "count",
    ],
    transcription_task: [
      "prompt",
      "source_url",
      "source_path",
      "language",
      "output_format",
      "speaker_labels",
      "timestamps",
    ],
    research_request: [
      "prompt",
      "query",
      "site",
      "time_range",
      "depth",
      "focus",
      "output_format",
    ],
    deep_search_request: [
      "prompt",
      "query",
      "site",
      "time_range",
      "depth",
      "focus",
      "output_format",
    ],
    report_request: [
      "prompt",
      "query",
      "site",
      "time_range",
      "depth",
      "focus",
      "output_format",
    ],
    site_search_request: ["prompt", "site", "query", "limit"],
    pdf_read_request: [
      "prompt",
      "source_path",
      "source_url",
      "focus",
      "output_format",
    ],
    summary_request: [
      "prompt",
      "content",
      "focus",
      "length",
      "style",
      "output_format",
    ],
    translation_request: [
      "prompt",
      "content",
      "source_language",
      "target_language",
      "style",
      "output_format",
    ],
    analysis_request: [
      "prompt",
      "content",
      "focus",
      "style",
      "output_format",
    ],
    url_parse_task: ["prompt", "url", "extract_goal"],
    typesetting_task: ["prompt", "content", "target_platform"],
    presentation_request: [
      "prompt",
      "content",
      "deck_type",
      "style",
      "audience",
      "slide_count",
    ],
    form_request: [
      "prompt",
      "content",
      "form_type",
      "style",
      "audience",
      "field_count",
    ],
    webpage_request: [
      "prompt",
      "content",
      "page_type",
      "style",
      "tech_stack",
    ],
    service_scene: ["user_input", "target_language", "voice_style"],
    publish_command: [
      "prompt",
      "content",
      "platform_type",
      "platform_label",
      "intent",
    ],
  };

const MENTION_USAGE_MODEL_SKILL_LAUNCHES = [
  {
    launchKey: "image_skill_launch",
    requestContextKey: "image_task",
  },
  {
    launchKey: "cover_skill_launch",
    requestContextKey: "cover_task",
  },
  {
    launchKey: "video_skill_launch",
    requestContextKey: "video_task",
  },
  {
    launchKey: "broadcast_skill_launch",
    requestContextKey: "broadcast_task",
  },
  {
    launchKey: "resource_search_skill_launch",
    requestContextKey: "resource_search_task",
  },
  {
    launchKey: "research_skill_launch",
    requestContextKey: "research_request",
  },
  {
    launchKey: "report_skill_launch",
    requestContextKey: "report_request",
  },
  {
    launchKey: "deep_search_skill_launch",
    requestContextKey: "deep_search_request",
  },
  {
    launchKey: "site_search_skill_launch",
    requestContextKey: "site_search_request",
  },
  {
    launchKey: "pdf_read_skill_launch",
    requestContextKey: "pdf_read_request",
  },
  {
    launchKey: "summary_skill_launch",
    requestContextKey: "summary_request",
  },
  {
    launchKey: "translation_skill_launch",
    requestContextKey: "translation_request",
  },
  {
    launchKey: "analysis_skill_launch",
    requestContextKey: "analysis_request",
  },
  {
    launchKey: "transcription_skill_launch",
    requestContextKey: "transcription_task",
  },
  {
    launchKey: "url_parse_skill_launch",
    requestContextKey: "url_parse_task",
  },
  {
    launchKey: "typesetting_skill_launch",
    requestContextKey: "typesetting_task",
  },
  {
    launchKey: "presentation_skill_launch",
    requestContextKey: "presentation_request",
  },
  {
    launchKey: "form_skill_launch",
    requestContextKey: "form_request",
  },
  {
    launchKey: "webpage_skill_launch",
    requestContextKey: "webpage_request",
  },
] as const;

function pickUsageSlotValues(
  record: Record<string, unknown>,
  fieldKeys: readonly string[],
): ServiceSkillSlotValues | undefined {
  const nextValues = Object.fromEntries(
    fieldKeys
      .map((fieldKey) => [
        fieldKey,
        normalizeServiceSkillUsageSlotValue(record[fieldKey]),
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return Object.keys(nextValues).length > 0 ? nextValues : undefined;
}

function resolveLaunchScopedRequestContext(
  launchMetadata: Record<string, unknown>,
  requestContextKey: string,
): Record<string, unknown> | undefined {
  return (
    asRecord(launchMetadata[requestContextKey]) ||
    asRecord(asRecord(launchMetadata.request_context)?.[requestContextKey])
  );
}

function resolveMentionCommandUsageSlotValues(
  requestMetadata: Record<string, unknown> | undefined,
): ServiceSkillSlotValues | undefined {
  const harness = asRecord(requestMetadata?.harness);
  if (!harness) {
    return undefined;
  }

  const publishCommand = asRecord(harness.publish_command);
  if (publishCommand) {
    return pickUsageSlotValues(
      publishCommand,
      MENTION_USAGE_REQUEST_FIELDS.publish_command,
    );
  }

  const serviceSceneRun = asRecord(
    asRecord(harness.service_scene_launch)?.service_scene_run,
  );
  if (serviceSceneRun) {
    return pickUsageSlotValues(
      serviceSceneRun,
      MENTION_USAGE_REQUEST_FIELDS.service_scene,
    );
  }

  for (const launch of MENTION_USAGE_MODEL_SKILL_LAUNCHES) {
    const launchMetadata = asRecord(harness[launch.launchKey]);
    if (!launchMetadata) {
      continue;
    }

    const scopedRequestContext = resolveLaunchScopedRequestContext(
      launchMetadata,
      launch.requestContextKey,
    );
    if (!scopedRequestContext) {
      continue;
    }

    return pickUsageSlotValues(
      scopedRequestContext,
      MENTION_USAGE_REQUEST_FIELDS[launch.requestContextKey],
    );
  }

  return undefined;
}

function resolveMentionCommandUsageLaunchUserInput(
  requestMetadata: Record<string, unknown> | undefined,
): string | undefined {
  const harness = asRecord(requestMetadata?.harness);
  if (!harness) {
    return undefined;
  }

  const publishCommand = asRecord(harness.publish_command);
  if (publishCommand) {
    return normalizeOptionalText(publishCommand.prompt as string | undefined);
  }

  const serviceSceneRun = asRecord(
    asRecord(harness.service_scene_launch)?.service_scene_run,
  );
  if (serviceSceneRun) {
    return normalizeOptionalText(
      serviceSceneRun.user_input as string | undefined,
    );
  }

  for (const launch of MENTION_USAGE_MODEL_SKILL_LAUNCHES) {
    const launchMetadata = asRecord(harness[launch.launchKey]);
    if (!launchMetadata) {
      continue;
    }

    const scopedRequestContext = resolveLaunchScopedRequestContext(
      launchMetadata,
      launch.requestContextKey,
    );
    if (!scopedRequestContext) {
      continue;
    }

    return normalizeOptionalText(
      ((scopedRequestContext.user_input ??
        scopedRequestContext.prompt) as string | undefined) ?? undefined,
    );
  }

  return undefined;
}

function resolveImageMentionCommandKey(
  trigger: ParsedImageWorkbenchCommand["trigger"],
): string | null {
  if (trigger === "@分镜") {
    return "image_storyboard";
  }
  if (trigger === "@修图") {
    return "image_edit";
  }
  if (trigger === "@重绘") {
    return "image_variation";
  }
  if (trigger === "@配图" || trigger === "@image") {
    return "image_generate";
  }
  return null;
}

const MAX_MENTION_COMMAND_REPLAY_TEXT_LENGTH = 400;

function normalizeMentionCommandReplayText(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, MAX_MENTION_COMMAND_REPLAY_TEXT_LENGTH).trim();
}

function resolveMentionCommandReplayText(parsedCommand: {
  body: string;
}, commandKey?: string): string | undefined {
  return normalizeMentionCommandReplayText(
    buildMentionCommandReplayText({
      commandKey,
      parsedCommand,
    }),
  );
}

function resolveBareMentionCommandPrefillSourceText(
  rawText: string,
  mentionCommandPrefixKeyMap: Map<string, string>,
): string | undefined {
  const matched = rawText.match(/^\s*(@[^\s]+)\s*$/u);
  if (!matched) {
    return undefined;
  }

  const commandPrefix = matched[1];
  const commandKey = mentionCommandPrefixKeyMap.get(
    commandPrefix.trim().toLowerCase(),
  );
  if (!commandKey) {
    return undefined;
  }

  const recentRecord = getMentionEntryUsageMap().get(
    getMentionEntryUsageRecordKey("builtin_command", commandKey),
  );
  if (!recentRecord) {
    return undefined;
  }

  const replayText = resolveMentionCommandPrefillReplayText({
    commandKey,
    replayText: recentRecord.replayText,
    slotValues: recentRecord.slotValues,
  });
  if (!replayText) {
    return undefined;
  }

  return `${commandPrefix} ${replayText}`;
}

function resolvePreferredRecentCommandText(
  current?: string | null,
  fallback?: string | null,
): string | undefined {
  return normalizeOptionalText(current) || normalizeOptionalText(fallback);
}

function normalizeRecentSummaryLength(
  value?: string | null,
): ParsedSummaryWorkbenchCommand["length"] | undefined {
  if (value === "short" || value === "medium" || value === "long") {
    return value;
  }
  return undefined;
}

function mergeSummaryCommandRecentDefaults(params: {
  parsedCommand: ParsedSummaryWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedSummaryWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    focus: resolvePreferredRecentCommandText(
      params.parsedCommand.focus,
      slotValues.focus,
    ),
    length:
      params.parsedCommand.length ??
      normalizeRecentSummaryLength(slotValues.length),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    outputFormat: resolvePreferredRecentCommandText(
      params.parsedCommand.outputFormat,
      slotValues.output_format,
    ),
  };
}

function mergeTranslationCommandRecentDefaults(params: {
  parsedCommand: ParsedTranslationWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedTranslationWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    sourceLanguage: resolvePreferredRecentCommandText(
      params.parsedCommand.sourceLanguage,
      slotValues.source_language,
    ),
    targetLanguage: resolvePreferredRecentCommandText(
      params.parsedCommand.targetLanguage,
      slotValues.target_language,
    ),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    outputFormat: resolvePreferredRecentCommandText(
      params.parsedCommand.outputFormat,
      slotValues.output_format,
    ),
  };
}

function mergeAnalysisCommandRecentDefaults(params: {
  parsedCommand: ParsedAnalysisWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedAnalysisWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    focus: resolvePreferredRecentCommandText(
      params.parsedCommand.focus,
      slotValues.focus,
    ),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    outputFormat: resolvePreferredRecentCommandText(
      params.parsedCommand.outputFormat,
      slotValues.output_format,
    ),
  };
}

function resolvePreferredComplianceCommandText(params: {
  current?: string | null;
  fallback?: string | null;
  defaultValue: string;
}): string | undefined {
  const fallback = normalizeOptionalText(params.fallback);
  const current = normalizeOptionalText(params.current);
  if (!fallback) {
    return current;
  }
  if (!current || current === params.defaultValue) {
    return fallback;
  }
  return current;
}

function mergeComplianceCommandRecentDefaults(params: {
  parsedCommand: ParsedComplianceWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedComplianceWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    focus: resolvePreferredComplianceCommandText({
      current: params.parsedCommand.focus,
      fallback: slotValues.focus,
      defaultValue: DEFAULT_COMPLIANCE_FOCUS,
    }),
    style: resolvePreferredComplianceCommandText({
      current: params.parsedCommand.style,
      fallback: slotValues.style,
      defaultValue: DEFAULT_COMPLIANCE_STYLE,
    }),
    outputFormat: resolvePreferredComplianceCommandText({
      current: params.parsedCommand.outputFormat,
      fallback: slotValues.output_format,
      defaultValue: DEFAULT_COMPLIANCE_OUTPUT_FORMAT,
    }),
  };
}

function normalizeRecentPositiveInteger(
  value?: string | null,
): number | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function normalizeRecentPresentationDeckType(
  value?: string | null,
): ParsedPresentationWorkbenchCommand["deckType"] | undefined {
  switch (value?.trim().toLowerCase()) {
    case "pitch_deck":
      return "pitch_deck";
    case "sales_deck":
      return "sales_deck";
    case "training_deck":
      return "training_deck";
    case "report_deck":
      return "report_deck";
    case "proposal_deck":
      return "proposal_deck";
    default:
      return undefined;
  }
}

function normalizeRecentFormType(
  value?: string | null,
): ParsedFormWorkbenchCommand["formType"] | undefined {
  switch (value?.trim().toLowerCase()) {
    case "survey_form":
      return "survey_form";
    case "lead_form":
      return "lead_form";
    case "registration_form":
      return "registration_form";
    case "feedback_form":
      return "feedback_form";
    case "application_form":
      return "application_form";
    default:
      return undefined;
  }
}

function normalizeRecentWebpageType(
  value?: string | null,
): ParsedWebpageWorkbenchCommand["pageType"] | undefined {
  switch (value?.trim().toLowerCase()) {
    case "landing_page":
      return "landing_page";
    case "homepage":
      return "homepage";
    case "campaign_page":
      return "campaign_page";
    case "product_page":
      return "product_page";
    case "docs_page":
      return "docs_page";
    case "portfolio":
      return "portfolio";
    case "resume_page":
      return "resume_page";
    default:
      return undefined;
  }
}

function mergeTypesettingCommandRecentDefaults(params: {
  parsedCommand: ParsedTypesettingWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedTypesettingWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    targetPlatform: resolvePreferredRecentCommandText(
      params.parsedCommand.targetPlatform,
      slotValues.target_platform,
    ),
  };
}

function mergePresentationCommandRecentDefaults(params: {
  parsedCommand: ParsedPresentationWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedPresentationWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    deckType:
      params.parsedCommand.deckType ??
      normalizeRecentPresentationDeckType(slotValues.deck_type),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    audience: resolvePreferredRecentCommandText(
      params.parsedCommand.audience,
      slotValues.audience,
    ),
    slideCount:
      params.parsedCommand.slideCount ??
      normalizeRecentPositiveInteger(slotValues.slide_count),
  };
}

function mergeFormCommandRecentDefaults(params: {
  parsedCommand: ParsedFormWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedFormWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    formType:
      params.parsedCommand.formType ??
      normalizeRecentFormType(slotValues.form_type),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    audience: resolvePreferredRecentCommandText(
      params.parsedCommand.audience,
      slotValues.audience,
    ),
    fieldCount:
      params.parsedCommand.fieldCount ??
      normalizeRecentPositiveInteger(slotValues.field_count),
  };
}

function mergeWebpageCommandRecentDefaults(params: {
  parsedCommand: ParsedWebpageWorkbenchCommand;
  slotValues?: ServiceSkillSlotValues;
}): ParsedWebpageWorkbenchCommand {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  return {
    ...params.parsedCommand,
    pageType:
      params.parsedCommand.pageType ??
      normalizeRecentWebpageType(slotValues.page_type),
    style: resolvePreferredRecentCommandText(
      params.parsedCommand.style,
      slotValues.style,
    ),
    techStack: resolvePreferredRecentCommandText(
      params.parsedCommand.techStack,
      slotValues.tech_stack,
    ),
  };
}

type ParsedPublishLikeWorkbenchCommand =
  | ParsedChannelPreviewWorkbenchCommand
  | ParsedUploadWorkbenchCommand
  | ParsedPublishWorkbenchCommand;

function normalizeRecentPublishPlatform(params: {
  platformType?: string | null;
  platformLabel?: string | null;
}): {
  platformType?: ParsedPublishWorkbenchCommand["platformType"];
  platformLabel?: string;
} {
  const normalizedLabel = normalizeOptionalText(params.platformLabel);
  if (normalizedLabel) {
    const normalizedPlatform = normalizeContentPostPlatform(normalizedLabel);
    if (normalizedPlatform.platformType || normalizedPlatform.platformLabel) {
      return normalizedPlatform;
    }
  }

  switch (params.platformType?.trim().toLowerCase()) {
    case "wechat_official_account":
      return {
        platformType: "wechat_official_account",
        platformLabel: "微信公众号后台",
      };
    case "xiaohongshu":
      return {
        platformType: "xiaohongshu",
        platformLabel: "小红书",
      };
    case "zhihu":
      return {
        platformType: "zhihu",
        platformLabel: "知乎",
      };
    case "douyin":
      return {
        platformType: "douyin",
        platformLabel: "抖音",
      };
    case "bilibili":
      return {
        platformType: "bilibili",
        platformLabel: "B站",
      };
    case "instagram":
      return {
        platformType: "instagram",
        platformLabel: "Instagram",
      };
    case "youtube":
      return {
        platformType: "youtube",
        platformLabel: "YouTube",
      };
    case "tiktok":
      return {
        platformType: "tiktok",
        platformLabel: "TikTok",
      };
    default:
      return {};
  }
}

function mergePublishLikeCommandRecentDefaults<
  T extends ParsedPublishLikeWorkbenchCommand,
>(params: {
  parsedCommand: T;
  slotValues?: ServiceSkillSlotValues;
}): T {
  const slotValues = params.slotValues;
  if (!slotValues) {
    return params.parsedCommand;
  }

  const currentPlatform = normalizeRecentPublishPlatform({
    platformType: params.parsedCommand.platformType,
    platformLabel: params.parsedCommand.platformLabel,
  });
  const fallbackPlatform = normalizeRecentPublishPlatform({
    platformType: slotValues.platform_type,
    platformLabel: slotValues.platform_label,
  });

  return {
    ...params.parsedCommand,
    platformType: currentPlatform.platformType ?? fallbackPlatform.platformType,
    platformLabel:
      currentPlatform.platformLabel ?? fallbackPlatform.platformLabel,
  };
}

function buildPublishDispatchBody(params: {
  prompt?: string | null;
  platformLabel?: string | null;
}): string {
  return [
    normalizeOptionalText(params.platformLabel)
      ? `平台:${normalizeOptionalText(params.platformLabel)}`
      : undefined,
    normalizeOptionalText(params.prompt),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildChannelPreviewDispatchBody(params: {
  prompt?: string | null;
  platformLabel?: string | null;
}): string {
  const normalizedPlatformLabel = normalizeOptionalText(params.platformLabel);
  const normalizedPrompt = normalizeOptionalText(params.prompt);
  const previewInstruction = normalizedPlatformLabel
    ? `请基于当前内容生成一份适用于${normalizedPlatformLabel}的渠道预览稿，突出标题、首屏摘要、排版层级和封面建议`
    : "请基于当前内容生成一份渠道预览稿，突出标题、首屏摘要、排版层级和封面建议";

  return [
    normalizedPlatformLabel ? `平台:${normalizedPlatformLabel}` : undefined,
    previewInstruction,
    normalizedPrompt,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildUploadDispatchBody(params: {
  prompt?: string | null;
  platformLabel?: string | null;
}): string {
  const normalizedPlatformLabel = normalizeOptionalText(params.platformLabel);
  const normalizedPrompt = normalizeOptionalText(params.prompt);
  const uploadInstruction = normalizedPlatformLabel
    ? `请基于当前内容整理一份适用于${normalizedPlatformLabel}直接上传的上传稿与素材清单，优先输出标题、正文、封面说明、标签建议和上传前检查`
    : "请基于当前内容整理一份可直接上传的上传稿与素材清单，优先输出标题、正文、封面说明、标签建议和上传前检查";

  return [
    normalizedPlatformLabel ? `平台:${normalizedPlatformLabel}` : undefined,
    uploadInstruction,
    normalizedPrompt,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function resolveMentionCommandUsage(params: {
  commandKey: string;
  serviceSkills: ServiceSkillHomeItem[];
  requestMetadata?: Record<string, unknown>;
  mentionCommandSkillIdMap: Map<string, string>;
}): CompletedMentionUsage | null {
  const normalizedCommandKey = params.commandKey.trim();
  if (!normalizedCommandKey) {
    return null;
  }

  const boundSkillId = params.mentionCommandSkillIdMap.get(normalizedCommandKey);
  if (!boundSkillId) {
    return null;
  }

  const matchedSkill = params.serviceSkills.find((skill) => {
    const normalizedSkillId = skill.id.trim();
    const normalizedSkillKey = skill.skillKey?.trim();
    return (
      normalizedSkillId === boundSkillId || normalizedSkillKey === boundSkillId
    );
  });

  if (!matchedSkill) {
    return null;
  }

  const slotValues = resolveMentionCommandUsageSlotValues(
    params.requestMetadata,
  );
  const launchUserInput = resolveMentionCommandUsageLaunchUserInput(
    params.requestMetadata,
  );

  return {
    skillId: matchedSkill.id,
    runnerType: matchedSkill.runnerType,
    ...(slotValues ? { slotValues } : {}),
    ...(launchUserInput ? { launchUserInput } : {}),
  };
}

type SessionBoundRequestContextKey =
  | "image_task"
  | "cover_task"
  | "video_task"
  | "broadcast_task"
  | "resource_search_task"
  | "transcription_task"
  | "url_parse_task"
  | "typesetting_task";

type PendingCommandSessionBinding =
  | {
      kind: "request_context";
      requestContext: Record<string, unknown>;
      requestContextKey: SessionBoundRequestContextKey;
    }
  | {
      kind: "scoped_request_context";
      scopedRequestContext: Record<string, unknown>;
    };

function attachSessionIdToRequestContext(
  requestContext: Record<string, unknown>,
  requestContextKey: SessionBoundRequestContextKey,
  sessionId: string | null | undefined,
): void {
  const scopedRequestContext = asRecord(requestContext[requestContextKey]);
  if (!scopedRequestContext) {
    return;
  }

  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    scopedRequestContext.session_id = normalizedSessionId;
    return;
  }

  delete scopedRequestContext.session_id;
}

function attachSessionIdToScopedRequestContext(
  scopedRequestContext: Record<string, unknown>,
  sessionId: string | null | undefined,
): void {
  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    scopedRequestContext.session_id = normalizedSessionId;
    return;
  }

  delete scopedRequestContext.session_id;
}

const SESSION_BOUND_MODEL_SKILL_LAUNCHES: ReadonlyArray<{
  launchKey:
    | "image_skill_launch"
    | "cover_skill_launch"
    | "video_skill_launch"
    | "broadcast_skill_launch"
    | "resource_search_skill_launch"
    | "transcription_skill_launch"
    | "url_parse_skill_launch"
    | "typesetting_skill_launch";
  requestContextKey: SessionBoundRequestContextKey;
}> = [
  {
    launchKey: "image_skill_launch",
    requestContextKey: "image_task",
  },
  {
    launchKey: "cover_skill_launch",
    requestContextKey: "cover_task",
  },
  {
    launchKey: "video_skill_launch",
    requestContextKey: "video_task",
  },
  {
    launchKey: "broadcast_skill_launch",
    requestContextKey: "broadcast_task",
  },
  {
    launchKey: "resource_search_skill_launch",
    requestContextKey: "resource_search_task",
  },
  {
    launchKey: "transcription_skill_launch",
    requestContextKey: "transcription_task",
  },
  {
    launchKey: "url_parse_skill_launch",
    requestContextKey: "url_parse_task",
  },
  {
    launchKey: "typesetting_skill_launch",
    requestContextKey: "typesetting_task",
  },
];

function extractBoundSessionRequestContext(
  requestMetadata: Record<string, unknown> | undefined,
): PendingCommandSessionBinding | null {
  const harness = asRecord(requestMetadata?.harness);
  if (!harness) {
    return null;
  }

  for (const launch of SESSION_BOUND_MODEL_SKILL_LAUNCHES) {
    const launchMetadata = asRecord(harness[launch.launchKey]);
    if (!launchMetadata) {
      continue;
    }

    const scopedRequestContext =
      asRecord(launchMetadata[launch.requestContextKey]) ||
      asRecord(
        asRecord(launchMetadata.request_context)?.[launch.requestContextKey],
      );
    if (!scopedRequestContext) {
      continue;
    }

    return {
      kind: "scoped_request_context",
      scopedRequestContext,
    };
  }

  return null;
}

function buildModelSkillLaunchRequestMetadata(params: {
  existingMetadata: Record<string, unknown> | undefined;
  requestContext: Record<string, unknown>;
  launchKey:
    | "image_skill_launch"
    | "cover_skill_launch"
    | "video_skill_launch"
    | "broadcast_skill_launch"
    | "resource_search_skill_launch"
    | "research_skill_launch"
    | "report_skill_launch"
    | "deep_search_skill_launch"
    | "site_search_skill_launch"
    | "pdf_read_skill_launch"
    | "summary_skill_launch"
    | "translation_skill_launch"
    | "analysis_skill_launch"
    | "transcription_skill_launch"
    | "url_parse_skill_launch"
    | "typesetting_skill_launch"
    | "presentation_skill_launch"
    | "form_skill_launch"
    | "webpage_skill_launch";
  requestContextKey:
    | "image_task"
    | "cover_task"
    | "video_task"
    | "broadcast_task"
    | "resource_search_task"
    | "research_request"
    | "report_request"
    | "deep_search_request"
    | "site_search_request"
    | "pdf_read_request"
    | "summary_request"
    | "translation_request"
    | "analysis_request"
    | "transcription_task"
    | "url_parse_task"
    | "typesetting_task"
    | "presentation_request"
    | "form_request"
    | "webpage_request";
  defaultKind:
    | "image_task"
    | "cover_task"
    | "video_task"
    | "broadcast_task"
    | "resource_search_task"
    | "research_request"
    | "report_request"
    | "deep_search_request"
    | "site_search_request"
    | "pdf_read_request"
    | "summary_request"
    | "translation_request"
    | "analysis_request"
    | "transcription_task"
    | "url_parse_task"
    | "typesetting_task"
    | "presentation_request"
    | "form_request"
    | "webpage_request";
  skillName:
    | "image_generate"
    | "cover_generate"
    | "video_generate"
    | "broadcast_generate"
    | "modal_resource_search"
    | "research"
    | "report_generate"
    | "site_search"
    | "pdf_read"
    | "summary"
    | "translation"
    | "analysis"
    | "transcription_generate"
    | "url_parse"
    | "typesetting"
    | "presentation_generate"
    | "form_generate"
    | "webpage_generate";
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

function buildBroadcastSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "broadcast_skill_launch",
    requestContextKey: "broadcast_task",
    defaultKind: "broadcast_task",
    skillName: "broadcast_generate",
  });
}

function buildResourceSearchSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "resource_search_skill_launch",
    requestContextKey: "resource_search_task",
    defaultKind: "resource_search_task",
    skillName: "modal_resource_search",
  });
}

function buildResearchSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "research_skill_launch",
    requestContextKey: "research_request",
    defaultKind: "research_request",
    skillName: "research",
  });
}

function buildDeepSearchSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "deep_search_skill_launch",
    requestContextKey: "deep_search_request",
    defaultKind: "deep_search_request",
    skillName: "research",
  });
}

function buildReportSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "report_skill_launch",
    requestContextKey: "report_request",
    defaultKind: "report_request",
    skillName: "report_generate",
  });
}

function buildSiteSearchSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "site_search_skill_launch",
    requestContextKey: "site_search_request",
    defaultKind: "site_search_request",
    skillName: "site_search",
  });
}

function buildPdfReadSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "pdf_read_skill_launch",
    requestContextKey: "pdf_read_request",
    defaultKind: "pdf_read_request",
    skillName: "pdf_read",
  });
}

function buildSummarySkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "summary_skill_launch",
    requestContextKey: "summary_request",
    defaultKind: "summary_request",
    skillName: "summary",
  });
}

function buildTranslationSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "translation_skill_launch",
    requestContextKey: "translation_request",
    defaultKind: "translation_request",
    skillName: "translation",
  });
}

function buildAnalysisSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "analysis_skill_launch",
    requestContextKey: "analysis_request",
    defaultKind: "analysis_request",
    skillName: "analysis",
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

function buildTypesettingSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "typesetting_skill_launch",
    requestContextKey: "typesetting_task",
    defaultKind: "typesetting_task",
    skillName: "typesetting",
  });
}

function buildPresentationSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "presentation_skill_launch",
    requestContextKey: "presentation_request",
    defaultKind: "presentation_request",
    skillName: "presentation_generate",
  });
}

function buildWebpageSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "webpage_skill_launch",
    requestContextKey: "webpage_request",
    defaultKind: "webpage_request",
    skillName: "webpage_generate",
  });
}

function buildFormSkillLaunchRequestMetadata(
  existingMetadata: Record<string, unknown> | undefined,
  requestContext: Record<string, unknown>,
): Record<string, unknown> {
  return buildModelSkillLaunchRequestMetadata({
    existingMetadata,
    requestContext,
    launchKey: "form_skill_launch",
    requestContextKey: "form_request",
    defaultKind: "form_request",
    skillName: "form_generate",
  });
}

function buildVideoSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedVideoWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
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
      session_id: params.sessionId || undefined,
      entry_source: "at_video_command",
    },
  };
}

function buildCoverSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedCoverWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
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
      session_id: params.sessionId || undefined,
      entry_source: "at_cover_command",
    },
  };
}

function buildBroadcastSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedBroadcastWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
}): Record<string, unknown> {
  const content =
    params.parsedCommand.content?.trim() ||
    params.parsedCommand.prompt.trim() ||
    params.parsedCommand.body.trim();

  return {
    kind: "broadcast_task",
    broadcast_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
      content: content || undefined,
      title: params.parsedCommand.title,
      audience: params.parsedCommand.audience,
      tone: params.parsedCommand.tone,
      duration_hint_minutes: params.parsedCommand.durationHintMinutes,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      session_id: params.sessionId || undefined,
      entry_source: "at_broadcast_command",
    },
  };
}

function buildResourceSearchSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedResourceSearchWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
  promptOverride?: string;
}): Record<string, unknown> {
  const prompt =
    normalizeOptionalText(params.promptOverride) ||
    normalizeOptionalText(params.parsedCommand.prompt);

  return {
    kind: "resource_search_task",
    resource_search_task: {
      raw_text: params.rawText,
      prompt,
      title: params.parsedCommand.title,
      resource_type: params.parsedCommand.resourceType,
      query: params.parsedCommand.query,
      usage: params.parsedCommand.usage,
      count: params.parsedCommand.count,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      session_id: params.sessionId || undefined,
      entry_source: "at_resource_search_command",
    },
  };
}

function buildTranscriptionSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedTranscriptionWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
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
      session_id: params.sessionId || undefined,
      entry_source: "at_transcription_command",
    },
  };
}

function buildResearchSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedSearchWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt = params.parsedCommand.prompt.trim();
  const query = params.parsedCommand.query?.trim() || prompt;
  if (!query) {
    toast.error("请补充明确的搜索主题后再提交");
    return null;
  }

  return {
    kind: "research_request",
    research_request: {
      raw_text: params.rawText,
      prompt: prompt || query,
      query,
      site: params.parsedCommand.site,
      time_range: params.parsedCommand.timeRange,
      depth: params.parsedCommand.depth,
      focus: params.parsedCommand.focus,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_search_command",
    },
  };
}

function buildDeepSearchSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedDeepSearchWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt = params.parsedCommand.prompt.trim();
  const query = params.parsedCommand.query?.trim() || prompt;
  if (!query) {
    toast.error("请补充明确的深搜主题后再提交");
    return null;
  }

  return {
    kind: "deep_search_request",
    deep_search_request: {
      raw_text: params.rawText,
      prompt: prompt || query,
      query,
      site: params.parsedCommand.site,
      time_range: params.parsedCommand.timeRange,
      depth: "deep",
      focus: params.parsedCommand.focus,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_deep_search_command",
    },
  };
}

function buildReportSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedReportWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt = params.parsedCommand.prompt.trim();
  const query = params.parsedCommand.query?.trim() || prompt;
  if (!query) {
    toast.error("请补充明确的研报主题后再提交");
    return null;
  }

  return {
    kind: "report_request",
    report_request: {
      raw_text: params.rawText,
      prompt: prompt || query,
      query,
      site: params.parsedCommand.site,
      time_range: params.parsedCommand.timeRange,
      depth: "deep",
      focus: params.parsedCommand.focus,
      output_format: params.parsedCommand.outputFormat || "研究报告",
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_report_command",
    },
  };
}

function buildCompetitorSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedCompetitorWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt = params.parsedCommand.prompt.trim();
  const query = params.parsedCommand.query?.trim() || prompt;
  if (!query) {
    toast.error("请补充明确的竞品分析主题后再提交");
    return null;
  }

  return {
    kind: "report_request",
    report_request: {
      raw_text: params.rawText,
      prompt: prompt || query,
      query,
      site: params.parsedCommand.site,
      time_range: params.parsedCommand.timeRange,
      depth: "deep",
      focus: params.parsedCommand.focus,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_competitor_command",
    },
  };
}

function buildSiteSearchSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedSiteSearchWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const prompt = params.parsedCommand.prompt.trim();
  const query = params.parsedCommand.query?.trim() || prompt;
  if (!query && !params.parsedCommand.site?.trim()) {
    toast.error("请先补充站点和检索主题后再提交");
    return null;
  }

  return {
    kind: "site_search_request",
    site_search_request: {
      raw_text: params.rawText,
      prompt: prompt || query || params.parsedCommand.site,
      site: params.parsedCommand.site,
      query: query || undefined,
      limit: params.parsedCommand.limit,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_site_search_command",
    },
  };
}

function buildPdfReadSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedPdfWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> | null {
  const sourcePath = params.parsedCommand.sourcePath?.trim();
  const sourceUrl = params.parsedCommand.sourceUrl?.trim();
  if (!sourcePath && !sourceUrl) {
    toast.error("请先提供 PDF 文件路径，或先把 PDF 导入工作区后再试");
    return null;
  }

  const prompt =
    params.parsedCommand.prompt.trim() ||
    params.parsedCommand.focus?.trim() ||
    "请阅读这份 PDF 并提炼关键信息";

  return {
    kind: "pdf_read_request",
    pdf_read_request: {
      raw_text: params.rawText,
      prompt,
      source_path: sourcePath || undefined,
      source_url: sourceUrl || undefined,
      focus: params.parsedCommand.focus,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_pdf_read_command",
    },
  };
}

function buildSummarySkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedSummaryWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() || "请总结当前对话中的关键信息";

  return {
    kind: "summary_request",
    summary_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.content,
      focus: params.parsedCommand.focus,
      length: params.parsedCommand.length,
      style: params.parsedCommand.style,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_summary_command",
    },
  };
}

function buildTranslationSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedTranslationWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() || "请翻译当前对话中最相关的内容";

  return {
    kind: "translation_request",
    translation_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.content,
      source_language: params.parsedCommand.sourceLanguage,
      target_language: params.parsedCommand.targetLanguage,
      style: params.parsedCommand.style,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_translation_command",
    },
  };
}

function buildAnalysisSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: Pick<
    ParsedAnalysisWorkbenchCommand,
    "prompt" | "content" | "focus" | "style" | "outputFormat"
  >;
  projectId?: string | null;
  contentId?: string | null;
  entrySource?: string;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() || "请分析当前对话中最相关的内容";

  return {
    kind: "analysis_request",
    analysis_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.content,
      focus: params.parsedCommand.focus,
      style: params.parsedCommand.style,
      output_format: params.parsedCommand.outputFormat,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: params.entrySource || "at_analysis_command",
    },
  };
}

function buildUrlParseSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedUrlParseWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
}): Record<string, unknown> {
  const isScrapeEntry = isUrlParseScrapeTrigger(params.parsedCommand.trigger);
  const isReadEntry = isUrlParseReadTrigger(params.parsedCommand.trigger);

  return {
    kind: "url_parse_task",
    url_parse_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
      url: params.parsedCommand.url,
      extract_goal: params.parsedCommand.extractGoal,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      session_id: params.sessionId || undefined,
      entry_source: isScrapeEntry
        ? "at_web_scrape_command"
        : isReadEntry
          ? "at_webpage_read_command"
          : "at_url_parse_command",
    },
  };
}

function buildTypesettingSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedTypesettingWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
  sessionId?: string | null;
}): Record<string, unknown> {
  return {
    kind: "typesetting_task",
    typesetting_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
      content: params.parsedCommand.body || undefined,
      target_platform: params.parsedCommand.targetPlatform,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      session_id: params.sessionId || undefined,
      entry_source: "at_typesetting_command",
    },
  };
}

function buildWebpageSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedWebpageWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() || "请生成一个可直接预览的网页";

  return {
    kind: "webpage_request",
    webpage_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.body || undefined,
      page_type: params.parsedCommand.pageType,
      style: params.parsedCommand.style,
      tech_stack: params.parsedCommand.techStack,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_webpage_command",
    },
  };
}

function buildPresentationSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedPresentationWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() || "请生成一份可直接讲述的演示文稿草稿";

  return {
    kind: "presentation_request",
    presentation_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.body || undefined,
      deck_type: params.parsedCommand.deckType,
      style: params.parsedCommand.style,
      audience: params.parsedCommand.audience,
      slide_count: params.parsedCommand.slideCount,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_presentation_command",
    },
  };
}

function buildFormSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedFormWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
}): Record<string, unknown> {
  const prompt =
    params.parsedCommand.prompt.trim() ||
    "请生成一个可直接在聊天区渲染的 A2UI 表单";

  return {
    kind: "form_request",
    form_request: {
      raw_text: params.rawText,
      prompt,
      content: params.parsedCommand.body || undefined,
      form_type: params.parsedCommand.formType,
      style: params.parsedCommand.style,
      audience: params.parsedCommand.audience,
      field_count: params.parsedCommand.fieldCount,
      project_id: params.projectId || undefined,
      content_id: params.contentId || undefined,
      entry_source: "at_form_command",
    },
  };
}

function matchesVoiceCommandSkill(skill: ServiceSkillHomeItem): boolean {
  const searchable = [
    skill.id,
    skill.skillKey,
    skill.title,
    skill.summary,
    ...(skill.aliases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /配音|dubbing|voice/.test(searchable);
}

function resolveVoiceCommandServiceSkill(
  serviceSkills: ServiceSkillHomeItem[],
): ServiceSkillHomeItem | null {
  return (
    serviceSkills.find(
      (skill) =>
        matchesVoiceCommandSkill(skill) &&
        skill.defaultExecutorBinding !== "browser_assist" &&
        skill.slotSchema.some((slot) =>
          ["reference_video", "target_language", "voice_style"].includes(
            slot.key,
          ),
        ),
    ) ||
    serviceSkills.find((skill) => matchesVoiceCommandSkill(skill)) ||
    null
  );
}

function normalizeLocalServiceSkillExecutionKind(
  value?: string | null,
): "agent_turn" | "native_skill" | "automation_job" {
  if (value === "native_skill") {
    return "native_skill";
  }

  if (value === "automation_job") {
    return "automation_job";
  }

  return "agent_turn";
}

interface VoiceSkillLaunchRequest {
  dispatchText: string;
  requestContext: Record<string, unknown>;
}

async function resolveVoiceSkillLaunchRequestContext(params: {
  rawText: string;
  parsedCommand: ParsedVoiceWorkbenchCommand;
  serviceSkills: ServiceSkillHomeItem[];
  projectId?: string | null;
  contentId?: string | null;
  voicePreference?: {
    preferredProviderId?: string;
    preferredModelId?: string;
    allowFallback?: boolean;
  } | null;
}): Promise<VoiceSkillLaunchRequest | null> {
  const skill = resolveVoiceCommandServiceSkill(params.serviceSkills);
  if (!skill) {
    toast.error("当前未安装可用的配音技能，请先同步技能目录后再试");
    return null;
  }

  const prompt =
    params.parsedCommand.prompt.trim() || params.parsedCommand.body.trim();
  if (!prompt) {
    toast.error("请补充清晰的配音要求后再提交");
    return null;
  }

  let resolvedProjectId = normalizeOptionalText(params.projectId);
  if (!resolvedProjectId && skill.readinessRequirements?.requiresProject) {
    try {
      const defaultProject = await getOrCreateDefaultProject();
      resolvedProjectId = normalizeOptionalText(defaultProject?.id);
    } catch {
      resolvedProjectId = undefined;
    }
  }

  if (!resolvedProjectId && skill.readinessRequirements?.requiresProject) {
    toast.error("请先选择项目后再开始配音");
    return null;
  }

  const slotValues: ServiceSkillSlotValues = {
    ...(params.parsedCommand.targetLanguage
      ? {
          target_language: params.parsedCommand.targetLanguage,
        }
      : {}),
    ...(params.parsedCommand.voiceStyle
      ? {
          voice_style: params.parsedCommand.voiceStyle,
        }
      : {}),
  };
  const resolvedVoicePreference = normalizeMediaGenerationPreference(
    params.voicePreference,
  );

  return {
    dispatchText: composeServiceSkillPrompt({
      skill,
      slotValues,
      userInput: prompt,
    }),
    requestContext: {
      kind: "local_service_skill",
      service_scene_run: {
        raw_text: params.rawText,
        user_input: prompt,
        entry_id: "command:voice_runtime",
        scene_key: "voice_runtime",
        command_prefix: params.parsedCommand.trigger,
        linked_skill_id: skill.id,
        skill_id: skill.id,
        skill_key: skill.skillKey || undefined,
        skill_title: skill.title,
        skill_summary: skill.summary,
        runner_type: skill.runnerType,
        execution_kind: normalizeLocalServiceSkillExecutionKind(
          skill.defaultExecutorBinding,
        ),
        execution_location: "client_default",
        project_id: resolvedProjectId,
        content_id: normalizeOptionalText(params.contentId),
        entry_source: "at_voice_command",
        target_language: params.parsedCommand.targetLanguage,
        voice_style: params.parsedCommand.voiceStyle,
        slot_values: Object.keys(slotValues).length > 0 ? slotValues : undefined,
        preferred_provider_id: resolvedVoicePreference.preferredProviderId,
        preferred_model_id: resolvedVoicePreference.preferredModelId,
        allow_fallback: resolvedVoicePreference.allowFallback ?? true,
      },
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
  sessionId?: string | null;
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
  serviceModels?: ServiceModelsConfig;
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
  prepareRuntimeTeamBeforeSend: UseRuntimeTeamFormationResult["prepareRuntimeTeamBeforeSend"];
  ensureBrowserAssistCanvas: (
    target: string,
    options?: EnsureBrowserAssistCanvasOptions,
  ) => Promise<boolean>;
  handleAutoLaunchMatchedSiteSkill: (
    match: AutoMatchedSiteSkill<ServiceSkillHomeItem>,
  ) => Promise<void>;
  openRuntimeSceneGate?: (
    request: RuntimeSceneGateRequest,
  ) => Promise<void> | void;
  ensureSessionForCommandMetadata?: () => Promise<string | null>;
  resolveImageWorkbenchSkillRequest: (input: {
    rawText: string;
    parsedCommand: ParsedImageWorkbenchCommand;
    images: MessageImage[];
    sessionIdOverride?: string | null;
    entrySource?: string;
  }) => ImageWorkbenchSkillRequest | null;
}

interface WorkspaceResolvedSendState {
  sourceText: string;
  dispatchText: string;
  sendBoundary: GeneralWorkbenchSendBoundaryState;
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
  completedMentionCommandUsage: CompletedMentionCommandUsage | null;
  completedMentionUsage: CompletedMentionUsage | null;
  completedSlashUsage?: CompletedInputCapabilitySlashUsage | null;
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
  sessionId,
  executionStrategy,
  accessMode: _accessMode,
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
  serviceModels,
  messages,
  bootstrapDispatchPreview,
  sendMessage,
  resolveSendBoundary,
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  prepareRuntimeTeamBeforeSend: _prepareRuntimeTeamBeforeSend,
  ensureBrowserAssistCanvas,
  handleAutoLaunchMatchedSiteSkill,
  openRuntimeSceneGate,
  ensureSessionForCommandMetadata,
  resolveImageWorkbenchSkillRequest,
}: UseWorkspaceSendActionsParams) {
  const messagesCount = messages.length;
  const [runtimeTeamDispatchPreview, setRuntimeTeamDispatchPreview] = useState<
    RuntimeTeamDispatchPreviewSnapshot | null
  >(null);
  const [submissionPreview, setSubmissionPreview] =
    useState<SubmissionPreviewSnapshot | null>(null);
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const isPreparingSendRef = useRef(false);
  const { mediaDefaults } = useGlobalMediaGenerationDefaults();
  const { mentionCommandSkillIdMap, mentionCommandPrefixKeyMap } =
    useRuntimeMentionCommandCatalog();
  const clearRuntimeTeamDispatchPreview = useCallback(() => {
    setRuntimeTeamDispatchPreview(null);
  }, []);
  const teamDispatchPreviewState = useMemo(
    () => resolveRuntimeTeamDispatchPreviewState(runtimeTeamDispatchPreview),
    [runtimeTeamDispatchPreview],
  );
  const runtimeTeamDispatchPreviewMessages = useMemo(
    () =>
      runtimeTeamDispatchPreview
        ? buildRuntimeTeamDispatchPreviewMessages(runtimeTeamDispatchPreview)
        : [],
    [runtimeTeamDispatchPreview],
  );
  const resourcePromptRewritePreference =
    serviceModels?.resource_prompt_rewrite;
  const submissionPreviewMessages = useMemo(
    () =>
      messagesCount === 0 && submissionPreview
        ? buildSubmissionPreviewMessages(submissionPreview)
        : [],
    [messagesCount, submissionPreview],
  );
  const bootstrapDispatchPreviewMessages = useMemo(
    () =>
      bootstrapDispatchPreview
        ? buildInitialDispatchPreviewMessages(bootstrapDispatchPreview)
        : [],
    [bootstrapDispatchPreview],
  );
  const displayMessages = useMemo(() => {
    if (runtimeTeamDispatchPreviewMessages.length > 0) {
      return [...messages, ...runtimeTeamDispatchPreviewMessages];
    }

    if (submissionPreviewMessages.length > 0) {
      return submissionPreviewMessages;
    }

    if (messagesCount === 0 && bootstrapDispatchPreviewMessages.length > 0) {
      return bootstrapDispatchPreviewMessages;
    }

    return messages;
  }, [
    bootstrapDispatchPreviewMessages,
    messages,
    messagesCount,
    runtimeTeamDispatchPreviewMessages,
    submissionPreviewMessages,
  ]);

  useEffect(() => {
    clearRuntimeTeamDispatchPreview();
  }, [clearRuntimeTeamDispatchPreview, sessionId]);

  useEffect(() => {
    if (!runtimeTeamDispatchPreview) {
      return;
    }

    if (messagesCount > runtimeTeamDispatchPreview.baseMessageCount) {
      clearRuntimeTeamDispatchPreview();
    }
  }, [
    clearRuntimeTeamDispatchPreview,
    messagesCount,
    runtimeTeamDispatchPreview,
  ]);

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
      const inputCapabilityDispatch = resolveInputCapabilityDispatchContext({
        sourceText: textOverride ?? input,
        capabilityRoute: sendOptions?.capabilityRoute,
        displayContent: sendOptions?.displayContent,
      });
      let sourceText = inputCapabilityDispatch.sourceText;
      if (!sourceText.trim() && (!images || images.length === 0)) {
        return { kind: "done", result: false };
      }
      let effectiveImages = images || [];
      const sendBoundary = resolveSendBoundary({
        sourceText,
        sendOptions,
      });
      sourceText = sendBoundary.sourceText;
      sourceText =
        resolveBareMentionCommandPrefillSourceText(
          sourceText,
          mentionCommandPrefixKeyMap,
        ) || sourceText;
      const mentionUsageMap = getMentionEntryUsageMap();
      type MergeableMentionParsedCommand = Parameters<
        typeof resolveMentionCommandMergedPrefillReplayText
      >[0]["parsedCommand"];
      const maybeApplyMentionCommandRecentDefaults = <
        T extends MergeableMentionParsedCommand & {
          rawText: string;
        },
      >(params: {
        rawText: string;
        commandKey: string;
        parsedCommand: T;
        reparse: (rawText: string) => T | null;
      }): { rawText: string; parsedCommand: T } => {
        const recentRecord = mentionUsageMap.get(
          getMentionEntryUsageRecordKey("builtin_command", params.commandKey),
        );
        if (!recentRecord?.slotValues) {
          return {
            rawText: params.rawText,
            parsedCommand: params.parsedCommand,
          };
        }

        const nextReplayText = resolveMentionCommandMergedPrefillReplayText({
          commandKey: params.commandKey,
          parsedCommand: params.parsedCommand,
          slotValues: recentRecord.slotValues,
        });
        const currentReplayText = resolveMentionCommandReplayText(
          params.parsedCommand,
          params.commandKey,
        );
        if (!nextReplayText || nextReplayText === currentReplayText) {
          return {
            rawText: params.rawText,
            parsedCommand: params.parsedCommand,
          };
        }

        const commandPrefix = params.rawText.match(/^\s*(@[^\s]+)(?:\s+|$)/u)?.[1];
        if (!commandPrefix) {
          return {
            rawText: params.rawText,
            parsedCommand: params.parsedCommand,
          };
        }

        const nextRawText = `${commandPrefix} ${nextReplayText}`;
        const reparsed = params.reparse(nextRawText);
        if (!reparsed) {
          return {
            rawText: params.rawText,
            parsedCommand: params.parsedCommand,
          };
        }

        return {
          rawText: nextRawText,
          parsedCommand: reparsed,
        };
      };
      let dispatchText = sourceText;

      let effectiveToolPreferences =
        sendOptions?.toolPreferencesOverride ?? chatToolPreferences;
      const { browserRequirementMatch } = sendBoundary;
      const mergedLaunchRequestMetadata = {
        ...(workspaceRequestMetadataBase || {}),
        ...(sendOptions?.requestMetadata || {}),
      };
      let hasBoundSkillLaunch =
        hasServiceSkillLaunchRequestMetadata(mergedLaunchRequestMetadata) ||
        hasModelSkillLaunchRequestMetadata(mergedLaunchRequestMetadata);
      const requestedWebSearch =
        webSearch ?? effectiveToolPreferences.webSearch;
      let effectiveWebSearch =
        browserRequirementMatch &&
        browserRequirementMatch.requirement !== "optional"
          ? false
          : requestedWebSearch;
      const effectiveThinking = thinking ?? effectiveToolPreferences.thinking;

      const preparedActiveContextPrompt =
        contextWorkspace.enabled && !contextWorkspace.activeContextPrompt.trim()
          ? contextWorkspace.prepareActiveContextPrompt().then(
              (value) => ({
                ok: true as const,
                value,
              }),
              (error) => ({
                ok: false as const,
                error,
              }),
            )
          : null;

      let commandSessionId: string | null | undefined;
      let commandSessionPromise: Promise<string | null> | null = null;
      let pendingCommandSessionBinding: PendingCommandSessionBinding | null =
        extractBoundSessionRequestContext(mergedLaunchRequestMetadata);
      let completedMentionCommandUsage:
        | WorkspaceSendPlan["completedMentionCommandUsage"]
        | null = null;
      let completedMentionUsage: WorkspaceSendPlan["completedMentionUsage"] =
        null;
      let completedSlashUsage: WorkspaceSendPlan["completedSlashUsage"] =
        inputCapabilityDispatch.completedSlashUsage;
      sendOptions = inputCapabilityDispatch.capabilityRoute
        ? {
            ...(sendOptions || {}),
            capabilityRoute: inputCapabilityDispatch.capabilityRoute,
          }
        : sendOptions;
      let submissionPreviewKey: string | null = null;
      const ensureSubmissionPreview = (previewImages = effectiveImages) => {
        if (submissionPreviewKey) {
          return submissionPreviewKey;
        }

        submissionPreviewKey = crypto.randomUUID();
        setSubmissionPreview(
          createSubmissionPreviewSnapshot({
            key: submissionPreviewKey,
            prompt: sourceText,
            images: previewImages,
            executionStrategy: sendExecutionStrategy ?? executionStrategy,
            webSearch: effectiveWebSearch,
            thinking: effectiveThinking,
          }),
        );
        return submissionPreviewKey;
      };
      const clearSubmissionPreview = () => {
        if (!submissionPreviewKey) {
          return;
        }
        const previewKey = submissionPreviewKey;
        setSubmissionPreview((current) =>
          current?.key === previewKey ? null : current,
        );
      };
      const primeCommandSessionId = () => {
        if (commandSessionId !== undefined) {
          return Promise.resolve(commandSessionId);
        }
        if (!commandSessionPromise) {
          commandSessionPromise = (async () => {
            const resolvedSessionId = await ensureSessionForCommandMetadata?.();
            commandSessionId = resolvedSessionId?.trim() || null;
            return commandSessionId;
          })();
        }
        return commandSessionPromise;
      };
      const ensureCommandSessionId = async () => {
        return primeCommandSessionId();
      };
      const markCompletedMentionCommand = (
        commandKey: string,
        replayText?: string,
      ) => {
        completedMentionCommandUsage = {
          entryId: commandKey,
          replayText: normalizeMentionCommandReplayText(replayText),
          slotValues: resolveMentionCommandUsageSlotValues(
            sendOptions?.requestMetadata,
          ),
        };
        completedMentionUsage = resolveMentionCommandUsage({
          commandKey,
          serviceSkills,
          requestMetadata: sendOptions?.requestMetadata,
          mentionCommandSkillIdMap,
        });
      };

      const parsedImageWorkbenchCommand =
        !sendOptions?.purpose && !hasBoundSkillLaunch && sourceText.trim()
          ? parseImageWorkbenchCommand(sourceText)
          : null;
      if (parsedImageWorkbenchCommand) {
        const skillRequest = resolveImageWorkbenchSkillRequest({
          rawText: sourceText,
          parsedCommand: parsedImageWorkbenchCommand,
          images: effectiveImages,
          sessionIdOverride: commandSessionId,
        });
        if (!skillRequest) {
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }
        effectiveImages =
          skillRequest.images.length > 0
            ? skillRequest.images
            : effectiveImages;
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext: skillRequest.requestContext,
          requestContextKey: "image_task",
        };
        ensureSubmissionPreview(effectiveImages);
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildImageSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            skillRequest.requestContext,
          ),
        };
        const mentionCommandKey = resolveImageMentionCommandKey(
          parsedImageWorkbenchCommand.trigger,
        );
        if (mentionCommandKey) {
          markCompletedMentionCommand(
            mentionCommandKey,
            resolveMentionCommandReplayText(
              parsedImageWorkbenchCommand,
              mentionCommandKey,
            ),
          );
        }
        hasBoundSkillLaunch = true;
      }

      const parsedPosterWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand
          ? parsePosterWorkbenchCommand(sourceText)
          : null;
      if (parsedPosterWorkbenchCommand) {
        const skillRequest = resolveImageWorkbenchSkillRequest({
          rawText: sourceText,
          parsedCommand: {
            rawText: parsedPosterWorkbenchCommand.rawText,
            trigger: "@配图",
            body: parsedPosterWorkbenchCommand.body,
            mode: "generate",
            prompt: parsedPosterWorkbenchCommand.prompt,
            count: 1,
            size: parsedPosterWorkbenchCommand.size,
            aspectRatio: parsedPosterWorkbenchCommand.aspectRatio,
            targetRef: undefined,
          },
          images: effectiveImages,
          sessionIdOverride: commandSessionId,
          entrySource: "at_poster_command",
        });
        if (!skillRequest) {
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }
        effectiveImages =
          skillRequest.images.length > 0
            ? skillRequest.images
            : effectiveImages;
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext: skillRequest.requestContext,
          requestContextKey: "image_task",
        };
        ensureSubmissionPreview(effectiveImages);
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildImageSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            skillRequest.requestContext,
          ),
        };
        markCompletedMentionCommand(
          "poster_generate",
          resolveMentionCommandReplayText(
            parsedPosterWorkbenchCommand,
            "poster_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedCoverWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedPosterWorkbenchCommand
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
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "cover_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildCoverSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "cover_generate",
          resolveMentionCommandReplayText(
            parsedCoverWorkbenchCommand,
            "cover_generate",
          ),
        );
        hasBoundSkillLaunch = true;
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
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "video_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildVideoSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "video_generate",
          resolveMentionCommandReplayText(
            parsedVideoWorkbenchCommand,
            "video_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedBroadcastWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand
          ? parseBroadcastWorkbenchCommand(sourceText)
          : null;
      if (parsedBroadcastWorkbenchCommand) {
        const requestContext = buildBroadcastSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedBroadcastWorkbenchCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "broadcast_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildBroadcastSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "broadcast_generate",
          resolveMentionCommandReplayText(
            parsedBroadcastWorkbenchCommand,
            "broadcast_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedResourceSearchWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand
          ? parseResourceSearchWorkbenchCommand(sourceText)
          : null;
      if (parsedResourceSearchWorkbenchCommand) {
        const resourceRewritePreference = resolveServiceModelExecutionPreference(
          resourcePromptRewritePreference,
        );
        const requestContext = buildResourceSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedResourceSearchWorkbenchCommand,
          projectId,
          contentId,
          promptOverride: mergeServiceModelPrompt(
            resourceRewritePreference.customPrompt,
            parsedResourceSearchWorkbenchCommand.prompt,
          ),
        });
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "resource_search_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildResourceSearchSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "modal_resource_search",
          resolveMentionCommandReplayText(
            parsedResourceSearchWorkbenchCommand,
            "modal_resource_search",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedTranscriptionWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand
          ? parseTranscriptionWorkbenchCommand(sourceText)
          : null;
      if (parsedTranscriptionWorkbenchCommand) {
        const requestContext = buildTranscriptionSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedTranscriptionWorkbenchCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "transcription_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildTranscriptionSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "transcription_generate",
          resolveMentionCommandReplayText(
            parsedTranscriptionWorkbenchCommand,
            "transcription_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedSearchWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand
          ? parseSearchWorkbenchCommand(sourceText)
          : null;
      if (parsedSearchWorkbenchCommand) {
        const prefilledSearchCommand = maybeApplyMentionCommandRecentDefaults({
          rawText: sourceText,
          commandKey: "research",
          parsedCommand: parsedSearchWorkbenchCommand,
          reparse: parseSearchWorkbenchCommand,
        });
        sourceText = prefilledSearchCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildResearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledSearchCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildResearchSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "research",
          resolveMentionCommandReplayText(
            prefilledSearchCommand.parsedCommand,
            "research",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedReportWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand
          ? parseReportWorkbenchCommand(sourceText)
          : null;
      if (parsedReportWorkbenchCommand) {
        const prefilledReportCommand = maybeApplyMentionCommandRecentDefaults({
          rawText: sourceText,
          commandKey: "research_report",
          parsedCommand: parsedReportWorkbenchCommand,
          reparse: parseReportWorkbenchCommand,
        });
        sourceText = prefilledReportCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildReportSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledReportCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildReportSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "research_report",
          resolveMentionCommandReplayText(
            prefilledReportCommand.parsedCommand,
            "research_report",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedCompetitorWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand
          ? parseCompetitorWorkbenchCommand(sourceText)
          : null;
      if (parsedCompetitorWorkbenchCommand) {
        const prefilledCompetitorCommand =
          maybeApplyMentionCommandRecentDefaults({
            rawText: sourceText,
            commandKey: "competitor_research",
            parsedCommand: parsedCompetitorWorkbenchCommand,
            reparse: parseCompetitorWorkbenchCommand,
          });
        sourceText = prefilledCompetitorCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildCompetitorSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledCompetitorCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildReportSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "competitor_research",
          resolveMentionCommandReplayText(
            prefilledCompetitorCommand.parsedCommand,
            "competitor_research",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedDeepSearchWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedCompetitorWorkbenchCommand
          ? parseDeepSearchWorkbenchCommand(sourceText)
          : null;
      if (parsedDeepSearchWorkbenchCommand) {
        const prefilledDeepSearchCommand =
          maybeApplyMentionCommandRecentDefaults({
            rawText: sourceText,
            commandKey: "deep_search",
            parsedCommand: parsedDeepSearchWorkbenchCommand,
            reparse: parseDeepSearchWorkbenchCommand,
          });
        sourceText = prefilledDeepSearchCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildDeepSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledDeepSearchCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildDeepSearchSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "deep_search",
          resolveMentionCommandReplayText(
            prefilledDeepSearchCommand.parsedCommand,
            "deep_search",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedSiteSearchWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand
          ? parseSiteSearchWorkbenchCommand(sourceText)
          : null;
      if (parsedSiteSearchWorkbenchCommand) {
        const prefilledSiteSearchCommand =
          maybeApplyMentionCommandRecentDefaults({
            rawText: sourceText,
            commandKey: "site_search",
            parsedCommand: parsedSiteSearchWorkbenchCommand,
            reparse: parseSiteSearchWorkbenchCommand,
          });
        sourceText = prefilledSiteSearchCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildSiteSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledSiteSearchCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        effectiveToolPreferences = {
          ...effectiveToolPreferences,
          webSearch: false,
        };
        effectiveWebSearch = false;
        sendOptions = {
          ...(sendOptions || {}),
          toolPreferencesOverride: effectiveToolPreferences,
          requestMetadata: buildSiteSearchSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "site_search",
          resolveMentionCommandReplayText(
            prefilledSiteSearchCommand.parsedCommand,
            "site_search",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedPdfWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand
          ? parsePdfWorkbenchCommand(sourceText)
          : null;
      if (parsedPdfWorkbenchCommand) {
        const prefilledPdfCommand = maybeApplyMentionCommandRecentDefaults({
          rawText: sourceText,
          commandKey: "read_pdf",
          parsedCommand: parsedPdfWorkbenchCommand,
          reparse: parsePdfWorkbenchCommand,
        });
        sourceText = prefilledPdfCommand.rawText;
        dispatchText = sourceText;
        const requestContext = buildPdfReadSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: prefilledPdfCommand.parsedCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildPdfReadSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "read_pdf",
          resolveMentionCommandReplayText(
            prefilledPdfCommand.parsedCommand,
            "read_pdf",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedSummaryWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand
          ? parseSummaryWorkbenchCommand(sourceText)
          : null;
      if (parsedSummaryWorkbenchCommand) {
        const mergedSummaryCommand = mergeSummaryCommandRecentDefaults({
          parsedCommand: parsedSummaryWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "summary"),
          )?.slotValues,
        });
        const requestContext = buildSummarySkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedSummaryCommand,
          projectId,
          contentId,
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildSummarySkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "summary",
          resolveMentionCommandReplayText(
            mergedSummaryCommand,
            "summary",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedTranslationWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand
          ? parseTranslationWorkbenchCommand(sourceText)
          : null;
      if (parsedTranslationWorkbenchCommand) {
        const mergedTranslationCommand = mergeTranslationCommandRecentDefaults({
          parsedCommand: parsedTranslationWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "translation"),
          )?.slotValues,
        });
        const requestContext = buildTranslationSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedTranslationCommand,
          projectId,
          contentId,
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildTranslationSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "translation",
          resolveMentionCommandReplayText(
            mergedTranslationCommand,
            "translation",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedComplianceWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand
          ? parseComplianceWorkbenchCommand(sourceText)
          : null;
      if (parsedComplianceWorkbenchCommand) {
        const mergedComplianceCommand = mergeComplianceCommandRecentDefaults({
          parsedCommand: parsedComplianceWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey(
              "builtin_command",
              "publish_compliance",
            ),
          )?.slotValues,
        });
        const requestContext = buildAnalysisSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedComplianceCommand,
          projectId,
          contentId,
          entrySource: "at_publish_compliance_command",
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildAnalysisSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "publish_compliance",
          resolveMentionCommandReplayText(
            mergedComplianceCommand,
            "publish_compliance",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedAnalysisWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedComplianceWorkbenchCommand
          ? parseAnalysisWorkbenchCommand(sourceText)
          : null;
      if (parsedAnalysisWorkbenchCommand) {
        const mergedAnalysisCommand = mergeAnalysisCommandRecentDefaults({
          parsedCommand: parsedAnalysisWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "analysis"),
          )?.slotValues,
        });
        const requestContext = buildAnalysisSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedAnalysisCommand,
          projectId,
          contentId,
        });
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildAnalysisSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "analysis",
          resolveMentionCommandReplayText(
            mergedAnalysisCommand,
            "analysis",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedUrlParseWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedComplianceWorkbenchCommand
          ? parseUrlParseWorkbenchCommand(sourceText)
          : null;
      if (parsedUrlParseWorkbenchCommand) {
        const requestContext = buildUrlParseSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedUrlParseWorkbenchCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "url_parse_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildUrlParseSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          isUrlParseScrapeTrigger(parsedUrlParseWorkbenchCommand.trigger)
            ? "web_scrape"
            : isUrlParseReadTrigger(parsedUrlParseWorkbenchCommand.trigger)
              ? "webpage_read"
            : "url_parse",
          resolveMentionCommandReplayText(
            parsedUrlParseWorkbenchCommand,
            isUrlParseScrapeTrigger(parsedUrlParseWorkbenchCommand.trigger)
              ? "web_scrape"
              : isUrlParseReadTrigger(parsedUrlParseWorkbenchCommand.trigger)
                ? "webpage_read"
                : "url_parse",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedTypesettingWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand
          ? parseTypesettingWorkbenchCommand(sourceText)
          : null;
      if (parsedTypesettingWorkbenchCommand) {
        const mergedTypesettingCommand = mergeTypesettingCommandRecentDefaults({
          parsedCommand: parsedTypesettingWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "typesetting"),
          )?.slotValues,
        });
        const requestContext = buildTypesettingSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedTypesettingCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
          kind: "request_context",
          requestContext,
          requestContextKey: "typesetting_task",
        };
        ensureSubmissionPreview();
        void primeCommandSessionId().catch(() => undefined);
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildTypesettingSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "typesetting",
          resolveMentionCommandReplayText(
            mergedTypesettingCommand,
            "typesetting",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedPresentationWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand
          ? parsePresentationWorkbenchCommand(sourceText)
          : null;
      if (parsedPresentationWorkbenchCommand) {
        const mergedPresentationCommand =
          mergePresentationCommandRecentDefaults({
            parsedCommand: parsedPresentationWorkbenchCommand,
            slotValues: mentionUsageMap.get(
              getMentionEntryUsageRecordKey(
                "builtin_command",
                "presentation_generate",
              ),
            )?.slotValues,
          });
        const requestContext = buildPresentationSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedPresentationCommand,
          projectId,
          contentId,
        });
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildPresentationSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "presentation_generate",
          resolveMentionCommandReplayText(
            mergedPresentationCommand,
            "presentation_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedFormWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand
          ? parseFormWorkbenchCommand(sourceText)
          : null;
      if (parsedFormWorkbenchCommand) {
        const mergedFormCommand = mergeFormCommandRecentDefaults({
          parsedCommand: parsedFormWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "form_generate"),
          )?.slotValues,
        });
        const requestContext = buildFormSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedFormCommand,
          projectId,
          contentId,
        });
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildFormSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "form_generate",
          resolveMentionCommandReplayText(
            mergedFormCommand,
            "form_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedWebpageWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand &&
        !parsedFormWorkbenchCommand
          ? parseWebpageWorkbenchCommand(sourceText)
          : null;
      if (parsedWebpageWorkbenchCommand) {
        const mergedWebpageCommand = mergeWebpageCommandRecentDefaults({
          parsedCommand: parsedWebpageWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey(
              "builtin_command",
              "webpage_generate",
            ),
          )?.slotValues,
        });
        const requestContext = buildWebpageSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: mergedWebpageCommand,
          projectId,
          contentId,
        });
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildWebpageSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
        markCompletedMentionCommand(
          "webpage_generate",
          resolveMentionCommandReplayText(
            mergedWebpageCommand,
            "webpage_generate",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedCodeWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand &&
        !parsedFormWorkbenchCommand &&
        !parsedWebpageWorkbenchCommand
          ? parseCodeWorkbenchCommand(sourceText)
          : null;
      if (parsedCodeWorkbenchCommand) {
        const existingHarnessMetadata =
          asRecord(sendOptions?.requestMetadata?.harness) || {};
        effectiveToolPreferences = {
          ...effectiveToolPreferences,
          task: true,
          subagent: true,
        };
        sendExecutionStrategy = "code_orchestrated";
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          toolPreferencesOverride: effectiveToolPreferences,
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: {
              ...existingHarnessMetadata,
              preferred_team_preset_id: "code-triage-team",
              code_command: {
                kind: parsedCodeWorkbenchCommand.taskType || "implementation",
                prompt:
                  parsedCodeWorkbenchCommand.prompt ||
                  parsedCodeWorkbenchCommand.body,
                content: parsedCodeWorkbenchCommand.body,
                entry_source: "at_code_command",
              },
            },
          },
        };
        markCompletedMentionCommand(
          "code_runtime",
          resolveMentionCommandReplayText(
            parsedCodeWorkbenchCommand,
            "code_runtime",
          ),
        );
      }

      const parsedChannelPreviewWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand &&
        !parsedFormWorkbenchCommand &&
        !parsedWebpageWorkbenchCommand &&
        !parsedCodeWorkbenchCommand
          ? parseChannelPreviewWorkbenchCommand(sourceText)
          : null;
      if (parsedChannelPreviewWorkbenchCommand) {
        const mergedChannelPreviewCommand =
          mergePublishLikeCommandRecentDefaults({
            parsedCommand: parsedChannelPreviewWorkbenchCommand,
            slotValues: mentionUsageMap.get(
              getMentionEntryUsageRecordKey(
                "builtin_command",
                "channel_preview_runtime",
              ),
            )?.slotValues,
          });
        const existingHarnessMetadata =
          asRecord(sendOptions?.requestMetadata?.harness) || {};
        const dispatchBody = buildChannelPreviewDispatchBody({
          prompt:
            mergedChannelPreviewCommand.prompt ||
            mergedChannelPreviewCommand.body,
          platformLabel: mergedChannelPreviewCommand.platformLabel,
        });
        dispatchText = `/${CONTENT_POST_SKILL_KEY}${
          dispatchBody ? ` ${dispatchBody}` : ""
        }`;
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: {
              ...existingHarnessMetadata,
              publish_command: {
                prompt:
                  mergedChannelPreviewCommand.prompt ||
                  mergedChannelPreviewCommand.body,
                content: mergedChannelPreviewCommand.body,
                platform_type:
                  mergedChannelPreviewCommand.platformType || undefined,
                platform_label:
                  mergedChannelPreviewCommand.platformLabel || undefined,
                intent: "preview",
                entry_source: "at_channel_preview_command",
              },
            },
          },
        };
        markCompletedMentionCommand(
          "channel_preview_runtime",
          resolveMentionCommandReplayText(
            mergedChannelPreviewCommand,
            "channel_preview_runtime",
          ),
        );
      }

      const parsedUploadWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand &&
        !parsedFormWorkbenchCommand &&
        !parsedWebpageWorkbenchCommand &&
        !parsedCodeWorkbenchCommand &&
        !parsedChannelPreviewWorkbenchCommand
          ? parseUploadWorkbenchCommand(sourceText)
          : null;
      if (parsedUploadWorkbenchCommand) {
        const mergedUploadCommand = mergePublishLikeCommandRecentDefaults({
          parsedCommand: parsedUploadWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "upload_runtime"),
          )?.slotValues,
        });
        const existingHarnessMetadata =
          asRecord(sendOptions?.requestMetadata?.harness) || {};
        const dispatchBody = buildUploadDispatchBody({
          prompt: mergedUploadCommand.prompt || mergedUploadCommand.body,
          platformLabel: mergedUploadCommand.platformLabel,
        });
        const uploadBrowserRequirementMatch = detectBrowserTaskRequirement(
          dispatchBody || mergedUploadCommand.body || mergedUploadCommand.prompt,
        );
        dispatchText = `/${CONTENT_POST_SKILL_KEY}${
          dispatchBody ? ` ${dispatchBody}` : ""
        }`;
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: {
              ...existingHarnessMetadata,
              ...(uploadBrowserRequirementMatch
                ? {
                    browser_requirement:
                      uploadBrowserRequirementMatch.requirement,
                    browser_requirement_reason:
                      uploadBrowserRequirementMatch.reason,
                    browser_launch_url:
                      uploadBrowserRequirementMatch.launchUrl,
                  }
                : {}),
              publish_command: {
                prompt:
                  mergedUploadCommand.prompt || mergedUploadCommand.body,
                content: mergedUploadCommand.body,
                platform_type: mergedUploadCommand.platformType || undefined,
                platform_label: mergedUploadCommand.platformLabel || undefined,
                intent: "upload",
                entry_source: "at_upload_command",
              },
            },
          },
        };
        markCompletedMentionCommand(
          "upload_runtime",
          resolveMentionCommandReplayText(
            mergedUploadCommand,
            "upload_runtime",
          ),
        );
      }

      const parsedPublishWorkbenchCommand =
        !sendOptions?.purpose &&
        sourceText.trim() &&
        !parsedImageWorkbenchCommand &&
        !parsedCoverWorkbenchCommand &&
        !parsedVideoWorkbenchCommand &&
        !parsedBroadcastWorkbenchCommand &&
        !parsedResourceSearchWorkbenchCommand &&
        !parsedTranscriptionWorkbenchCommand &&
        !parsedSearchWorkbenchCommand &&
        !parsedReportWorkbenchCommand &&
        !parsedDeepSearchWorkbenchCommand &&
        !parsedSiteSearchWorkbenchCommand &&
        !parsedPdfWorkbenchCommand &&
        !parsedSummaryWorkbenchCommand &&
        !parsedTranslationWorkbenchCommand &&
        !parsedUrlParseWorkbenchCommand &&
        !parsedTypesettingWorkbenchCommand &&
        !parsedPresentationWorkbenchCommand &&
        !parsedFormWorkbenchCommand &&
        !parsedWebpageWorkbenchCommand &&
        !parsedCodeWorkbenchCommand &&
        !parsedChannelPreviewWorkbenchCommand &&
        !parsedUploadWorkbenchCommand
          ? parsePublishWorkbenchCommand(sourceText)
          : null;
      if (parsedPublishWorkbenchCommand) {
        const mergedPublishCommand = mergePublishLikeCommandRecentDefaults({
          parsedCommand: parsedPublishWorkbenchCommand,
          slotValues: mentionUsageMap.get(
            getMentionEntryUsageRecordKey("builtin_command", "publish_runtime"),
          )?.slotValues,
        });
        const existingHarnessMetadata =
          asRecord(sendOptions?.requestMetadata?.harness) || {};
        const nextBody = buildPublishDispatchBody({
          prompt: mergedPublishCommand.prompt || mergedPublishCommand.body,
          platformLabel: mergedPublishCommand.platformLabel,
        });
        const publishBrowserRequirementMatch = detectBrowserTaskRequirement(
          nextBody || mergedPublishCommand.body || mergedPublishCommand.prompt,
        );
        dispatchText = `/${CONTENT_POST_SKILL_KEY}${nextBody ? ` ${nextBody}` : ""}`;
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: {
              ...existingHarnessMetadata,
              ...(publishBrowserRequirementMatch
                ? {
                    browser_requirement:
                      publishBrowserRequirementMatch.requirement,
                    browser_requirement_reason:
                      publishBrowserRequirementMatch.reason,
                    browser_launch_url:
                      publishBrowserRequirementMatch.launchUrl,
                  }
                : {}),
              publish_command: {
                prompt:
                  mergedPublishCommand.prompt || mergedPublishCommand.body,
                content: mergedPublishCommand.body,
                platform_type: mergedPublishCommand.platformType || undefined,
                platform_label: mergedPublishCommand.platformLabel || undefined,
                entry_source: "at_publish_command",
              },
            },
          },
        };
        markCompletedMentionCommand(
          "publish_runtime",
          resolveMentionCommandReplayText(
            mergedPublishCommand,
            "publish_runtime",
          ),
        );
      }

      const parsedVoiceWorkbenchCommand =
        !sendOptions?.purpose && sourceText.trim()
          ? parseVoiceWorkbenchCommand(sourceText)
          : null;
      if (parsedVoiceWorkbenchCommand) {
        const voiceSkillLaunch = await resolveVoiceSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedVoiceWorkbenchCommand,
          serviceSkills,
          projectId,
          contentId,
          voicePreference: mediaDefaults.voice,
        });
        if (!voiceSkillLaunch) {
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }

        ensureSubmissionPreview();
        dispatchText = voiceSkillLaunch.dispatchText;
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildServiceSceneLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            voiceSkillLaunch.requestContext,
          ),
        };
        markCompletedMentionCommand(
          "voice_runtime",
          resolveMentionCommandReplayText(
            parsedVoiceWorkbenchCommand,
            "voice_runtime",
          ),
        );
        hasBoundSkillLaunch = true;
      }

      const parsedBrowserWorkbenchCommand =
        !sendOptions?.purpose && sourceText.trim()
          ? parseBrowserWorkbenchCommand(sourceText)
          : null;
      if (parsedBrowserWorkbenchCommand) {
        const existingHarnessMetadata =
          asRecord(sendOptions?.requestMetadata?.harness) || {};
        effectiveToolPreferences = {
          ...effectiveToolPreferences,
          webSearch: false,
        };
        effectiveWebSearch = false;
        ensureSubmissionPreview();
        sendOptions = {
          ...(sendOptions || {}),
          toolPreferencesOverride: effectiveToolPreferences,
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: {
              ...existingHarnessMetadata,
              browser_requirement:
                parsedBrowserWorkbenchCommand.browserRequirement,
              browser_requirement_reason:
                parsedBrowserWorkbenchCommand.browserRequirementReason,
              browser_launch_url: parsedBrowserWorkbenchCommand.launchUrl,
              browser_user_step_required:
                parsedBrowserWorkbenchCommand.browserRequirement ===
                "required_with_user_step",
            },
          },
        };
        markCompletedMentionCommand(
          "browser_runtime",
          resolveMentionCommandReplayText(
            parsedBrowserWorkbenchCommand,
            "browser_runtime",
          ),
        );
      }

      if (
        !sendOptions?.purpose &&
        !sendOptions?.skipSceneCommandRouting &&
        sourceText.trim().startsWith("/")
      ) {
        ensureSubmissionPreview();
        let sceneLaunchRequest = null;
        try {
          sceneLaunchRequest = await resolveRuntimeSceneLaunchRequest({
            rawText: sourceText,
            serviceSkills,
            projectId,
            contentId,
          });
        } catch (error) {
          if (error instanceof RuntimeSceneLaunchValidationError) {
            if (error.gateRequest && openRuntimeSceneGate) {
              await openRuntimeSceneGate(error.gateRequest);
              clearSubmissionPreview();
              return { kind: "done", result: false };
            }
            toast.error(error.message);
            clearSubmissionPreview();
            return { kind: "done", result: false };
          }
          throw error;
        }
        if (sceneLaunchRequest) {
          if (sceneLaunchRequest.dispatchText) {
            dispatchText = sceneLaunchRequest.dispatchText;
          }
          sendOptions = {
            ...(sendOptions || {}),
            requestMetadata: buildServiceSceneLaunchRequestMetadata(
              sendOptions?.requestMetadata,
              sceneLaunchRequest.requestContext,
            ),
          };
          hasBoundSkillLaunch = true;
          completedSlashUsage = {
            kind: "scene",
            entryId: sceneLaunchRequest.sceneEntry.sceneKey,
            replayText:
              completedSlashUsage?.replayText ??
              parseRuntimeSceneCommand(sourceText)?.userInput,
          };
        }
      }

      const trimmedSourceText = sourceText.trim();
      if (
        activeTheme === "general" &&
        !sendOptions?.purpose &&
        !hasBoundSkillLaunch &&
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
          clearSubmissionPreview();
          await handleAutoLaunchMatchedSiteSkill(matchedSiteSkill);
          return { kind: "done", result: true };
        }
      }

      const mergedRequestMetadataAfterLaunch = {
        ...(workspaceRequestMetadataBase || {}),
        ...(sendOptions?.requestMetadata || {}),
      };
      if (
        !projectId &&
        !hasServiceSkillLaunchRequestMetadata(mergedRequestMetadataAfterLaunch)
      ) {
        sendOptions?.observer?.onError?.("请先选择项目后再开始对话");
        toast.error("请先选择项目后再开始对话");
        clearSubmissionPreview();
        return { kind: "done", result: false };
      }

      const shouldPrimeSessionForInitialConversationSend =
        !sendOptions?.purpose &&
        !hasBoundSkillLaunch &&
        messagesCount === 0 &&
        Boolean(ensureSessionForCommandMetadata);

      if (!hasBoundSkillLaunch) {
        primeBrowserAssistBeforeSend({
          activeTheme,
          sourceText,
          browserRequirementMatch,
          ensureBrowserAssistCanvas,
        });
      }

      let text: string;
      try {
        const resolvedSubmissionPreviewKey = ensureSubmissionPreview();
        if (shouldPrimeSessionForInitialConversationSend) {
          void primeCommandSessionId().catch(() => undefined);
        }
        text = await buildWorkspaceSendText({
          sourceText: dispatchText,
          contextWorkspace,
          mentionedCharacters,
          sendOptions,
          preparedActiveContextPrompt,
        });
        if (pendingCommandSessionBinding) {
          const resolvedSessionId = await ensureCommandSessionId();
          if (pendingCommandSessionBinding.kind === "request_context") {
            attachSessionIdToRequestContext(
              pendingCommandSessionBinding.requestContext,
              pendingCommandSessionBinding.requestContextKey,
              resolvedSessionId,
            );
          } else {
            attachSessionIdToScopedRequestContext(
              pendingCommandSessionBinding.scopedRequestContext,
              resolvedSessionId,
            );
          }
        }
        submissionPreviewKey = resolvedSubmissionPreviewKey;
      } catch (error) {
        clearSubmissionPreview();
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
          completedMentionCommandUsage,
          completedMentionUsage,
          completedSlashUsage,
        },
      };
    },
    [
      activeTheme,
      chatToolPreferences,
      contentId,
      contextWorkspace,
      ensureSessionForCommandMetadata,
      ensureBrowserAssistCanvas,
      executionStrategy,
      handleAutoLaunchMatchedSiteSkill,
      resolveImageWorkbenchSkillRequest,
      input,
      mediaDefaults.voice,
      messagesCount,
      mentionedCharacters,
      openRuntimeSceneGate,
      projectId,
      resolveSendBoundary,
      resourcePromptRewritePreference,
      serviceSkills,
      mentionCommandPrefixKeyMap,
      mentionCommandSkillIdMap,
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
        completedMentionCommandUsage,
        completedMentionUsage,
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
        const serviceModelSendOverrides = resolveServiceModelSendOverrides({
          requestMetadata: nextRequestMetadata,
          purpose: sendOptions?.purpose,
          serviceModels,
        });
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          displayContent:
            dispatchText !== sourceText
              ? sendOptions?.displayContent ?? sourceText
              : sendOptions?.displayContent,
          requestMetadata: nextRequestMetadata,
          providerOverride:
            sendOptions?.providerOverride ??
            serviceModelSendOverrides.providerOverride,
          modelOverride:
            sendOptions?.modelOverride ??
            serviceModelSendOverrides.modelOverride,
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

        if (completedMentionCommandUsage) {
          recordMentionEntryUsage({
            kind: "builtin_command",
            entryId: completedMentionCommandUsage.entryId,
            replayText: completedMentionCommandUsage.replayText,
            slotValues: completedMentionCommandUsage.slotValues,
          });
        }

        if (completedMentionUsage) {
          recordServiceSkillUsage(completedMentionUsage);
        }

        if (plan.completedSlashUsage) {
          recordSlashEntryUsage(plan.completedSlashUsage);
        }

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
      preferredTeamPresetId,
      rollbackAfterSendFailure,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      serviceModels,
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
      if (isPreparingSendRef.current) {
        return false;
      }

      isPreparingSendRef.current = true;
      setIsPreparingSend(true);

      try {
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
      } finally {
        isPreparingSendRef.current = false;
        setIsPreparingSend(false);
      }
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
    isPreparingSend,
    displayMessages,
    teamDispatchPreviewState,
  };
}
