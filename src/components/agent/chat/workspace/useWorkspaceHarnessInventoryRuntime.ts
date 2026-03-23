import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAgentRuntimeToolInventory,
  type AgentRuntimeToolInventory,
} from "@/lib/api/agentRuntime";
import type {
  ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
  ThemeWorkbenchRunTerminalItem,
  ThemeWorkbenchRunTodoItem,
} from "@/lib/api/executionRun";

interface UseWorkspaceHarnessInventoryRuntimeParams {
  chatMode: "agent" | "general" | "creator";
  mappedTheme: string;
  harnessPanelVisible: boolean;
  harnessRequestMetadata: Record<string, unknown>;
  isThemeWorkbench: boolean;
  themeWorkbenchRunState: "idle" | "auto_running" | "await_user_decision";
  currentGate: {
    title: string;
    description: string;
  };
  themeWorkbenchBackendRunState: BackendThemeWorkbenchRunState | null;
  themeWorkbenchActiveQueueItem: ThemeWorkbenchRunTodoItem | null | undefined;
  harnessPendingCount: number;
}

export function useWorkspaceHarnessInventoryRuntime({
  chatMode,
  mappedTheme,
  harnessPanelVisible,
  harnessRequestMetadata,
  isThemeWorkbench,
  themeWorkbenchRunState,
  currentGate,
  themeWorkbenchBackendRunState,
  themeWorkbenchActiveQueueItem,
  harnessPendingCount,
}: UseWorkspaceHarnessInventoryRuntimeParams) {
  const [toolInventory, setToolInventory] =
    useState<AgentRuntimeToolInventory | null>(null);
  const [toolInventoryLoading, setToolInventoryLoading] = useState(false);
  const [toolInventoryError, setToolInventoryError] = useState<string | null>(
    null,
  );
  const toolInventoryRequestIdRef = useRef(0);

  const refreshToolInventory = useCallback(async () => {
    const requestId = toolInventoryRequestIdRef.current + 1;
    toolInventoryRequestIdRef.current = requestId;
    setToolInventoryLoading(true);
    setToolInventoryError(null);

    try {
      const nextInventory = await getAgentRuntimeToolInventory({
        caller: "assistant",
        creator: chatMode === "creator",
        browserAssist: mappedTheme === "general",
        metadata: {
          harness: harnessRequestMetadata,
        },
      });

      if (toolInventoryRequestIdRef.current !== requestId) {
        return;
      }

      setToolInventory(nextInventory);
    } catch (error) {
      if (toolInventoryRequestIdRef.current !== requestId) {
        return;
      }

      setToolInventoryError(
        error instanceof Error ? error.message : "读取工具库存失败",
      );
    } finally {
      if (toolInventoryRequestIdRef.current === requestId) {
        setToolInventoryLoading(false);
      }
    }
  }, [chatMode, harnessRequestMetadata, mappedTheme]);

  useEffect(() => {
    if (!harnessPanelVisible) {
      return;
    }

    void refreshToolInventory();
  }, [harnessPanelVisible, refreshToolInventory]);

  const socialMediaHarnessSummary = useMemo(() => {
    if (!isThemeWorkbench || mappedTheme !== "social-media") {
      return null;
    }

    const latestTerminal: ThemeWorkbenchRunTerminalItem | null =
      themeWorkbenchBackendRunState?.latest_terminal ?? null;
    const activeRun = themeWorkbenchActiveQueueItem ?? latestTerminal;
    const artifactPaths =
      Array.isArray(themeWorkbenchActiveQueueItem?.artifact_paths) &&
      themeWorkbenchActiveQueueItem.artifact_paths.length > 0
        ? themeWorkbenchActiveQueueItem.artifact_paths
        : Array.isArray(latestTerminal?.artifact_paths) &&
            latestTerminal.artifact_paths.length > 0
          ? latestTerminal.artifact_paths
          : [];

    return {
      runState: themeWorkbenchRunState,
      stageTitle: currentGate.title,
      stageDescription: currentGate.description,
      runTitle: activeRun?.title || null,
      artifactCount: artifactPaths.length,
      updatedAt:
        themeWorkbenchBackendRunState?.updated_at ||
        latestTerminal?.finished_at ||
        latestTerminal?.started_at ||
        themeWorkbenchActiveQueueItem?.started_at ||
        null,
      pendingCount: harnessPendingCount,
    };
  }, [
    currentGate.description,
    currentGate.title,
    harnessPendingCount,
    isThemeWorkbench,
    mappedTheme,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchBackendRunState?.updated_at,
    themeWorkbenchRunState,
  ]);

  return {
    toolInventory,
    toolInventoryLoading,
    toolInventoryError,
    refreshToolInventory,
    socialMediaHarnessSummary,
  };
}
