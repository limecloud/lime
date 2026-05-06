import type { BrowserTaskRequirement, Message } from "../types";
import type {
  TeamRoleDefinition,
  TeamDefinitionSource,
} from "./teamDefinitions";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import type { TeamMemoryShadowRequestMetadata } from "@/lib/teamMemorySync";
import {
  isGeneralWorkbenchSessionMode,
  normalizeHarnessSessionMode,
  type HarnessSessionModeInput,
} from "./harnessSessionMode";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";
import {
  buildWorkspaceSkillBindingsHarnessMetadata,
  buildWorkspaceSkillRuntimeEnableHarnessMetadata,
  type WorkspaceSkillRuntimeEnableInput,
} from "./workspaceSkillBindingsMetadata";

export interface HarnessOemRoutingRequestMetadata {
  tenant_id: string;
  provider_source?: string;
  provider_key?: string;
  default_model?: string;
  config_mode?: string;
  offer_state?: string;
  quota_status?: string;
  fallback_to_local_allowed?: boolean;
  can_invoke?: boolean;
}

export interface HarnessTenantFeatureFlagsRequestMetadata {
  tenant_id: string;
  source?: string;
  flags: Record<string, boolean>;
}

export interface BuildHarnessRequestMetadataOptions {
  base?: Record<string, unknown>;
  theme: string;
  turnPurpose?: Message["purpose"] | null;
  preferences: {
    webSearch: boolean;
    thinking: boolean;
    task: boolean;
    subagent: boolean;
  };
  accessMode?: AgentAccessMode;
  sessionMode: HarnessSessionModeInput;
  gateKey?: string | null;
  runTitle?: string | null;
  contentId?: string | null;
  browserRequirement?: BrowserTaskRequirement | null;
  browserRequirementReason?: string | null;
  browserLaunchUrl?: string | null;
  browserAssistProfileKey?: string | null;
  browserAssistPreferredBackend?:
    | "aster_compat"
    | "lime_extension_bridge"
    | "cdp_direct"
    | null;
  browserAssistAutoLaunch?: boolean | null;
  preferredTeamPresetId?: string | null;
  selectedTeamId?: string | null;
  selectedTeamSource?: TeamDefinitionSource | null;
  selectedTeamLabel?: string | null;
  selectedTeamDescription?: string | null;
  selectedTeamSummary?: string | null;
  selectedTeamRoles?: TeamRoleDefinition[] | null;
  teamMemoryShadow?: TeamMemoryShadowRequestMetadata | null;
  workspaceSkillBindings?: AgentRuntimeWorkspaceSkillBinding[] | null;
  workspaceSkillRuntimeEnable?: WorkspaceSkillRuntimeEnableInput | null;
  oemRouting?: HarnessOemRoutingRequestMetadata | null;
  tenantFeatureFlags?: HarnessTenantFeatureFlagsRequestMetadata | null;
}

export function extractExistingHarnessMetadata(
  requestMetadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const harnessValue = requestMetadata?.harness;
  if (
    typeof harnessValue !== "object" ||
    harnessValue === null ||
    Array.isArray(harnessValue)
  ) {
    return undefined;
  }

  return harnessValue as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

const LEGACY_HARNESS_STATE_KEYS = [
  "creation_mode",
  "creationMode",
  "chat_mode",
  "chatMode",
  "web_search_enabled",
  "webSearchEnabled",
  "thinking_enabled",
  "thinkingEnabled",
  "task_mode_enabled",
  "taskModeEnabled",
  "subagent_mode_enabled",
  "subagentModeEnabled",
  "turn_team_decision",
  "turnTeamDecision",
  "turn_team_reason",
  "turnTeamReason",
  "turn_team_blueprint",
  "turnTeamBlueprint",
] as const;

function clearLegacyHarnessStateFields(
  metadata: Record<string, unknown>,
): void {
  LEGACY_HARNESS_STATE_KEYS.forEach((key) => {
    delete metadata[key];
  });
}

export function buildHarnessRequestMetadata(
  options: BuildHarnessRequestMetadataOptions,
): Record<string, unknown> {
  const {
    base,
    theme,
    turnPurpose,
    preferences,
    accessMode,
    sessionMode,
    gateKey,
    runTitle,
    contentId,
    browserRequirement,
    browserRequirementReason,
    browserLaunchUrl,
    browserAssistProfileKey,
    browserAssistPreferredBackend,
    browserAssistAutoLaunch,
    preferredTeamPresetId,
    selectedTeamId,
    selectedTeamSource,
    selectedTeamLabel,
    selectedTeamDescription,
    selectedTeamSummary,
    selectedTeamRoles,
    teamMemoryShadow,
    workspaceSkillBindings,
    workspaceSkillRuntimeEnable,
    oemRouting,
    tenantFeatureFlags,
  } = options;

  const serializeTeamRoles = (roles?: TeamRoleDefinition[] | null) =>
    roles && roles.length > 0
      ? roles.map((role) => ({
          id: role.id,
          label: role.label,
          summary: role.summary,
          profile_id: role.profileId || undefined,
          role_key: role.roleKey || undefined,
          skill_ids:
            role.skillIds && role.skillIds.length > 0
              ? [...role.skillIds]
              : undefined,
        }))
      : undefined;
  const normalizedSessionMode =
    normalizeHarnessSessionMode(sessionMode) || "default";
  const existingBrowserAssist =
    asRecord(base?.browser_assist) || asRecord(base?.browserAssist);
  const browserAssistMetadata = browserAssistProfileKey
    ? {
        ...(existingBrowserAssist || {}),
        enabled: true,
        profile_key: browserAssistProfileKey,
        preferred_backend:
          browserAssistPreferredBackend ??
          readTrimmedString(existingBrowserAssist?.preferred_backend) ??
          readTrimmedString(existingBrowserAssist?.preferredBackend),
        auto_launch:
          browserAssistAutoLaunch ??
          readBoolean(existingBrowserAssist?.auto_launch) ??
          readBoolean(existingBrowserAssist?.autoLaunch) ??
          true,
        stream_mode:
          readTrimmedString(existingBrowserAssist?.stream_mode) ??
          readTrimmedString(existingBrowserAssist?.streamMode) ??
          "both",
      }
    : existingBrowserAssist;
  const workspaceSkillBindingsMetadata =
    buildWorkspaceSkillBindingsHarnessMetadata(workspaceSkillBindings);
  const workspaceSkillRuntimeEnableMetadata =
    buildWorkspaceSkillRuntimeEnableHarnessMetadata(
      workspaceSkillRuntimeEnable,
    );

  const metadata: Record<string, unknown> = {
    ...(base || {}),
    theme,
    turn_purpose: turnPurpose || undefined,
    preferences: {
      web_search: preferences.webSearch,
      thinking: preferences.thinking,
      task: preferences.task,
      subagent: preferences.subagent,
    },
    ...(accessMode ? { access_mode: accessMode } : {}),
    session_mode: normalizedSessionMode,
    gate_key: isGeneralWorkbenchSessionMode(normalizedSessionMode)
      ? gateKey || undefined
      : undefined,
    run_title: runTitle || undefined,
    content_id: contentId || undefined,
    preferred_team_preset_id: preferredTeamPresetId || undefined,
    selected_team_id: selectedTeamId || undefined,
    selected_team_source: selectedTeamSource || undefined,
    selected_team_label: selectedTeamLabel || undefined,
    selected_team_description: selectedTeamDescription || undefined,
    selected_team_summary: selectedTeamSummary || undefined,
    selected_team_roles: serializeTeamRoles(selectedTeamRoles),
    team_memory_shadow: teamMemoryShadow || undefined,
    workspace_skill_bindings:
      workspaceSkillBindingsMetadata?.workspace_skill_bindings ??
      base?.workspace_skill_bindings ??
      base?.workspaceSkillBindings,
    workspace_skill_runtime_enable:
      workspaceSkillRuntimeEnableMetadata?.workspace_skill_runtime_enable ??
      base?.workspace_skill_runtime_enable ??
      base?.workspaceSkillRuntimeEnable,
    oem_routing: oemRouting || undefined,
    tenant_feature_flags: tenantFeatureFlags || undefined,
    browser_requirement: browserRequirement || undefined,
    browser_requirement_reason: browserRequirementReason || undefined,
    browser_launch_url: browserLaunchUrl || undefined,
    browser_user_step_required:
      browserRequirement === "required_with_user_step",
    ...(browserAssistMetadata ? { browser_assist: browserAssistMetadata } : {}),
  };

  clearLegacyHarnessStateFields(metadata);
  return metadata;
}
