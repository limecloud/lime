import { preheatBrowserAssistInBackground } from "../utils/browserAssistPreheat";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "../utils/harnessRequestMetadata";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { BrowserTaskRequirement, MessageImage } from "../types";
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
import type { RuntimeTeamDispatchPreviewSnapshot } from "./runtimeTeamPreview";
import type { UseRuntimeTeamFormationResult } from "../hooks/useRuntimeTeamFormation";
import type { AgentAccessMode } from "../hooks/agentChatStorage";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

type PreparedRuntimeTeamState = NonNullable<
  Awaited<ReturnType<UseRuntimeTeamFormationResult["prepareRuntimeTeamBeforeSend"]>>
>;

export interface ContextWorkspaceSummary {
  enabled: boolean;
  activeContextPrompt: string;
  prepareActiveContextPrompt: () => Promise<string>;
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

function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
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

function readExistingTeamSource(
  metadata: Record<string, unknown> | undefined,
): TeamDefinitionSource | undefined {
  const source = readMetadataText(metadata, "selected_team_source");
  if (
    source === "builtin" ||
    source === "custom" ||
    source === "ephemeral"
  ) {
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
    asRecord(metadata?.team_memory_shadow) ?? asRecord(metadata?.teamMemoryShadow);
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
      (
        entry,
      ): entry is TeamMemoryShadowRequestMetadata["entries"][number] =>
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
  accessMode?: AgentAccessMode;
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
      activeContextPrompt =
        (await contextWorkspace.prepareActiveContextPrompt()).trim();
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

  const launch =
    asRecord(harness.service_skill_launch) ??
    asRecord(harness.serviceSkillLaunch);
  if (!launch) {
    return false;
  }

  const adapterName = launch.adapter_name ?? launch.adapterName;
  return typeof adapterName === "string" && adapterName.trim().length > 0;
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
    accessMode,
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

  const existingHarnessMetadata = extractExistingHarnessMetadata({
    ...(workspaceRequestMetadataBase || {}),
    ...(sendOptions?.requestMetadata || {}),
  });
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
      accessMode,
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
