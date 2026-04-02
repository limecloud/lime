import { SettingsTabs } from "@/types/settings";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type {
  ClawSolutionPreparation,
  ClawSolutionReadiness,
  ClawSolutionReasonCode,
  RecordClawSolutionUsageInput,
} from "./types";

export interface ClawSolutionEnterWorkspacePayload {
  prompt: string;
  openBrowserAssistOnMount?: boolean;
  toolPreferences: ChatToolPreferences;
  themeOverride?: string;
}

export interface ResolvedClawSolutionLaunch {
  nextToolPreferences: ChatToolPreferences;
  preferencesChanged: boolean;
  shouldStartBrowserAssistLoading: boolean;
  enterWorkspacePayload: ClawSolutionEnterWorkspacePayload;
  usageRecord: RecordClawSolutionUsageInput;
}

export function resolveClawSolutionSetupTarget(
  readiness: ClawSolutionReadiness,
  reasonCode?: ClawSolutionReasonCode,
): SettingsTabs | null {
  if (readiness === "needs_setup") {
    return SettingsTabs.Providers;
  }

  if (readiness !== "needs_capability") {
    return null;
  }

  if (reasonCode === "missing_skill_dependency") {
    return SettingsTabs.Skills;
  }

  if (reasonCode === "missing_browser_capability") {
    return SettingsTabs.ChromeRelay;
  }

  return SettingsTabs.Providers;
}

export function enableSubagentPreference(preferences: ChatToolPreferences): {
  nextToolPreferences: ChatToolPreferences;
  changed: boolean;
} {
  if (preferences.subagent) {
    return {
      nextToolPreferences: preferences,
      changed: false,
    };
  }

  return {
    nextToolPreferences: {
      ...preferences,
      subagent: true,
    },
    changed: true,
  };
}

function applyClawSolutionPreferencePreset(
  preferences: ChatToolPreferences,
  preset: Partial<ChatToolPreferences>,
): {
  nextToolPreferences: ChatToolPreferences;
  changed: boolean;
} {
  let changed = false;
  const nextPreferences = { ...preferences };

  for (const [key, value] of Object.entries(preset) as Array<
    [keyof ChatToolPreferences, boolean | undefined]
  >) {
    if (!value || nextPreferences[key]) {
      continue;
    }
    nextPreferences[key] = true;
    changed = true;
  }

  return {
    nextToolPreferences: changed ? nextPreferences : preferences,
    changed,
  };
}

function resolveClawSolutionPreferencePreset(
  preparation: ClawSolutionPreparation,
): Partial<ChatToolPreferences> {
  const preset: Partial<ChatToolPreferences> = {};

  if (preparation.solutionId === "web-research-brief") {
    preset.webSearch = true;
  }

  if (preparation.shouldEnableTeamMode) {
    preset.subagent = true;
  }

  return preset;
}

export function resolveClawSolutionLaunch(
  preparation: ClawSolutionPreparation,
  currentToolPreferences: ChatToolPreferences,
): ResolvedClawSolutionLaunch {
  const { nextToolPreferences, changed } = applyClawSolutionPreferencePreset(
    currentToolPreferences,
    resolveClawSolutionPreferencePreset(preparation),
  );

  return {
    nextToolPreferences,
    preferencesChanged: changed,
    shouldStartBrowserAssistLoading: preparation.shouldLaunchBrowserAssist,
    enterWorkspacePayload: {
      prompt: preparation.prompt,
      openBrowserAssistOnMount: preparation.shouldLaunchBrowserAssist,
      toolPreferences: nextToolPreferences,
      themeOverride: preparation.themeTarget,
    },
    usageRecord: {
      solutionId: preparation.solutionId,
      actionType: preparation.actionType,
      themeTarget: preparation.themeTarget ?? null,
    },
  };
}
