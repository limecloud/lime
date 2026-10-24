import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { SidebarActivityLog } from "./generalWorkbenchWorkflowData";
import type { Message } from "../types";
import type { BuildGeneralWorkbenchExecLogPropsParams } from "./buildGeneralWorkbenchExecLogProps";
import type { BuildGeneralWorkbenchWorkflowPanelPropsParams } from "./buildGeneralWorkbenchWorkflowPanelProps";
import type { GeneralWorkbenchCreationTaskEvent } from "./generalWorkbenchWorkflowData";
export interface GeneralWorkbenchSidebarWorkflowOrchestrationInput extends Omit<
  BuildGeneralWorkbenchWorkflowPanelPropsParams,
  | "creationTaskEventsCount"
  | "isVersionMode"
  | "onOpenArtifactWithDefaultApp"
  | "onRevealArtifactInFinder"
  | "workflowPanelState"
> {
  activityLogs: SidebarActivityLog[];
  creationTaskEvents: GeneralWorkbenchCreationTaskEvent[];
}

export interface GeneralWorkbenchSidebarExecLogOrchestrationInput extends Omit<
  BuildGeneralWorkbenchExecLogPropsParams,
  "execLogState"
> {
  messages: Message[];
  skillDetailMap: Record<string, SkillDetailInfo | null>;
}

export interface GeneralWorkbenchSidebarOrchestrationInput {
  isVersionMode: boolean;
  workflow: GeneralWorkbenchSidebarWorkflowOrchestrationInput;
  execLog: GeneralWorkbenchSidebarExecLogOrchestrationInput;
}

export interface GeneralWorkbenchSidebarWorkflowOrchestrationSource extends Omit<
  GeneralWorkbenchSidebarWorkflowOrchestrationInput,
  "creationTaskEvents"
> {
  creationTaskEvents?: GeneralWorkbenchCreationTaskEvent[];
}

export interface GeneralWorkbenchSidebarExecLogOrchestrationSource extends Omit<
  GeneralWorkbenchSidebarExecLogOrchestrationInput,
  "messages" | "skillDetailMap"
> {
  messages?: Message[];
  skillDetailMap?: Record<string, SkillDetailInfo | null>;
}

export interface GeneralWorkbenchSidebarOrchestrationSource {
  isVersionMode: boolean;
  workflow: GeneralWorkbenchSidebarWorkflowOrchestrationSource;
  execLog: GeneralWorkbenchSidebarExecLogOrchestrationSource;
}

export function createGeneralWorkbenchSidebarOrchestrationInput(
  source: GeneralWorkbenchSidebarOrchestrationSource,
): GeneralWorkbenchSidebarOrchestrationInput {
  const { isVersionMode, workflow, execLog } = source;
  const { creationTaskEvents = [], activeRunDetailLoading = false } = workflow;
  const {
    historyHasMore = false,
    historyLoading = false,
    messages = [],
    skillDetailMap = {},
  } = execLog;

  return {
    isVersionMode,
    workflow: {
      ...workflow,
      activeRunDetailLoading,
      creationTaskEvents,
    },
    execLog: {
      ...execLog,
      historyHasMore,
      historyLoading,
      messages,
      skillDetailMap,
    },
  };
}
