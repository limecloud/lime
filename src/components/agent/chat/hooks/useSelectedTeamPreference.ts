import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AsterSessionExecutionRuntimeRecentTeamSelection } from "@/lib/api/agentExecutionRuntime";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { WorkspaceSettings } from "@/types/workspace";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  buildTeamDefinitionLabel,
  buildTeamDefinitionSummary,
  createTeamDefinitionFromPreset,
} from "../utils/teamDefinitions";
import { createTeamDefinitionFromExecutionRuntimeRecentTeamSelection } from "../utils/sessionExecutionRuntime";
import { resolveSelectedTeamFromShadowSnapshot } from "./useTeamMemoryShadowSync";
import {
  loadCustomTeams,
  persistSelectedTeam,
  resolveSelectedTeamPreference,
  resolveWorkspaceTeamPreferenceState,
  saveCustomTeams,
} from "../utils/teamStorage";

function normalizeThemeScope(theme?: string | null): string {
  return theme?.trim().toLowerCase() || "general";
}

function serializeSelectedTeam(team?: TeamDefinition | null): string {
  if (!team) {
    return "null";
  }

  return JSON.stringify({
    id: team.id,
    source: team.source,
    label: team.label,
    description: team.description,
    theme: team.theme,
    presetId: team.presetId,
    roles: team.roles.map((role) => ({
      id: role.id,
      label: role.label,
      summary: role.summary,
      profileId: role.profileId,
      roleKey: role.roleKey,
      skillIds: role.skillIds || [],
    })),
  });
}

function areSameSelectedTeam(
  left?: TeamDefinition | null,
  right?: TeamDefinition | null,
): boolean {
  return serializeSelectedTeam(left) === serializeSelectedTeam(right);
}

function serializeRuntimeSelection(
  selection?: AsterSessionExecutionRuntimeRecentTeamSelection | null,
): string {
  if (!selection) {
    return "runtime:none";
  }

  return JSON.stringify({
    disabled: selection.disabled,
    theme: selection.theme ?? null,
    preferredTeamPresetId: selection.preferredTeamPresetId ?? null,
    selectedTeamId: selection.selectedTeamId ?? null,
    selectedTeamSource: selection.selectedTeamSource ?? null,
    selectedTeamLabel: selection.selectedTeamLabel ?? null,
    selectedTeamDescription: selection.selectedTeamDescription ?? null,
    selectedTeamSummary: selection.selectedTeamSummary ?? null,
    selectedTeamRoles: selection.selectedTeamRoles ?? null,
  });
}

function persistSelectedTeamShadowCache(
  team: TeamDefinition | null,
  options?: {
    theme?: string | null;
    allowPersistedThemeFallback?: boolean;
  },
) {
  if (team?.source === "custom") {
    const nextCustomTeams = [
      team,
      ...loadCustomTeams().filter(
        (existingTeam) => existingTeam.id !== team.id,
      ),
    ];
    saveCustomTeams(nextCustomTeams);
  }

  if (options?.allowPersistedThemeFallback ?? true) {
    persistSelectedTeam(team, options?.theme);
  }
}

interface SelectedTeamPreferenceSessionSyncOptions {
  getSessionId: () => string | null;
  setSessionRecentTeamSelection: (
    sessionId: string,
    team: TeamDefinition | null,
    theme?: string | null,
    options?: { priority?: "immediate" | "background" },
  ) => Promise<void>;
}

interface UseSelectedTeamPreferenceOptions {
  projectSettings?: WorkspaceSettings | null;
  onPersistSelectedTeam?: (team: TeamDefinition | null) => void | Promise<void>;
  runtimeSelection?: AsterSessionExecutionRuntimeRecentTeamSelection | null;
  sessionSync?: SelectedTeamPreferenceSessionSyncOptions;
  shadowSnapshot?: TeamMemorySnapshot | null;
  allowPersistedThemeFallback?: boolean;
}

export function useSelectedTeamPreference(
  theme?: string | null,
  options: UseSelectedTeamPreferenceOptions = {},
) {
  const {
    projectSettings,
    onPersistSelectedTeam,
    runtimeSelection = null,
    sessionSync,
    shadowSnapshot = null,
    allowPersistedThemeFallback = true,
  } = options;
  const currentSessionId = sessionSync?.getSessionId()?.trim() || null;
  const scopeKey = `${currentSessionId ?? "__no_session__"}:${normalizeThemeScope(theme)}`;
  const workspacePreferenceState = useMemo(
    () => resolveWorkspaceTeamPreferenceState(projectSettings),
    [projectSettings],
  );
  const resolveCurrentSelection = useCallback(
    () =>
      resolveSelectedTeamPreference({
        theme,
        workspaceSettings: projectSettings,
        allowPersistedThemeFallback,
      }),
    [allowPersistedThemeFallback, projectSettings, theme],
  );
  const runtimeSelectionMatchesTheme = useMemo(() => {
    const runtimeTheme = runtimeSelection?.theme?.trim().toLowerCase();
    if (!runtimeTheme) {
      return true;
    }
    return runtimeTheme === normalizeThemeScope(theme);
  }, [runtimeSelection?.theme, theme]);
  const runtimeSelectedTeam = useMemo(
    () =>
      runtimeSelectionMatchesTheme
        ? createTeamDefinitionFromExecutionRuntimeRecentTeamSelection(
            runtimeSelection,
          )
        : null,
    [runtimeSelection, runtimeSelectionMatchesTheme],
  );
  const shadowSelectedTeam = useMemo(
    () => resolveSelectedTeamFromShadowSnapshot(shadowSnapshot, theme),
    [shadowSnapshot, theme],
  );
  const hasRuntimeSelection = Boolean(
    runtimeSelectionMatchesTheme &&
    runtimeSelection &&
    (runtimeSelection.disabled || runtimeSelectedTeam),
  );
  const [selectedTeam, setSelectedTeamState] = useState<TeamDefinition | null>(
    () => resolveCurrentSelection(),
  );
  const manualMutationVersionRef = useRef(0);
  const lastScopeKeyRef = useRef(scopeKey);
  const lastHydratedSourceRef = useRef<string | null>(null);
  const lastBackfilledSourceRef = useRef<string | null>(null);
  const pendingSessionTeamSyncRef = useRef(
    new Map<
      string,
      {
        team: TeamDefinition | null;
        options?: { priority?: "immediate" | "background" };
      }
    >(),
  );

  if (lastScopeKeyRef.current !== scopeKey) {
    lastScopeKeyRef.current = scopeKey;
    manualMutationVersionRef.current = 0;
    lastHydratedSourceRef.current = null;
    lastBackfilledSourceRef.current = null;
  }

  const scheduleSessionRecentTeamSelectionSync = useCallback(
    (
      team: TeamDefinition | null,
      options?: { priority?: "immediate" | "background" },
    ) => {
      if (!currentSessionId || !sessionSync?.setSessionRecentTeamSelection) {
        return;
      }

      const pending = pendingSessionTeamSyncRef.current;
      const previous = pending.get(currentSessionId);
      const alreadyQueued = pending.has(currentSessionId);
      const shouldUseBackgroundSync =
        (!previous || previous.options?.priority === "background") &&
        options?.priority === "background";
      pending.set(currentSessionId, {
        team,
        options: shouldUseBackgroundSync
          ? { priority: "background" }
          : undefined,
      });
      if (alreadyQueued) {
        return;
      }

      queueMicrotask(() => {
        if (!pending.has(currentSessionId)) {
          return;
        }

        const latest = pending.get(currentSessionId);
        pending.delete(currentSessionId);
        const latestTeam = latest?.team ?? null;
        const syncPromise = latest?.options
          ? sessionSync.setSessionRecentTeamSelection(
              currentSessionId,
              latestTeam,
              theme,
              latest.options,
            )
          : sessionSync.setSessionRecentTeamSelection(
              currentSessionId,
              latestTeam,
              theme,
            );
        void syncPromise.catch((error) => {
          console.warn("[Team] 回写会话 recent_team_selection 失败:", error);
        });
      });
    },
    [currentSessionId, sessionSync, theme],
  );

  useEffect(() => {
    const fallbackTeam = shadowSelectedTeam ?? resolveCurrentSelection();
    const fallbackSourceKey = `${scopeKey}:fallback:${serializeSelectedTeam(
      fallbackTeam,
    )}`;

    if (workspacePreferenceState.kind !== "unset") {
      if (lastHydratedSourceRef.current !== fallbackSourceKey) {
        setSelectedTeamState((current) =>
          areSameSelectedTeam(current, fallbackTeam) ? current : fallbackTeam,
        );
        lastHydratedSourceRef.current = fallbackSourceKey;
      }

      if (lastBackfilledSourceRef.current !== fallbackSourceKey) {
        scheduleSessionRecentTeamSelectionSync(fallbackTeam, {
          priority: "background",
        });
        lastBackfilledSourceRef.current = fallbackSourceKey;
      }
      return;
    }

    if (manualMutationVersionRef.current > 0) {
      return;
    }

    if (hasRuntimeSelection) {
      const runtimeSourceKey = `${scopeKey}:runtime:${serializeRuntimeSelection(
        runtimeSelection,
      )}`;
      if (lastHydratedSourceRef.current === runtimeSourceKey) {
        return;
      }

      setSelectedTeamState((current) =>
        areSameSelectedTeam(current, runtimeSelectedTeam)
          ? current
          : runtimeSelectedTeam,
      );
      persistSelectedTeamShadowCache(runtimeSelectedTeam, {
        theme,
        allowPersistedThemeFallback,
      });
      lastHydratedSourceRef.current = runtimeSourceKey;
      return;
    }

    if (lastHydratedSourceRef.current !== fallbackSourceKey) {
      setSelectedTeamState((current) =>
        areSameSelectedTeam(current, fallbackTeam) ? current : fallbackTeam,
      );
      lastHydratedSourceRef.current = fallbackSourceKey;
    }

    if (lastBackfilledSourceRef.current !== fallbackSourceKey) {
      scheduleSessionRecentTeamSelectionSync(fallbackTeam, {
        priority: "background",
      });
      lastBackfilledSourceRef.current = fallbackSourceKey;
    }
  }, [
    hasRuntimeSelection,
    allowPersistedThemeFallback,
    resolveCurrentSelection,
    runtimeSelectedTeam,
    runtimeSelection,
    scheduleSessionRecentTeamSelectionSync,
    shadowSelectedTeam,
    scopeKey,
    theme,
    workspacePreferenceState.kind,
  ]);

  const setSelectedTeam = useCallback(
    (team: TeamDefinition | null) => {
      manualMutationVersionRef.current += 1;
      setSelectedTeamState((current) =>
        areSameSelectedTeam(current, team) ? current : team,
      );
      lastBackfilledSourceRef.current = `${scopeKey}:manual:${serializeSelectedTeam(
        team,
      )}`;

      if (onPersistSelectedTeam && team?.source !== "ephemeral") {
        const fallbackTeam = resolveCurrentSelection();
        void Promise.resolve(onPersistSelectedTeam(team))
          .then(() => {
            scheduleSessionRecentTeamSelectionSync(team);
          })
          .catch((error) => {
            console.warn("[Team] 持久化项目级 Team 偏好失败:", error);
            setSelectedTeamState((current) =>
              areSameSelectedTeam(current, fallbackTeam)
                ? current
                : fallbackTeam,
            );
            scheduleSessionRecentTeamSelectionSync(fallbackTeam);
          });
        return;
      }

      if (onPersistSelectedTeam && team?.source === "ephemeral") {
        scheduleSessionRecentTeamSelectionSync(team);
        return;
      }

      persistSelectedTeamShadowCache(team, {
        theme,
        allowPersistedThemeFallback,
      });
      scheduleSessionRecentTeamSelectionSync(team);
    },
    [
      onPersistSelectedTeam,
      resolveCurrentSelection,
      scheduleSessionRecentTeamSelectionSync,
      scopeKey,
      allowPersistedThemeFallback,
      theme,
    ],
  );

  const enableSuggestedTeam = useCallback(
    (suggestedPresetId?: string) => {
      const resolvedPresetId = suggestedPresetId?.trim();
      if (!resolvedPresetId) {
        return;
      }

      const suggestedTeam = createTeamDefinitionFromPreset(resolvedPresetId);
      if (suggestedTeam) {
        setSelectedTeam(suggestedTeam);
      }
    },
    [setSelectedTeam],
  );

  const preferredTeamPresetId = useMemo(
    () =>
      selectedTeam?.presetId?.trim() ||
      (selectedTeam?.source === "builtin" ? selectedTeam.id : undefined),
    [selectedTeam],
  );
  const selectedTeamLabel = useMemo(
    () => buildTeamDefinitionLabel(selectedTeam) || undefined,
    [selectedTeam],
  );
  const selectedTeamSummary = useMemo(
    () => buildTeamDefinitionSummary(selectedTeam) || undefined,
    [selectedTeam],
  );

  return {
    selectedTeam,
    setSelectedTeam,
    enableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  };
}
