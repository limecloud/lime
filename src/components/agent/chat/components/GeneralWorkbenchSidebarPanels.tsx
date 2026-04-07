import { GeneralWorkbenchContextPanel } from "./GeneralWorkbenchContextPanel";
import { GeneralWorkbenchExecLog } from "./GeneralWorkbenchExecLog";
import { GeneralWorkbenchWorkflowPanel } from "./GeneralWorkbenchWorkflowPanel";
import type { GeneralWorkbenchSidebarTab } from "./GeneralWorkbenchSidebarShell";
import type { GeneralWorkbenchSidebarContentProps } from "./generalWorkbenchSidebarContentContract";

export interface GeneralWorkbenchSidebarPanelsProps extends GeneralWorkbenchSidebarContentProps {
  activeTab: GeneralWorkbenchSidebarTab;
}

export function GeneralWorkbenchSidebarPanels({
  activeTab,
  contextPanelProps,
  workflowPanelProps,
  execLogProps,
}: GeneralWorkbenchSidebarPanelsProps) {
  if (activeTab === "context") {
    return <GeneralWorkbenchContextPanel {...contextPanelProps} />;
  }
  if (activeTab === "workflow") {
    return <GeneralWorkbenchWorkflowPanel {...workflowPanelProps} />;
  }
  if (activeTab === "log") {
    return <GeneralWorkbenchExecLog {...execLogProps} />;
  }
  return null;
}
