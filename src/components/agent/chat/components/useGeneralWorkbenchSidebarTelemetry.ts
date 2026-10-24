import { useEffect, useRef } from "react";
import { logRenderPerf } from "@/lib/perfDebug";
import type { GeneralWorkbenchSidebarTab } from "./GeneralWorkbenchSidebarShell";

interface UseGeneralWorkbenchSidebarTelemetryParams {
  activeTab: GeneralWorkbenchSidebarTab;
  showActivityLogs: boolean;
  branchItemsCount: number;
  workflowStepsCount: number;
  activityLogsCount: number;
  creationTaskEventsCount: number;
  hasActiveRunDetail: boolean;
}

export function useGeneralWorkbenchSidebarTelemetry({
  activeTab,
  showActivityLogs,
  branchItemsCount,
  workflowStepsCount,
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
        branchItemsCount,
        workflowStepsCount,
        activityLogsCount,
        creationTaskEventsCount,
        hasActiveRunDetail,
      },
    );
  });
}
