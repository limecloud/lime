import { preheatBrowserAssistInBackground } from "../utils/browserAssistPreheat";
import {
  detectBrowserTaskRequirement,
  type BrowserTaskRequirementMatch,
} from "../utils/browserTaskRequirement";
import type {
  GeneralWorkbenchRunState,
  GeneralWorkbenchRunTerminalItem,
  GeneralWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "../utils/harnessRequestMetadata";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type { AssistantDraftState } from "../hooks/agentChatShared";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type {
  AgentRuntimeStatus,
  BrowserTaskRequirement,
  Message,
  MessageImage,
} from "../types";
import type { Character } from "@/lib/api/memory";
import {
  buildTeamMemoryShadowRequestMetadata,
  type TeamMemoryShadowRequestMetadata,
  type TeamMemorySnapshot,
} from "@/lib/teamMemorySync";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type {
  TeamDefinition,
  TeamDefinitionSource,
  TeamRoleDefinition,
} from "../utils/teamDefinitions";
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import {
  buildWaitingAgentRuntimeStatus,
  formatAgentRuntimeStatusSummary,
} from "../utils/agentRuntimeStatus";
import { normalizeTeamWorkspaceDisplayValue } from "../utils/teamWorkspaceDisplay";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

type PreparedRuntimeTeamState = NonNullable<
  Awaited<
    ReturnType<UseRuntimeTeamFormationResult["prepareRuntimeTeamBeforeSend"]>
  >
>;

export interface RuntimeTeamDispatchPreviewSnapshot {
  key: string;
  prompt: string;
  images: MessageImage[];
  baseMessageCount: number;
  status: "forming" | "formed" | "failed";
  formationState?: TeamWorkspaceRuntimeFormationState | null;
  failureMessage?: string | null;
}

export interface InitialDispatchPreviewSnapshot {
  key: string;
  prompt?: string;
  images: MessageImage[];
}

export function buildInitialDispatchKey(
  prompt?: string,
  images?: MessageImage[],
): string | null {
  const normalizedPrompt = (prompt || "").trim();
  const normalizedImages = images || [];

  if (!normalizedPrompt && normalizedImages.length === 0) {
    return null;
  }

  const imageSignature = normalizedImages
    .map(
      (image, index) =>
        `${index}:${image.mediaType}:${image.data.length}:${image.data.slice(0, 16)}`,
    )
    .join("|");

  return `${normalizedPrompt}::${imageSignature}`;
}

export interface SubmissionPreviewSnapshot {
  key: string;
  prompt: string;
  images: MessageImage[];
  createdAt: number;
  runtimeStatus: NonNullable<Message["runtimeStatus"]>;
}

export interface ContextWorkspaceSummary {
  enabled: boolean;
  activeContextPrompt: string;
  prepareActiveContextPrompt: () => Promise<string>;
}

export interface GeneralWorkbenchEntryPromptState {
  kind: "initial_prompt" | "resume";
  signature: string;
  title: string;
  description: string;
  actionLabel: string;
  prompt: string;
}

interface BuildGeneralWorkbenchSendBoundaryStateOptions {
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

export interface GeneralWorkbenchSendBoundaryState {
  sourceText: string;
  browserRequirementMatch: BrowserTaskRequirementMatch | null;
  shouldConsumePendingGeneralWorkbenchInitialPrompt: boolean;
  shouldDismissGeneralWorkbenchEntryPrompt: boolean;
}

type PreparedActiveContextPromptResult =
  | {
      ok: true;
      value: string;
    }
  | {
      ok: false;
      error: unknown;
    };

function resolveGeneralWorkbenchGateLabel(
  gateKey?: GeneralWorkbenchRunTodoItem["gate_key"],
): string | null {
  switch (gateKey) {
    case "topic_select":
      return "选题确认";
    case "write_mode":
      return "写作推进";
    case "publish_confirm":
      return "发布确认";
    case null:
    case undefined:
    default:
      return null;
  }
}

function resolveGeneralWorkbenchPendingRunCandidate(
  state: GeneralWorkbenchRunState | null,
): GeneralWorkbenchRunTodoItem | GeneralWorkbenchRunTerminalItem | null {
  if (!state) {
    return null;
  }

  const activeQueueItem = (state.queue_items || []).find((item) =>
    ["queued", "running", "error", "timeout"].includes(item.status),
  );
  if (activeQueueItem) {
    return activeQueueItem;
  }

  if (
    state.latest_terminal &&
    ["queued", "running", "error", "timeout"].includes(
      state.latest_terminal.status,
    )
  ) {
    return state.latest_terminal;
  }

  return null;
}

export function buildGeneralWorkbenchResumePromptFromRunState(
  state: GeneralWorkbenchRunState | null,
): GeneralWorkbenchEntryPromptState | null {
  const pendingRun = resolveGeneralWorkbenchPendingRunCandidate(state);
  if (!pendingRun) {
    return null;
  }

  const runTitle = pendingRun.title?.trim() || "最近一次创作任务";
  const gateLabel = resolveGeneralWorkbenchGateLabel(pendingRun.gate_key);
  const stageSuffix = gateLabel ? `，当前停留在“${gateLabel}”附近` : "";

  return {
    kind: "resume",
    signature: `run:${pendingRun.run_id}:${pendingRun.status}:${pendingRun.started_at}:${"finished_at" in pendingRun ? pendingRun.finished_at || "" : ""}`,
    title: "发现上次未完成任务",
    description: `最近一次任务“${runTitle}”尚未完成${stageSuffix}。`,
    actionLabel: "继续上次生成",
    prompt: `请基于当前文稿与最近一次未完成的运行继续推进。任务标题：${runTitle}。${gateLabel ? `优先衔接“${gateLabel}”阶段。` : ""}不要从头开始，先概括已有进度，再继续执行。`,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function readMetadataText(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readExistingBrowserRequirement(
  metadata: Record<string, unknown> | undefined,
): BrowserTaskRequirement | undefined {
  const requirement = readMetadataText(metadata, "browser_requirement");
  if (
    requirement === "optional" ||
    requirement === "required" ||
    requirement === "required_with_user_step"
  ) {
    return requirement;
  }
  return undefined;
}

function omitLegacyAccessModeFromHarnessMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return metadata;
  }

  const nextMetadata = { ...metadata };
  delete nextMetadata.access_mode;
  delete nextMetadata.accessMode;
  return nextMetadata;
}

function readExistingTeamSource(
  metadata: Record<string, unknown> | undefined,
): TeamDefinitionSource | undefined {
  const source = readMetadataText(metadata, "selected_team_source");
  if (source === "builtin" || source === "custom" || source === "ephemeral") {
    return source;
  }
  return undefined;
}

function readExistingTeamRoles(
  metadata: Record<string, unknown> | undefined,
): TeamRoleDefinition[] | undefined {
  const rawRoles = metadata?.selected_team_roles;
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    return undefined;
  }

  const roles = rawRoles
    .map((item, index): TeamRoleDefinition | null => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const label = readMetadataText(record, "label");
      const summary = readMetadataText(record, "summary");
      if (!label || !summary) {
        return null;
      }

      const skillIds = Array.isArray(record.skill_ids)
        ? record.skill_ids.filter(
            (skillId): skillId is string =>
              typeof skillId === "string" && skillId.trim().length > 0,
          )
        : [];

      return {
        id: readMetadataText(record, "id") || `base-role-${index + 1}`,
        label,
        summary,
        profileId: readMetadataText(record, "profile_id"),
        roleKey: readMetadataText(record, "role_key"),
        skillIds,
      };
    })
    .filter((role): role is TeamRoleDefinition => role !== null);

  return roles.length > 0 ? roles : undefined;
}

function readExistingTeamMemoryShadow(
  metadata: Record<string, unknown> | undefined,
): TeamMemoryShadowRequestMetadata | undefined {
  const rawShadow =
    asRecord(metadata?.team_memory_shadow) ??
    asRecord(metadata?.teamMemoryShadow);
  const repoScope =
    readMetadataText(rawShadow, "repo_scope") ||
    readMetadataText(rawShadow, "repoScope");
  const rawEntries = Array.isArray(rawShadow?.entries) ? rawShadow.entries : [];
  const entries = rawEntries
    .map((item) => {
      const record = asRecord(item);
      const key = readMetadataText(record, "key");
      const content = readMetadataText(record, "content");
      const updatedAt = record?.updated_at ?? record?.updatedAt;
      if (
        !key ||
        !content ||
        typeof updatedAt !== "number" ||
        !Number.isFinite(updatedAt)
      ) {
        return null;
      }

      return {
        key,
        content,
        updated_at: updatedAt,
      };
    })
    .filter(
      (entry): entry is TeamMemoryShadowRequestMetadata["entries"][number] =>
        entry !== null,
    );

  if (!repoScope || entries.length === 0) {
    return undefined;
  }

  return {
    repo_scope: repoScope,
    entries,
  };
}

export function buildGeneralWorkbenchSendBoundaryState({
  isThemeWorkbench,
  contentId,
  initialDispatchKey,
  consumedInitialPromptKey,
  initialUserImages,
  mappedTheme,
  socialArticleSkillKey,
  sourceText,
  sendOptions,
}: BuildGeneralWorkbenchSendBoundaryStateOptions): GeneralWorkbenchSendBoundaryState {
  const shouldConsumePendingGeneralWorkbenchInitialPrompt =
    isThemeWorkbench &&
    Boolean(contentId) &&
    Boolean(initialDispatchKey) &&
    consumedInitialPromptKey !== initialDispatchKey &&
    (initialUserImages || []).length === 0 &&
    !sendOptions?.purpose;
  const shouldDismissGeneralWorkbenchEntryPrompt =
    isThemeWorkbench && !sendOptions?.purpose;

  const trimmedSourceText = sourceText.trim();
  const shouldWrapWithGeneralWorkbenchSkill =
    isThemeWorkbench &&
    mappedTheme === "general" &&
    !sendOptions?.purpose &&
    trimmedSourceText.length > 0 &&
    !trimmedSourceText.startsWith("/") &&
    !trimmedSourceText.startsWith("@");
  const nextSourceText = shouldWrapWithGeneralWorkbenchSkill
    ? `/${socialArticleSkillKey} ${trimmedSourceText}`
    : sourceText;
  const browserRequirementSourceText = shouldWrapWithGeneralWorkbenchSkill
    ? trimmedSourceText
    : nextSourceText;

  const browserRequirementMatch =
    mappedTheme === "general" && !sendOptions?.purpose
      ? detectBrowserTaskRequirement(browserRequirementSourceText)
      : null;

  return {
    sourceText: nextSourceText,
    browserRequirementMatch,
    shouldConsumePendingGeneralWorkbenchInitialPrompt,
    shouldDismissGeneralWorkbenchEntryPrompt,
  };
}

export interface EnsureBrowserAssistCanvasOptions {
  silent?: boolean;
  navigationMode?: "none" | "explicit-url" | "best-effort";
}

interface BuildWorkspaceSendTextOptions {
  sourceText: string;
  contextWorkspace: ContextWorkspaceSummary;
  mentionedCharacters: Character[];
  sendOptions?: HandleSendOptions;
  preparedActiveContextPrompt?: Promise<PreparedActiveContextPromptResult> | null;
}

interface PrimeBrowserAssistBeforeSendOptions {
  activeTheme: string;
  sourceText: string;
  browserRequirementMatch?: {
    requirement: "optional" | "required" | "required_with_user_step";
    reason: string;
    launchUrl: string;
  } | null;
  ensureBrowserAssistCanvas: (
    target: string,
    options?: EnsureBrowserAssistCanvasOptions,
  ) => Promise<boolean>;
}

interface BuildWorkspaceRequestMetadataOptions {
  workspaceRequestMetadataBase?: Record<string, unknown>;
  sendOptions?: HandleSendOptions;
  effectiveToolPreferences: ChatToolPreferences;
  mappedTheme: ThemeType;
  isThemeWorkbench: boolean;
  currentGateKey: string;
  themeWorkbenchActiveQueueTitle?: string;
  contentId?: string | null;
  browserRequirementMatch?: {
    requirement: "optional" | "required" | "required_with_user_step";
    reason: string;
    launchUrl: string;
  } | null;
  browserAssistProfileKey?: string | null;
  browserAssistPreferredBackend?:
    | "aster_compat"
    | "lime_extension_bridge"
    | "cdp_direct"
    | null;
  browserAssistAutoLaunch?: boolean | null;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string;
  selectedTeamSummary?: string;
  teamMemoryShadowSnapshot?: TeamMemorySnapshot | null;
}

function applyActiveContextPrompt(
  text: string,
  activeContextPrompt: string,
): string {
  if (!activeContextPrompt.trim()) {
    return text;
  }

  const slashCommandMatch = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
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

export async function buildWorkspaceSendText(
  options: BuildWorkspaceSendTextOptions,
): Promise<string> {
  const {
    sourceText,
    contextWorkspace,
    mentionedCharacters,
    preparedActiveContextPrompt: preparedActiveContextPromptPromise,
  } = options;

  let text = sourceText;
  let activeContextPrompt = contextWorkspace.enabled
    ? contextWorkspace.activeContextPrompt.trim()
    : "";
  if (!activeContextPrompt && contextWorkspace.enabled) {
    if (preparedActiveContextPromptPromise) {
      const result = await preparedActiveContextPromptPromise;
      if (!result.ok) {
        throw result.error;
      }
      activeContextPrompt = result.value.trim();
    } else {
      activeContextPrompt = (
        await contextWorkspace.prepareActiveContextPrompt()
      ).trim();
    }
  } else if (activeContextPrompt) {
    // 发送路径优先使用现成上下文快照，后台继续补齐正文缓存以优化后续轮次。
    void contextWorkspace.prepareActiveContextPrompt().catch(() => undefined);
  }

  if (activeContextPrompt) {
    text = applyActiveContextPrompt(text, activeContextPrompt);
  }

  text = applyMentionedCharacterContext(text, mentionedCharacters);
  return text;
}

export function hasServiceSkillLaunchRequestMetadata(
  requestMetadata?: Record<string, unknown>,
): boolean {
  const harness = extractExistingHarnessMetadata(requestMetadata);
  if (!harness) {
    return false;
  }

  const siteLaunch =
    asRecord(harness.service_skill_launch) ??
    asRecord(harness.serviceSkillLaunch);
  if (siteLaunch) {
    const adapterName = siteLaunch.adapter_name ?? siteLaunch.adapterName;
    if (typeof adapterName === "string" && adapterName.trim().length > 0) {
      return true;
    }
  }

  const sceneLaunch =
    asRecord(harness.service_scene_launch) ??
    asRecord(harness.serviceSceneLaunch);
  if (!sceneLaunch) {
    return false;
  }

  const serviceSceneRun =
    asRecord(sceneLaunch.service_scene_run) ??
    asRecord(sceneLaunch.serviceSceneRun) ??
    asRecord(sceneLaunch.request_context) ??
    asRecord(sceneLaunch.requestContext);
  if (!serviceSceneRun) {
    return false;
  }

  const skillId =
    serviceSceneRun.skill_id ??
    serviceSceneRun.skillId ??
    serviceSceneRun.linked_skill_id ??
    serviceSceneRun.linkedSkillId;
  return typeof skillId === "string" && skillId.trim().length > 0;
}

export function hasModelSkillLaunchRequestMetadata(
  requestMetadata?: Record<string, unknown>,
): boolean {
  const harness = extractExistingHarnessMetadata(requestMetadata);
  if (!harness) {
    return false;
  }

  const launchKeys = [
    "image_skill_launch",
    "imageSkillLaunch",
    "cover_skill_launch",
    "coverSkillLaunch",
    "video_skill_launch",
    "videoSkillLaunch",
    "broadcast_skill_launch",
    "broadcastSkillLaunch",
    "resource_search_skill_launch",
    "resourceSearchSkillLaunch",
    "research_skill_launch",
    "researchSkillLaunch",
    "report_skill_launch",
    "reportSkillLaunch",
    "deep_search_skill_launch",
    "deepSearchSkillLaunch",
    "site_search_skill_launch",
    "siteSearchSkillLaunch",
    "pdf_read_skill_launch",
    "pdfReadSkillLaunch",
    "summary_skill_launch",
    "summarySkillLaunch",
    "translation_skill_launch",
    "translationSkillLaunch",
    "analysis_skill_launch",
    "analysisSkillLaunch",
    "transcription_skill_launch",
    "transcriptionSkillLaunch",
    "url_parse_skill_launch",
    "urlParseSkillLaunch",
    "typesetting_skill_launch",
    "typesettingSkillLaunch",
    "presentation_skill_launch",
    "presentationSkillLaunch",
    "form_skill_launch",
    "formSkillLaunch",
    "webpage_skill_launch",
    "webpageSkillLaunch",
    "service_scene_launch",
    "serviceSceneLaunch",
  ] as const;

  return launchKeys.some((key) => {
    const launch = asRecord(harness[key]);
    return Boolean(launch && Object.keys(launch).length > 0);
  });
}

export function primeBrowserAssistBeforeSend(
  options: PrimeBrowserAssistBeforeSendOptions,
): void {
  const {
    activeTheme,
    sourceText,
    browserRequirementMatch,
    ensureBrowserAssistCanvas,
  } = options;

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
    return;
  }

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

export function buildWorkspaceRequestMetadata(
  options: BuildWorkspaceRequestMetadataOptions,
): Record<string, unknown> {
  const {
    workspaceRequestMetadataBase,
    sendOptions,
    effectiveToolPreferences,
    mappedTheme,
    isThemeWorkbench,
    currentGateKey,
    themeWorkbenchActiveQueueTitle,
    contentId,
    browserRequirementMatch,
    browserAssistProfileKey,
    browserAssistPreferredBackend,
    browserAssistAutoLaunch,
    preferredTeamPresetId,
    selectedTeam,
    selectedTeamLabel,
    selectedTeamSummary,
    teamMemoryShadowSnapshot,
  } = options;

  const existingHarnessMetadata = omitLegacyAccessModeFromHarnessMetadata(
    extractExistingHarnessMetadata({
      ...(workspaceRequestMetadataBase || {}),
      ...(sendOptions?.requestMetadata || {}),
    }),
  );
  const resolvedPreferredTeamPresetId =
    preferredTeamPresetId ||
    readMetadataText(existingHarnessMetadata, "preferred_team_preset_id");
  const resolvedSelectedTeamId =
    selectedTeam?.id ||
    readMetadataText(existingHarnessMetadata, "selected_team_id");
  const resolvedSelectedTeamSource =
    selectedTeam?.source || readExistingTeamSource(existingHarnessMetadata);
  const resolvedSelectedTeamLabel =
    selectedTeamLabel ||
    readMetadataText(existingHarnessMetadata, "selected_team_label");
  const resolvedSelectedTeamDescription =
    selectedTeam?.description ||
    readMetadataText(existingHarnessMetadata, "selected_team_description");
  const resolvedSelectedTeamSummary =
    selectedTeamSummary ||
    readMetadataText(existingHarnessMetadata, "selected_team_summary");
  const resolvedSelectedTeamRoles =
    (selectedTeam?.roles && selectedTeam.roles.length > 0
      ? selectedTeam.roles
      : undefined) || readExistingTeamRoles(existingHarnessMetadata);
  const resolvedTeamMemoryShadow =
    buildTeamMemoryShadowRequestMetadata(teamMemoryShadowSnapshot) ||
    readExistingTeamMemoryShadow(existingHarnessMetadata);
  const resolvedBrowserRequirement =
    browserRequirementMatch?.requirement ||
    readExistingBrowserRequirement(existingHarnessMetadata);
  const resolvedBrowserRequirementReason =
    browserRequirementMatch?.reason ||
    readMetadataText(existingHarnessMetadata, "browser_requirement_reason");
  const resolvedBrowserLaunchUrl =
    browserRequirementMatch?.launchUrl ||
    readMetadataText(existingHarnessMetadata, "browser_launch_url");

  return {
    ...(workspaceRequestMetadataBase || {}),
    ...(sendOptions?.requestMetadata || {}),
    harness: buildHarnessRequestMetadata({
      base: existingHarnessMetadata,
      theme: mappedTheme,
      turnPurpose: sendOptions?.purpose,
      preferences: {
        webSearch: effectiveToolPreferences.webSearch,
        thinking: effectiveToolPreferences.thinking,
        task: effectiveToolPreferences.task,
        subagent: effectiveToolPreferences.subagent,
      },
      sessionMode: isThemeWorkbench ? "general_workbench" : "default",
      gateKey: isThemeWorkbench ? currentGateKey : undefined,
      runTitle: themeWorkbenchActiveQueueTitle?.trim() || undefined,
      contentId: contentId || undefined,
      browserRequirement: resolvedBrowserRequirement,
      browserRequirementReason: resolvedBrowserRequirementReason,
      browserLaunchUrl: resolvedBrowserLaunchUrl,
      browserAssistProfileKey:
        mappedTheme === "general"
          ? browserAssistProfileKey || GENERAL_BROWSER_ASSIST_PROFILE_KEY
          : undefined,
      browserAssistPreferredBackend,
      browserAssistAutoLaunch,
      preferredTeamPresetId: resolvedPreferredTeamPresetId,
      selectedTeamId: resolvedSelectedTeamId,
      selectedTeamSource: resolvedSelectedTeamSource,
      selectedTeamLabel: resolvedSelectedTeamLabel,
      selectedTeamDescription: resolvedSelectedTeamDescription,
      selectedTeamSummary: resolvedSelectedTeamSummary,
      selectedTeamRoles: resolvedSelectedTeamRoles,
      teamMemoryShadow: resolvedTeamMemoryShadow,
    }),
  };
}

export function buildRuntimeTeamDispatchPreview(
  preparedRuntimeTeamState: PreparedRuntimeTeamState,
  sourceText: string,
  images: MessageImage[],
  messagesCount: number,
): RuntimeTeamDispatchPreviewSnapshot {
  return {
    key: preparedRuntimeTeamState.requestId,
    prompt: sourceText,
    images,
    baseMessageCount: messagesCount,
    status: preparedRuntimeTeamState.status,
    formationState: preparedRuntimeTeamState,
    failureMessage: preparedRuntimeTeamState.errorMessage?.trim() || null,
  };
}

export function resolveRuntimeTeamDispatchPreviewState(
  snapshot: RuntimeTeamDispatchPreviewSnapshot | null | undefined,
): TeamWorkspaceRuntimeFormationState | null {
  const formationState = snapshot?.formationState ?? null;
  if (!snapshot || !formationState) {
    return null;
  }

  const normalizedFailureMessage = snapshot.failureMessage?.trim() || null;
  if (
    snapshot.status === formationState.status &&
    !(snapshot.status === "failed" && normalizedFailureMessage)
  ) {
    return formationState;
  }

  return {
    ...formationState,
    status: snapshot.status,
    errorMessage:
      snapshot.status === "failed"
        ? normalizedFailureMessage ||
          formationState.errorMessage?.trim() ||
          null
        : null,
  };
}

function buildRuntimeTeamMemberPlanLines(
  state: TeamWorkspaceRuntimeFormationState,
): string[] {
  const members = state.members.slice(0, 3);
  const lines = members.map((member, index) => {
    const label =
      normalizeTeamWorkspaceDisplayValue(member.label) || `任务 ${index + 1}`;
    const summary =
      normalizeTeamWorkspaceDisplayValue(member.summary) ||
      "负责推进当前任务中的一部分工作。";
    return `${index + 1}. ${label}：${summary}`;
  });

  if (state.members.length > members.length) {
    lines.push(
      `另外还有 ${state.members.length - members.length} 项任务会继续接手处理。`,
    );
  }

  return lines;
}

function buildRuntimeTeamAssistantDraft(
  state: TeamWorkspaceRuntimeFormationState | null | undefined,
): AssistantDraftState | undefined {
  if (!state || state.status !== "formed") {
    return undefined;
  }

  const teamLabel =
    normalizeTeamWorkspaceDisplayValue(state.label || state.blueprint?.label) ||
    "当前任务方案";
  const summary =
    normalizeTeamWorkspaceDisplayValue(
      state.summary || state.blueprint?.summary,
    ) || "";
  const planLines = buildRuntimeTeamMemberPlanLines(state);
  const contentSections = [
    `我已经为这项任务准备了「${teamLabel}」。`,
    summary ? `会先按“${summary}”来推进。` : null,
    planLines.length > 0 ? `分工如下：\n${planLines.join("\n")}` : null,
    "接下来这些任务会分别展开处理，再把关键进展、风险和需要你确认的事项汇总给你。",
  ].filter(Boolean);

  const initialRuntimeStatus: AgentRuntimeStatus = {
    phase: "routing",
    title: "任务分工已准备好",
    detail:
      summary || "已整理好当前任务的分工，接下来会分别展开处理并同步结果。",
    checkpoints: [
      `当前方案：${teamLabel}`,
      `已安排 ${Math.max(state.members.length, 1)} 项任务`,
      "主对话会持续同步关键进展",
    ],
  };

  const waitingRuntimeStatus: AgentRuntimeStatus = {
    phase: "routing",
    title: "任务开始接手",
    detail:
      summary || "分工已经确认，这些任务会按各自职责继续处理并回传关键结果。",
    checkpoints: [
      `当前方案：${teamLabel}`,
      planLines[0] || "这些任务会分别接手自己的部分",
      "主对话会持续同步关键进展",
    ],
  };

  return {
    content: contentSections.join("\n\n"),
    initialRuntimeStatus,
    waitingRuntimeStatus,
  };
}

export function buildRuntimeTeamDispatchPreviewMessages(
  snapshot: RuntimeTeamDispatchPreviewSnapshot,
): Message[] {
  const normalizedPrompt = snapshot.prompt.trim();
  const timestamp = new Date();
  const formedAssistantDraft =
    snapshot.status === "formed"
      ? buildRuntimeTeamAssistantDraft(snapshot.formationState)
      : undefined;
  const formedTeamLabel =
    normalizeTeamWorkspaceDisplayValue(
      snapshot.formationState?.label || snapshot.formationState?.blueprint?.label,
    ) ||
    "当前任务方案";
  const formedSummary =
    normalizeTeamWorkspaceDisplayValue(
      snapshot.formationState?.summary ||
        snapshot.formationState?.blueprint?.summary,
    ) ||
    "";
  const assistantRuntimeStatus =
    snapshot.status === "failed"
      ? {
          phase: "failed" as const,
          title: "任务分工准备失败",
          detail:
            normalizeTeamWorkspaceDisplayValue(snapshot.failureMessage) ||
            "这次任务分工准备失败，已回退到普通对话发送。",
        }
      : snapshot.status === "formed"
        ? formedAssistantDraft?.initialRuntimeStatus || {
            phase: "routing" as const,
            title: "任务分工已准备好",
            detail:
              formedSummary ||
              "已整理好当前任务的分工，接下来会分别展开处理并同步结果。",
            checkpoints: [
              `当前方案：${formedTeamLabel}`,
              "这些任务会按分工开始接手",
              "主对话会持续同步关键进展",
            ],
          }
        : {
            phase: "routing" as const,
            title: "正在准备任务分工",
            detail:
              "系统正在根据当前任务安排分工，会先拆出合适的任务，再把关键进展持续汇总回主对话。",
            checkpoints: [
              "确认当前任务目标",
              "安排任务分工",
              "等待任务接手处理",
            ],
          };

  return [
    {
      id: `runtime-team-dispatch:${snapshot.key}:user`,
      role: "user",
      content: normalizedPrompt,
      images: snapshot.images.length > 0 ? snapshot.images : undefined,
      timestamp,
    },
    {
      id: `runtime-team-dispatch:${snapshot.key}:assistant`,
      role: "assistant",
      content:
        snapshot.status === "failed"
          ? "这次任务分工准备失败，已回退到普通执行。"
          : snapshot.status === "formed"
            ? formedAssistantDraft?.content ||
              `我已经为这项任务准备了「${formedTeamLabel}」。\n\n接下来这些任务会分别展开处理，再把关键进展和结果汇总给你。`
            : "我会先安排任务分工，再把关键进展和结果汇总给你。",
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: snapshot.status === "forming",
      runtimeStatus: assistantRuntimeStatus,
    },
  ];
}

export function buildInitialDispatchPreviewMessages(
  snapshot: InitialDispatchPreviewSnapshot,
  assistantPreviewText?: string,
): Message[] {
  const normalizedPrompt = (snapshot.prompt || "").trim();
  const normalizedImages = snapshot.images || [];

  if (!normalizedPrompt && normalizedImages.length === 0) {
    return [];
  }

  const timestamp = new Date();
  const normalizedAssistantPreviewText =
    assistantPreviewText?.trim() || "正在开始处理任务…";
  const isAssistantThinking =
    normalizedAssistantPreviewText === "正在开始处理任务…";

  return [
    {
      id: `initial-dispatch:${snapshot.key}:user`,
      role: "user",
      content: normalizedPrompt,
      images: normalizedImages.length > 0 ? normalizedImages : undefined,
      timestamp,
    },
    {
      id: `initial-dispatch:${snapshot.key}:assistant`,
      role: "assistant",
      content: normalizedAssistantPreviewText,
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: isAssistantThinking,
    },
  ];
}

interface CreateSubmissionPreviewSnapshotOptions {
  key: string;
  prompt: string;
  images: MessageImage[];
  executionStrategy: AsterExecutionStrategy;
  webSearch?: boolean;
  thinking?: boolean;
}

export function createSubmissionPreviewSnapshot(
  options: CreateSubmissionPreviewSnapshotOptions,
): SubmissionPreviewSnapshot {
  const { key, prompt, images, executionStrategy, webSearch, thinking } =
    options;

  return {
    key,
    prompt,
    images,
    createdAt: Date.now(),
    runtimeStatus: buildWaitingAgentRuntimeStatus({
      executionStrategy,
      webSearch,
      thinking,
    }),
  };
}

export function buildSubmissionPreviewMessages(
  snapshot: SubmissionPreviewSnapshot,
): Message[] {
  const timestamp = new Date(snapshot.createdAt);

  return [
    {
      id: `submission-preview:${snapshot.key}:user`,
      role: "user",
      content: snapshot.prompt,
      images: snapshot.images.length > 0 ? snapshot.images : undefined,
      timestamp,
    },
    {
      id: `submission-preview:${snapshot.key}:assistant`,
      role: "assistant",
      content: formatAgentRuntimeStatusSummary(snapshot.runtimeStatus),
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: true,
      runtimeStatus: snapshot.runtimeStatus,
    },
  ];
}
