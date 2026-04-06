import { useEffect, useRef } from "react";
import { logRenderPerf } from "@/lib/perfDebug";
import type { GeneralWorkbenchSidebarTab } from "./GeneralWorkbenchSidebarShell";

interface UseGeneralWorkbenchSidebarTelemetryParams {
  activeTab: GeneralWorkbenchSidebarTab;
  showActivityLogs: boolean;
  contextSearchLoading: boolean;
  branchItemsCount: number;
  workflowStepsCount: number;
  contextItemsCount: number;
  activeContextCount: number;
  activityLogsCount: number;
  creationTaskEventsCount: number;
  hasActiveRunDetail: boolean;
}

export function useGeneralWorkbenchSidebarTelemetry({
  activeTab,
  showActivityLogs,
  contextSearchLoading,
  branchItemsCount,
  workflowStepsCount,
  contextItemsCount,
  activeContextCount,
  activityLogsCount,
  creationTaskEventsCount,
  hasActiveRunDetail,
}: UseGeneralWorkbenchSidebarTelemetryParams) {
  const renderCountRef = useRef(0);
  const lastCommitAtRef = useRef<number | null>(null);
  renderCountRef.current += 1;

  useEffect(() => {
    const now = performance.now();
    const sinceLastCommitMs =
      lastCommitAtRef.current === null ? null : now - lastCommitAtRef.current;
    lastCommitAtRef.current = now;
    logRenderPerf(
      "GeneralWorkbenchSidebar",
      renderCountRef.current,
      sinceLastCommitMs,
      {
        activeTab,
        showActivityLogs,
        contextSearchLoading,
        branchItemsCount,
        workflowStepsCount,
        contextItemsCount,
        activeContextCount,
        activityLogsCount,
        creationTaskEventsCount,
        hasActiveRunDetail,
      },
    );
  });
}
