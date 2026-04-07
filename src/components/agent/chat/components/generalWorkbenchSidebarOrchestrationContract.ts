import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import type { Message } from "../types";
import type { BuildGeneralWorkbenchContextPanelPropsParams } from "./buildGeneralWorkbenchContextPanelProps";
import type { BuildGeneralWorkbenchExecLogPropsParams } from "./buildGeneralWorkbenchExecLogProps";
import type { BuildGeneralWorkbenchWorkflowPanelPropsParams } from "./buildGeneralWorkbenchWorkflowPanelProps";
import type { GeneralWorkbenchCreationTaskEvent } from "./generalWorkbenchWorkflowData";
import type {
  GeneralWorkbenchAddFileContextAction,
  GeneralWorkbenchAddLinkContextAction,
  GeneralWorkbenchAddTextContextAction,
} from "./useGeneralWorkbenchContextPanelState";

export interface GeneralWorkbenchSidebarContextOrchestrationInput extends Omit<
  BuildGeneralWorkbenchContextPanelPropsParams,
  "contextPanelState"
> {
  onAddTextContext?: GeneralWorkbenchAddTextContextAction;
  onAddLinkContext?: GeneralWorkbenchAddLinkContextAction;
  onAddFileContext?: GeneralWorkbenchAddFileContextAction;
}

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
  context: GeneralWorkbenchSidebarContextOrchestrationInput;
  workflow: GeneralWorkbenchSidebarWorkflowOrchestrationInput;
  execLog: GeneralWorkbenchSidebarExecLogOrchestrationInput;
}

export type GeneralWorkbenchSidebarContextOrchestrationSource =
  GeneralWorkbenchSidebarContextOrchestrationInput;

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
  context: GeneralWorkbenchSidebarContextOrchestrationSource;
  workflow: GeneralWorkbenchSidebarWorkflowOrchestrationSource;
  execLog: GeneralWorkbenchSidebarExecLogOrchestrationSource;
}

export function createGeneralWorkbenchSidebarOrchestrationInput(
  source: GeneralWorkbenchSidebarOrchestrationSource,
): GeneralWorkbenchSidebarOrchestrationInput {
  const { isVersionMode, context, workflow, execLog } = source;
  const { creationTaskEvents = [], activeRunDetailLoading = false } = workflow;
  const {
    historyHasMore = false,
    historyLoading = false,
    messages = [],
    skillDetailMap = {},
  } = execLog;

  return {
    isVersionMode,
    context,
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
