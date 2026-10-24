import { useCallback, useMemo, useState } from "react";
import type { SidebarActivityLog } from "./generalWorkbenchWorkflowData";
import { type GeneralWorkbenchCreationTaskEvent } from "./generalWorkbenchWorkflowData";
import {
  buildGeneralWorkbenchWorkflowPanelViewModel,
  type GeneralWorkbenchWorkflowPanelViewModel,
  type GeneralWorkbenchWorkflowStepInput,
} from "./generalWorkbenchWorkflowPanelViewModel";

interface UseGeneralWorkbenchWorkflowPanelStateParams {
  workflowSteps: GeneralWorkbenchWorkflowStepInput[];
  activityLogs: SidebarActivityLog[];
  creationTaskEvents: GeneralWorkbenchCreationTaskEvent[];
  activeRunMetadata: string | null;
}

export interface GeneralWorkbenchWorkflowPanelState extends GeneralWorkbenchWorkflowPanelViewModel {
  showActivityLogs: boolean;
  showBranchRecords: boolean;
  showCreationTasks: boolean;
  toggleActivityLogs: () => void;
  toggleBranchRecords: () => void;
  toggleCreationTasks: () => void;
}

export function useGeneralWorkbenchWorkflowPanelState({
  workflowSteps,
  activityLogs,
  creationTaskEvents,
  activeRunMetadata,
}: UseGeneralWorkbenchWorkflowPanelStateParams): GeneralWorkbenchWorkflowPanelState {
  const [showActivityLogs, setShowActivityLogs] = useState(false);
  const [showBranchRecords, setShowBranchRecords] = useState(false);
  const [showCreationTasks, setShowCreationTasks] = useState(false);

  const viewModel = useMemo(
    () =>
      buildGeneralWorkbenchWorkflowPanelViewModel({
        workflowSteps,
        activityLogs,
        creationTaskEvents,
        activeRunMetadata,
      }),
    [activeRunMetadata, activityLogs, creationTaskEvents, workflowSteps],
  );

  const toggleActivityLogs = useCallback(() => {
    setShowActivityLogs((previous) => !previous);
  }, []);

  const toggleBranchRecords = useCallback(() => {
    setShowBranchRecords((previous) => !previous);
  }, []);

  const toggleCreationTasks = useCallback(() => {
    setShowCreationTasks((previous) => !previous);
  }, []);

  return {
    ...viewModel,
    showActivityLogs,
    showBranchRecords,
    showCreationTasks,
    toggleActivityLogs,
    toggleBranchRecords,
    toggleCreationTasks,
  };
}
