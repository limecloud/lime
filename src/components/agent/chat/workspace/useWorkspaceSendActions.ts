import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AutoContinueRequestPayload } from "@/lib/api/agentRuntime";
import { parseAnalysisWorkbenchCommand } from "../utils/analysisWorkbenchCommand";
import { parseBroadcastWorkbenchCommand } from "../utils/broadcastWorkbenchCommand";
import { parseCoverWorkbenchCommand } from "../utils/coverWorkbenchCommand";
import { parseDeepSearchWorkbenchCommand } from "../utils/deepSearchWorkbenchCommand";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import { parsePdfWorkbenchCommand } from "../utils/pdfWorkbenchCommand";
import { parseReportWorkbenchCommand } from "../utils/reportWorkbenchCommand";
import { parseResourceSearchWorkbenchCommand } from "../utils/resourceSearchWorkbenchCommand";
import { parseSearchWorkbenchCommand } from "../utils/searchWorkbenchCommand";
import { parseSiteSearchWorkbenchCommand } from "../utils/siteSearchWorkbenchCommand";
import { parseSummaryWorkbenchCommand } from "../utils/summaryWorkbenchCommand";
import { parseTranslationWorkbenchCommand } from "../utils/translationWorkbenchCommand";
import { parseTranscriptionWorkbenchCommand } from "../utils/transcriptionWorkbenchCommand";
import { parseTypesettingWorkbenchCommand } from "../utils/typesettingWorkbenchCommand";
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
import type { GeneralWorkbenchSendBoundaryState } from "../hooks/useGeneralWorkbenchSendBoundary";
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
  hasModelSkillLaunchRequestMetadata,
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
import {
  buildImageSkillLaunchRequestMetadata,
  type ImageWorkbenchSkillRequest,
} from "./imageSkillLaunch";
import {
  buildServiceSceneLaunchRequestMetadata,
  resolveRuntimeSceneLaunchRequest,
} from "./serviceSkillSceneLaunch";

type ExecutionStrategy = "react" | "code_orchestrated" | "auto";
type SetStringState = (value: string) => void;
type ParsedImageWorkbenchCommand = NonNullable<
  ReturnType<typeof parseImageWorkbenchCommand>
>;
type ParsedCoverWorkbenchCommand = NonNullable<
  ReturnType<typeof parseCoverWorkbenchCommand>
>;
type ParsedBroadcastWorkbenchCommand = NonNullable<
  ReturnType<typeof parseBroadcastWorkbenchCommand>
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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
    | "typesetting_skill_launch";
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
    | "typesetting_task";
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
    | "typesetting_task";
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
    | "typesetting";
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
}): Record<string, unknown> {
  return {
    kind: "resource_search_task",
    resource_search_task: {
      raw_text: params.rawText,
      prompt: params.parsedCommand.prompt || undefined,
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
  parsedCommand: ParsedAnalysisWorkbenchCommand;
  projectId?: string | null;
  contentId?: string | null;
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
      entry_source: "at_analysis_command",
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
      entry_source: "at_url_parse_command",
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
  }) => GeneralWorkbenchSendBoundaryState;
  finalizeAfterSendSuccess: (boundary: GeneralWorkbenchSendBoundaryState) => void;
  rollbackAfterSendFailure: (boundary: GeneralWorkbenchSendBoundaryState) => void;
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
  ensureSessionForCommandMetadata?: () => Promise<string | null>;
  resolveImageWorkbenchSkillRequest: (input: {
    rawText: string;
    parsedCommand: ParsedImageWorkbenchCommand;
    images: MessageImage[];
    sessionIdOverride?: string | null;
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
  finalizeAfterSendSuccess,
  rollbackAfterSendFailure,
  prepareRuntimeTeamBeforeSend: _prepareRuntimeTeamBeforeSend,
  setRuntimeTeamDispatchPreview,
  ensureBrowserAssistCanvas,
  handleAutoLaunchMatchedSiteSkill,
  ensureSessionForCommandMetadata,
  resolveImageWorkbenchSkillRequest,
}: UseWorkspaceSendActionsParams) {
  const [submissionPreview, setSubmissionPreview] =
    useState<SubmissionPreviewSnapshot | null>(null);
  const [isPreparingSend, setIsPreparingSend] = useState(false);
  const isPreparingSendRef = useRef(false);

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
      const mergedLaunchRequestMetadata = {
        ...(workspaceRequestMetadataBase || {}),
        ...(sendOptions?.requestMetadata || {}),
      };
      let hasBoundSkillLaunch =
        hasServiceSkillLaunchRequestMetadata(mergedLaunchRequestMetadata) ||
        hasModelSkillLaunchRequestMetadata(mergedLaunchRequestMetadata);
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

      const preparedActiveContextPrompt =
        contextWorkspace.enabled &&
        !contextWorkspace.activeContextPrompt.trim()
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
      let pendingCommandSessionBinding:
        | {
            requestContext: Record<string, unknown>;
            requestContextKey: SessionBoundRequestContextKey;
          }
        | null = null;
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
        hasBoundSkillLaunch = true;
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
          clearSubmissionPreview();
          return { kind: "done", result: false };
        }
        pendingCommandSessionBinding = {
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
        const requestContext = buildResourceSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedResourceSearchWorkbenchCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
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
        const requestContext = buildResearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedSearchWorkbenchCommand,
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
        const requestContext = buildReportSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedReportWorkbenchCommand,
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
        !parsedReportWorkbenchCommand
          ? parseDeepSearchWorkbenchCommand(sourceText)
          : null;
      if (parsedDeepSearchWorkbenchCommand) {
        const requestContext = buildDeepSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedDeepSearchWorkbenchCommand,
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
        const requestContext = buildSiteSearchSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedSiteSearchWorkbenchCommand,
          projectId,
          contentId,
        });
        if (!requestContext) {
          return { kind: "done", result: false };
        }
        sendOptions = {
          ...(sendOptions || {}),
          requestMetadata: buildSiteSearchSkillLaunchRequestMetadata(
            sendOptions?.requestMetadata,
            requestContext,
          ),
        };
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
        const requestContext = buildPdfReadSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedPdfWorkbenchCommand,
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
        const requestContext = buildSummarySkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedSummaryWorkbenchCommand,
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
        const requestContext = buildTranslationSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedTranslationWorkbenchCommand,
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
        !parsedTranslationWorkbenchCommand
          ? parseAnalysisWorkbenchCommand(sourceText)
          : null;
      if (parsedAnalysisWorkbenchCommand) {
        const requestContext = buildAnalysisSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedAnalysisWorkbenchCommand,
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
        !parsedTranslationWorkbenchCommand
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
        const requestContext = buildTypesettingSkillLaunchRequestContext({
          rawText: sourceText,
          parsedCommand: parsedTypesettingWorkbenchCommand,
          projectId,
          contentId,
        });
        pendingCommandSessionBinding = {
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
        hasBoundSkillLaunch = true;
      }

      if (!sendOptions?.purpose && sourceText.trim().startsWith("/")) {
        ensureSubmissionPreview();
        const sceneLaunchRequest = await resolveRuntimeSceneLaunchRequest({
          rawText: sourceText,
          serviceSkills,
          projectId,
          contentId,
        });
        if (sceneLaunchRequest) {
          sendOptions = {
            ...(sendOptions || {}),
            requestMetadata: buildServiceSceneLaunchRequestMetadata(
              sendOptions?.requestMetadata,
              sceneLaunchRequest.requestContext,
            ),
          };
          hasBoundSkillLaunch = true;
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
          attachSessionIdToRequestContext(
            pendingCommandSessionBinding.requestContext,
            pendingCommandSessionBinding.requestContextKey,
            await ensureCommandSessionId(),
          );
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
      messagesCount,
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
    submissionPreview,
  };
}
