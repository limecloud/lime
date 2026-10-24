import type { SidebarActivityLog } from "./generalWorkbenchWorkflowData";
import {
  buildGeneralWorkbenchActivityLogGroups,
  buildGeneralWorkbenchCreationTaskGroups,
  formatGeneralWorkbenchRunMetadata,
  formatGeneralWorkbenchStagesLabel,
  parseGeneralWorkbenchRunMetadataSummary,
  type GeneralWorkbenchCreationTaskEvent,
} from "./generalWorkbenchWorkflowData";
import {
  calculateWorkflowProgressPercent,
  countCompletedWorkflowSteps,
} from "./generalWorkbenchWorkflowProgressViewModel";
import type {
  GeneralWorkbenchWorkflowPanelViewModel,
  GeneralWorkbenchWorkflowStepInput,
} from "./generalWorkbenchWorkflowPanelTypes";

export function buildGeneralWorkbenchWorkflowPanelViewModel({
  workflowSteps,
  activityLogs,
  creationTaskEvents,
  activeRunMetadata,
}: {
  workflowSteps: GeneralWorkbenchWorkflowStepInput[];
  activityLogs: SidebarActivityLog[];
  creationTaskEvents: GeneralWorkbenchCreationTaskEvent[];
  activeRunMetadata: string | null;
}): GeneralWorkbenchWorkflowPanelViewModel {
  const completedSteps = countCompletedWorkflowSteps(workflowSteps);
  const runMetadataSummary =
    parseGeneralWorkbenchRunMetadataSummary(activeRunMetadata);

  return {
    completedSteps,
    progressPercent: calculateWorkflowProgressPercent({
      completedSteps,
      totalSteps: workflowSteps.length,
    }),
    groupedActivityLogs: buildGeneralWorkbenchActivityLogGroups(activityLogs),
    groupedCreationTaskEvents:
      buildGeneralWorkbenchCreationTaskGroups(creationTaskEvents),
    runMetadataSummary,
    runMetadataText: formatGeneralWorkbenchRunMetadata(activeRunMetadata),
    activeRunStagesLabel: formatGeneralWorkbenchStagesLabel(
      runMetadataSummary.stages,
    ),
  };
}
