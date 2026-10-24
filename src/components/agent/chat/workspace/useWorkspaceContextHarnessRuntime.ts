import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectMemory } from "@/lib/api/projectMemory";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { Message } from "../types";
import { isSpecializedWorkbenchTheme } from "@/lib/workspace/workbenchContract";
import { collectConversationSkillNames } from "../utils/harnessSkills";
import {
  loadPersistedBoolean,
  savePersistedBoolean,
} from "./generalWorkbenchHelpers";

const HARNESS_PANEL_VISIBILITY_KEY = "lime.chat.harness-panel.visible.v1";

interface UseWorkspaceContextHarnessRuntimeParams {
  enabled: boolean;
  messages: Message[];
  mappedTheme: ThemeType;
  isSending: boolean;
  projectMemory: ProjectMemory | null;
  harnessState: {
    pendingApprovals: unknown[];
    hasSignals: boolean;
  };
}

export function useWorkspaceContextHarnessRuntime({
  enabled,
  messages,
  mappedTheme,
  isSending,
  projectMemory,
  harnessState,
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

  const workbenchEnabled = enabled;
  const harnessSkillNames = useMemo(
    () => (workbenchEnabled ? collectConversationSkillNames(messages) : []),
    [messages, workbenchEnabled],
  );
  const harnessPendingCount = workbenchEnabled
    ? harnessState.pendingApprovals.length
    : 0;
  const isGeneralWorkbenchEntry = mappedTheme === "general";
  const shouldAlwaysShowHarnessToggle =
    workbenchEnabled && isGeneralWorkbenchEntry;
  const hasHarnessActivity =
    workbenchEnabled &&
    (harnessPanelVisible ||
      isSending ||
      harnessPendingCount > 0 ||
      harnessState.hasSignals);
  const showHarnessToggle = shouldAlwaysShowHarnessToggle || hasHarnessActivity;
  const harnessAttentionLevel: "idle" | "active" | "warning" =
    harnessPendingCount > 0
      ? "warning"
      : hasHarnessActivity
        ? "active"
        : "idle";
  const navbarHarnessPanelVisible = workbenchEnabled && harnessPanelVisible;
  const harnessToggleLabel = workbenchEnabled ? "Harness" : undefined;
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
          }
        : {
            skillsCount: 0,
            skillNames: [],
            memorySignals: [],
          },
    [
      harnessSkillNames,
      projectMemory?.characters.length,
      projectMemory?.outline.length,
      projectMemory?.world_building,
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
    workbenchEnabled,
    isThemeWorkbench: isSpecializedWorkbenchTheme(mappedTheme),
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
