import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectMemory } from "@/lib/api/memory";
import type { ThemeType } from "@/components/content-creator/types";
import type { Message } from "../types";
import { useThemeContextWorkspace } from "../hooks";
import { collectConversationSkillNames } from "../utils/harnessSkills";
import {
  loadPersistedBoolean,
  savePersistedBoolean,
} from "./themeWorkbenchHelpers";

const HARNESS_PANEL_VISIBILITY_KEY = "lime.chat.harness-panel.visible.v1";

interface UseWorkspaceContextHarnessRuntimeParams {
  projectId?: string;
  activeTheme: string;
  messages: Message[];
  providerType: string;
  model: string;
  mappedTheme: ThemeType;
  chatMode: "agent" | "general" | "creator";
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
  projectId,
  activeTheme,
  messages,
  providerType,
  model,
  mappedTheme,
  chatMode,
  isSending,
  projectMemory,
  harnessState,
  compatSubagentRuntime,
}: UseWorkspaceContextHarnessRuntimeParams) {
  const [harnessPanelVisible, setHarnessPanelVisible] = useState(() =>
    loadPersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, false),
  );

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
  const isThemeWorkbench = contextWorkspace.enabled;
  const harnessSkillNames = useMemo(
    () => collectConversationSkillNames(messages),
    [messages],
  );
  const harnessPendingCount = harnessState.pendingApprovals.length;
  const shouldAlwaysShowHarnessToggle =
    contextWorkspace.enabled && mappedTheme === "social-media";
  const shouldAlwaysShowGeneralWorkbenchToggle =
    chatMode === "general" && !contextWorkspace.enabled;
  const hasHarnessActivity =
    harnessPanelVisible ||
    harnessState.hasSignals ||
    compatSubagentRuntime.isRunning;
  const showHarnessToggle =
    shouldAlwaysShowHarnessToggle ||
    shouldAlwaysShowGeneralWorkbenchToggle ||
    hasHarnessActivity;
  const harnessAttentionLevel: "idle" | "active" | "warning" =
    harnessPendingCount > 0
      ? "warning"
      : hasHarnessActivity
        ? "active"
        : "idle";
  const navbarHarnessPanelVisible = harnessPanelVisible;
  const visibleContextItems = useMemo(() => {
    const activeItems = contextWorkspace.sidebarContextItems.filter(
      (item) => item.active,
    );
    return activeItems.length > 0
      ? activeItems
      : contextWorkspace.sidebarContextItems;
  }, [contextWorkspace.sidebarContextItems]);
  const harnessEnvironment = useMemo(
    () => ({
      skillsCount: harnessSkillNames.length,
      skillNames: harnessSkillNames.slice(0, 4),
      memorySignals: [
        projectMemory?.characters.length ? "角色" : null,
        projectMemory?.world_building ? "世界观" : null,
        projectMemory?.style_guide ? "风格" : null,
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
      contextEnabled: contextWorkspace.enabled,
    }),
    [
      contextWorkspace.enabled,
      contextWorkspace.sidebarContextItems,
      harnessSkillNames,
      projectMemory?.characters.length,
      projectMemory?.outline.length,
      projectMemory?.style_guide,
      projectMemory?.world_building,
      visibleContextItems,
    ],
  );
  const handleToggleHarnessPanel = useCallback(() => {
    setHarnessPanelVisible((current) => !current);
  }, []);
  const activeRuntimeStatusTitle = useMemo(() => {
    if (!isSending) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.runtimeStatus?.title) {
        return message.runtimeStatus.title;
      }
    }

    return "正在准备处理";
  }, [isSending, messages]);

  return {
    contextWorkspace,
    isThemeWorkbench,
    harnessPanelVisible,
    setHarnessPanelVisible,
    harnessPendingCount,
    showHarnessToggle,
    harnessAttentionLevel,
    navbarHarnessPanelVisible,
    harnessEnvironment,
    handleToggleHarnessPanel,
    activeRuntimeStatusTitle,
  };
}
