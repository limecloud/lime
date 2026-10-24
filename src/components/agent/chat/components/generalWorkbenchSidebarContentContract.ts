import type { ComponentProps } from "react";
import { GeneralWorkbenchExecLog } from "./GeneralWorkbenchExecLog";
import { GeneralWorkbenchWorkflowPanel } from "./GeneralWorkbenchWorkflowPanel";

export type GeneralWorkbenchSidebarWorkflowPanelProps = ComponentProps<
  typeof GeneralWorkbenchWorkflowPanel
>;

export type GeneralWorkbenchSidebarExecLogProps = ComponentProps<
  typeof GeneralWorkbenchExecLog
>;

export interface GeneralWorkbenchSidebarContentProps {
  workflowPanelProps: GeneralWorkbenchSidebarWorkflowPanelProps;
  execLogProps: GeneralWorkbenchSidebarExecLogProps;
}
