import { useCallback, useMemo, useState } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import {
  buildGeneralWorkbenchActivityLogGroups,
  buildGeneralWorkbenchCreationTaskGroups,
  formatGeneralWorkbenchRunMetadata,
  formatGeneralWorkbenchStagesLabel,
  parseGeneralWorkbenchRunMetadataSummary,
  type GeneralWorkbenchCreationTaskEvent,
  type GeneralWorkbenchRunMetadataSummary,
} from "./generalWorkbenchWorkflowData";

interface UseGeneralWorkbenchWorkflowPanelStateParams {
  workflowSteps: Array<{ id: string; title: string; status: StepStatus }>;
  activityLogs: SidebarActivityLog[];
  creationTaskEvents: GeneralWorkbenchCreationTaskEvent[];
  activeRunMetadata: string | null;
}

export interface GeneralWorkbenchWorkflowPanelState {
  completedSteps: number;
  progressPercent: number;
  groupedActivityLogs: ReturnType<
    typeof buildGeneralWorkbenchActivityLogGroups
  >;
  groupedCreationTaskEvents: ReturnType<
    typeof buildGeneralWorkbenchCreationTaskGroups
  >;
  activeRunStagesLabel: string | null;
  runMetadataText: string;
  runMetadataSummary: GeneralWorkbenchRunMetadataSummary;
  showActivityLogs: boolean;
  showCreationTasks: boolean;
  toggleActivityLogs: () => void;
  toggleCreationTasks: () => void;
}

export function useGeneralWorkbenchWorkflowPanelState({
  workflowSteps,
  activityLogs,
  creationTaskEvents,
  activeRunMetadata,
}: UseGeneralWorkbenchWorkflowPanelStateParams): GeneralWorkbenchWorkflowPanelState {
  const [showActivityLogs, setShowActivityLogs] = useState(false);
  const [showCreationTasks, setShowCreationTasks] = useState(false);

  const completedSteps = useMemo(
    () => workflowSteps.filter((step) => step.status === "completed").length,
    [workflowSteps],
  );

  const progressPercent =
    workflowSteps.length > 0
      ? (completedSteps / workflowSteps.length) * 100
      : 0;

  const groupedActivityLogs = useMemo(
    () => buildGeneralWorkbenchActivityLogGroups(activityLogs),
    [activityLogs],
  );

  const groupedCreationTaskEvents = useMemo(
    () => buildGeneralWorkbenchCreationTaskGroups(creationTaskEvents),
    [creationTaskEvents],
  );

  const runMetadataSummary = useMemo(
    () => parseGeneralWorkbenchRunMetadataSummary(activeRunMetadata),
    [activeRunMetadata],
  );

  const runMetadataText = useMemo(
    () => formatGeneralWorkbenchRunMetadata(activeRunMetadata),
    [activeRunMetadata],
  );

  const activeRunStagesLabel = useMemo(
    () => formatGeneralWorkbenchStagesLabel(runMetadataSummary.stages),
    [runMetadataSummary.stages],
  );

  const toggleActivityLogs = useCallback(() => {
    setShowActivityLogs((previous) => !previous);
  }, []);

  const toggleCreationTasks = useCallback(() => {
    setShowCreationTasks((previous) => !previous);
  }, []);

  return {
    completedSteps,
    progressPercent,
    groupedActivityLogs,
    groupedCreationTaskEvents,
    activeRunStagesLabel,
    runMetadataText,
    runMetadataSummary,
    showActivityLogs,
    showCreationTasks,
    toggleActivityLogs,
    toggleCreationTasks,
  };
}
