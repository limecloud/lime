import type { ComponentProps } from "react";
import { GeneralWorkbenchContextPanel } from "./GeneralWorkbenchContextPanel";
import { GeneralWorkbenchExecLog } from "./GeneralWorkbenchExecLog";
import { GeneralWorkbenchWorkflowPanel } from "./GeneralWorkbenchWorkflowPanel";

export type GeneralWorkbenchSidebarContextPanelProps = ComponentProps<
  typeof GeneralWorkbenchContextPanel
>;

export type GeneralWorkbenchSidebarWorkflowPanelProps = ComponentProps<
  typeof GeneralWorkbenchWorkflowPanel
>;

export type GeneralWorkbenchSidebarExecLogProps = ComponentProps<
  typeof GeneralWorkbenchExecLog
>;

export interface GeneralWorkbenchSidebarContentProps {
  contextPanelProps: GeneralWorkbenchSidebarContextPanelProps;
  workflowPanelProps: GeneralWorkbenchSidebarWorkflowPanelProps;
  execLogProps: GeneralWorkbenchSidebarExecLogProps;
}
