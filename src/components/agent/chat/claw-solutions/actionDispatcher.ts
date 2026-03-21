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

export function resolveClawSolutionLaunch(
  preparation: ClawSolutionPreparation,
  currentToolPreferences: ChatToolPreferences,
): ResolvedClawSolutionLaunch {
  const { nextToolPreferences, changed } = preparation.shouldEnableTeamMode
    ? enableSubagentPreference(currentToolPreferences)
    : {
        nextToolPreferences: currentToolPreferences,
        changed: false,
      };

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
