import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectMemory } from "@/lib/api/memory";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { Message } from "../types";
import { useThemeContextWorkspace } from "../hooks";
import { collectConversationSkillNames } from "../utils/harnessSkills";
import {
  loadPersistedBoolean,
  savePersistedBoolean,
} from "./generalWorkbenchHelpers";

const HARNESS_PANEL_VISIBILITY_KEY = "lime.chat.harness-panel.visible.v1";

interface UseWorkspaceContextHarnessRuntimeParams {
  enabled: boolean;
  projectId?: string;
  activeTheme: string;
  messages: Message[];
  providerType: string;
  model: string;
  mappedTheme: ThemeType;
  isSending: boolean;
  projectMemory: ProjectMemory | null;
  harnessState: {
    pendingApprovals: unknown[];
    hasSignals: boolean;
  };
  compatSubagentRuntime: {
    isRunning: boolean;
  };
}

export function useWorkspaceContextHarnessRuntime({
  enabled,
  projectId,
  activeTheme,
  messages,
  providerType,
  model,
  isSending,
  projectMemory,
  harnessState,
  compatSubagentRuntime,
}: UseWorkspaceContextHarnessRuntimeParams) {
  const [harnessPanelVisible, setHarnessPanelVisible] = useState(() =>
    enabled ? loadPersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, false) : false,
  );

  useEffect(() => {
    if (!enabled && harnessPanelVisible) {
      setHarnessPanelVisible(false);
    }
  }, [enabled, harnessPanelVisible]);

  useEffect(() => {
    savePersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, harnessPanelVisible);
  }, [harnessPanelVisible]);

  const contextWorkspace = useThemeContextWorkspace({
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
  });
  const workbenchEnabled = enabled;
  const generalWorkbenchContextEnabled =
    contextWorkspace.generalWorkbenchEnabled;
  const harnessSkillNames = useMemo(
    () => (workbenchEnabled ? collectConversationSkillNames(messages) : []),
    [messages, workbenchEnabled],
  );
  const harnessPendingCount = workbenchEnabled
    ? harnessState.pendingApprovals.length
    : 0;
  const shouldAlwaysShowHarnessToggle =
    workbenchEnabled && generalWorkbenchContextEnabled;
  const hasHarnessActivity =
    workbenchEnabled &&
    (harnessPanelVisible ||
      isSending ||
      harnessPendingCount > 0 ||
      harnessState.hasSignals ||
      compatSubagentRuntime.isRunning);
  const showHarnessToggle = shouldAlwaysShowHarnessToggle || hasHarnessActivity;
  const harnessAttentionLevel: "idle" | "active" | "warning" =
    harnessPendingCount > 0
      ? "warning"
      : hasHarnessActivity
        ? "active"
        : "idle";
  const navbarHarnessPanelVisible = workbenchEnabled && harnessPanelVisible;
  const harnessToggleLabel = workbenchEnabled ? "工作台" : undefined;
  const visibleContextItems = useMemo(() => {
    if (!workbenchEnabled) {
      return [];
    }

    const activeItems = contextWorkspace.sidebarContextItems.filter(
      (item) => item.active,
    );
    return activeItems.length > 0
      ? activeItems
      : contextWorkspace.sidebarContextItems;
  }, [contextWorkspace.sidebarContextItems, workbenchEnabled]);
  const harnessEnvironment = useMemo(
    () =>
      workbenchEnabled
        ? {
            skillsCount: harnessSkillNames.length,
            skillNames: harnessSkillNames.slice(0, 4),
            memorySignals: [
              projectMemory?.characters.length ? "角色" : null,
              projectMemory?.world_building ? "世界观" : null,
              projectMemory?.outline.length ? "大纲" : null,
            ].filter((item): item is string => item !== null),
            contextItemsCount: contextWorkspace.sidebarContextItems.length,
            activeContextCount: contextWorkspace.sidebarContextItems.filter(
              (item) => item.active,
            ).length,
            contextItemNames: visibleContextItems
              .map((item) => item.name)
              .filter((name) => !!name.trim())
              .slice(0, 4),
            contextEnabled: generalWorkbenchContextEnabled,
          }
        : {
            skillsCount: 0,
            skillNames: [],
            memorySignals: [],
            contextItemsCount: 0,
            activeContextCount: 0,
            contextItemNames: [],
            contextEnabled: false,
          },
    [
      generalWorkbenchContextEnabled,
      contextWorkspace.sidebarContextItems,
      harnessSkillNames,
      projectMemory?.characters.length,
      projectMemory?.outline.length,
      projectMemory?.world_building,
      visibleContextItems,
      workbenchEnabled,
    ],
  );
  const handleToggleHarnessPanel = useCallback(() => {
    if (!workbenchEnabled) {
      return;
    }
    setHarnessPanelVisible((current) => !current);
  }, [workbenchEnabled]);
  const activeRuntimeStatusTitle = useMemo(() => {
    if (!workbenchEnabled || !isSending) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.runtimeStatus?.title) {
        return message.runtimeStatus.title;
      }
    }

    return "正在准备处理";
  }, [isSending, messages, workbenchEnabled]);

  return {
    contextWorkspace,
    workbenchEnabled,
    generalWorkbenchContextEnabled,
    isThemeWorkbench: generalWorkbenchContextEnabled,
    harnessPanelVisible,
    setHarnessPanelVisible,
    harnessPendingCount,
    showHarnessToggle,
    harnessAttentionLevel,
    navbarHarnessPanelVisible,
    harnessToggleLabel,
    harnessEnvironment,
    handleToggleHarnessPanel,
    activeRuntimeStatusTitle,
  };
}
