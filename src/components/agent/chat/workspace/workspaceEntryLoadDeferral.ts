import type { AgentChatWorkspaceProps } from "../agentChatWorkspaceContract";
import {
  BLANK_HOME_DEFERRED_LOAD_MS,
  RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS,
  SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
  SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS,
} from "./agentChatWorkspaceHelpers";

type AgentEntry = NonNullable<AgentChatWorkspaceProps["agentEntry"]>;

export interface ResolveWorkspaceEntryLoadDeferralParams {
  agentEntry: AgentEntry;
  contentId?: string | null;
  normalizedEntryTheme: string;
  normalizedInitialSessionId: string | null;
  initialUserPrompt?: string;
  initialUserImages?: AgentChatWorkspaceProps["initialUserImages"];
  initialSiteSkillLaunch?: AgentChatWorkspaceProps["initialSiteSkillLaunch"];
  initialPendingServiceSkillLaunch?: AgentChatWorkspaceProps["initialPendingServiceSkillLaunch"];
  initialInputCapability?: AgentChatWorkspaceProps["initialInputCapability"];
  initialProjectFileOpenTarget?: AgentChatWorkspaceProps["initialProjectFileOpenTarget"];
}

export interface WorkspaceEntryLoadDeferral {
  shouldPreserveEntryThemeOnHome: boolean;
  shouldPreserveBlankHomeSurface: boolean;
  shouldUseBrowserWorkspaceHomeChrome: boolean;
  shouldPrioritizeInitialSessionEntry: boolean;
  shouldPrioritizeInitialPromptEntry: boolean;
  shouldDeferWorkspaceAuxiliaryLoads: boolean;
  shouldDeferInitialTopicsLoad: boolean;
  shouldDeferInitialRuntimeWarmup: boolean;
  deferredWorkspaceAuxiliaryLoadMs?: number;
  deferredInitialTopicsLoadMs?: number;
  deferredInitialRuntimeWarmupMs?: number;
}

export function resolveWorkspaceEntryLoadDeferral({
  agentEntry,
  contentId,
  normalizedEntryTheme,
  normalizedInitialSessionId,
  initialUserPrompt,
  initialUserImages,
  initialSiteSkillLaunch,
  initialPendingServiceSkillLaunch,
  initialInputCapability,
  initialProjectFileOpenTarget,
}: ResolveWorkspaceEntryLoadDeferralParams): WorkspaceEntryLoadDeferral {
  const shouldPreserveEntryThemeOnHome =
    agentEntry === "new-task" && !contentId;
  const shouldPreserveBlankHomeSurface =
    shouldPreserveEntryThemeOnHome && normalizedEntryTheme === "general";
  const shouldPrioritizeInitialSessionEntry =
    normalizedInitialSessionId !== null && !contentId;
  const shouldPrioritizeInitialPromptEntry =
    agentEntry === "conversation" &&
    !contentId &&
    normalizedEntryTheme === "general" &&
    Boolean(initialUserPrompt?.trim()) &&
    !initialUserImages?.length &&
    !initialSiteSkillLaunch &&
    !initialPendingServiceSkillLaunch?.skillId?.trim() &&
    !initialPendingServiceSkillLaunch?.skillKey?.trim() &&
    !initialInputCapability &&
    !initialProjectFileOpenTarget?.relativePath?.trim();
  const shouldDeferWorkspaceAuxiliaryLoads =
    shouldPreserveBlankHomeSurface ||
    shouldPrioritizeInitialSessionEntry ||
    shouldPrioritizeInitialPromptEntry;
  const shouldDeferInitialTopicsLoad = shouldDeferWorkspaceAuxiliaryLoads;
  const shouldDeferInitialRuntimeWarmup = shouldDeferInitialTopicsLoad;

  const shouldUseSessionEntryDeferral =
    shouldPrioritizeInitialSessionEntry || shouldPrioritizeInitialPromptEntry;

  return {
    shouldPreserveEntryThemeOnHome,
    shouldPreserveBlankHomeSurface,
    shouldUseBrowserWorkspaceHomeChrome: shouldPreserveBlankHomeSurface,
    shouldPrioritizeInitialSessionEntry,
    shouldPrioritizeInitialPromptEntry,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldDeferInitialTopicsLoad,
    shouldDeferInitialRuntimeWarmup,
    deferredWorkspaceAuxiliaryLoadMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : shouldUseSessionEntryDeferral
        ? SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS
        : undefined,
    deferredInitialTopicsLoadMs: shouldPreserveBlankHomeSurface
      ? RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS
      : shouldUseSessionEntryDeferral
        ? RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS
        : undefined,
    deferredInitialRuntimeWarmupMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : shouldUseSessionEntryDeferral
        ? SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS
        : undefined,
  };
}
