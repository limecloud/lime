import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AsterSessionExecutionRuntimeRecentTeamSelection } from "@/lib/api/agentExecutionRuntime";
import type { WorkspaceSettings } from "@/types/workspace";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  buildTeamDefinitionLabel,
  buildTeamDefinitionSummary,
  createTeamDefinitionFromPreset,
} from "../utils/teamDefinitions";
import {
  createTeamDefinitionFromExecutionRuntimeRecentTeamSelection,
} from "../utils/sessionExecutionRuntime";
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
  theme?: string | null,
) {
  if (team?.source === "custom") {
    const nextCustomTeams = [
      team,
      ...loadCustomTeams().filter((existingTeam) => existingTeam.id !== team.id),
    ];
    saveCustomTeams(nextCustomTeams);
  }

  persistSelectedTeam(team, theme);
}

interface SelectedTeamPreferenceSessionSyncOptions {
  getSessionId: () => string | null;
  setSessionRecentTeamSelection: (
    sessionId: string,
    team: TeamDefinition | null,
    theme?: string | null,
  ) => Promise<void>;
}

interface UseSelectedTeamPreferenceOptions {
  projectSettings?: WorkspaceSettings | null;
  onPersistSelectedTeam?: (team: TeamDefinition | null) => void | Promise<void>;
  runtimeSelection?: AsterSessionExecutionRuntimeRecentTeamSelection | null;
  sessionSync?: SelectedTeamPreferenceSessionSyncOptions;
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
      }),
    [projectSettings, theme],
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
  const pendingSessionTeamSyncRef = useRef(new Map<string, TeamDefinition | null>());

  if (lastScopeKeyRef.current !== scopeKey) {
    lastScopeKeyRef.current = scopeKey;
    manualMutationVersionRef.current = 0;
    lastHydratedSourceRef.current = null;
    lastBackfilledSourceRef.current = null;
  }

  const scheduleSessionRecentTeamSelectionSync = useCallback(
    (team: TeamDefinition | null) => {
      if (!currentSessionId || !sessionSync?.setSessionRecentTeamSelection) {
        return;
      }

      const pending = pendingSessionTeamSyncRef.current;
      const alreadyQueued = pending.has(currentSessionId);
      pending.set(currentSessionId, team);
      if (alreadyQueued) {
        return;
      }

      queueMicrotask(() => {
        if (!pending.has(currentSessionId)) {
          return;
        }

        const latestTeam = pending.get(currentSessionId) ?? null;
        pending.delete(currentSessionId);
        void sessionSync
          .setSessionRecentTeamSelection(currentSessionId, latestTeam, theme)
          .catch((error) => {
            console.warn("[Team] 回写会话 recent_team_selection 失败:", error);
          });
      });
    },
    [currentSessionId, sessionSync, theme],
  );

  useEffect(() => {
    const fallbackTeam = resolveCurrentSelection();
    const fallbackSourceKey = `${scopeKey}:fallback:${serializeSelectedTeam(
      fallbackTeam,
    )}`;

    if (workspacePreferenceState.kind !== "unset") {
      if (lastHydratedSourceRef.current !== fallbackSourceKey) {
        setSelectedTeamState(fallbackTeam);
        lastHydratedSourceRef.current = fallbackSourceKey;
      }

      if (lastBackfilledSourceRef.current !== fallbackSourceKey) {
        scheduleSessionRecentTeamSelectionSync(fallbackTeam);
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

      setSelectedTeamState(runtimeSelectedTeam);
      persistSelectedTeamShadowCache(runtimeSelectedTeam, theme);
      lastHydratedSourceRef.current = runtimeSourceKey;
      return;
    }

    if (lastHydratedSourceRef.current !== fallbackSourceKey) {
      setSelectedTeamState(fallbackTeam);
      lastHydratedSourceRef.current = fallbackSourceKey;
    }

    if (lastBackfilledSourceRef.current !== fallbackSourceKey) {
      scheduleSessionRecentTeamSelectionSync(fallbackTeam);
      lastBackfilledSourceRef.current = fallbackSourceKey;
    }
  }, [
    hasRuntimeSelection,
    resolveCurrentSelection,
    runtimeSelectedTeam,
    runtimeSelection,
    scheduleSessionRecentTeamSelectionSync,
    scopeKey,
    theme,
    workspacePreferenceState.kind,
  ]);

  const setSelectedTeam = useCallback(
    (team: TeamDefinition | null) => {
      manualMutationVersionRef.current += 1;
      setSelectedTeamState(team);
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
            setSelectedTeamState(fallbackTeam);
            scheduleSessionRecentTeamSelectionSync(fallbackTeam);
          });
        return;
      }

      if (onPersistSelectedTeam && team?.source === "ephemeral") {
        scheduleSessionRecentTeamSelectionSync(team);
        return;
      }

      persistSelectedTeamShadowCache(team, theme);
      scheduleSessionRecentTeamSelectionSync(team);
    },
    [
      onPersistSelectedTeam,
      resolveCurrentSelection,
      scheduleSessionRecentTeamSelectionSync,
      scopeKey,
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
