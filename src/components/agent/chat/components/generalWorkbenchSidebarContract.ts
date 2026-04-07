import type { ReactNode } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { AgentRun } from "@/lib/api/executionRun";
import type {
  TopicBranchItem,
  TopicBranchStatus,
} from "../hooks/useTopicBranchBoard";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import type { Message } from "../types";
import type {
  GeneralWorkbenchContextBudget,
  GeneralWorkbenchContextItem,
} from "./generalWorkbenchContextData";
import type { GeneralWorkbenchCreationTaskEvent } from "./generalWorkbenchWorkflowData";
import type {
  GeneralWorkbenchAddFileContextAction,
  GeneralWorkbenchAddLinkContextAction,
  GeneralWorkbenchAddTextContextAction,
} from "./useGeneralWorkbenchContextPanelState";

export type BranchMode = "topic" | "version";

export interface GeneralWorkbenchSidebarShellContract {
  branchMode?: BranchMode;
  onRequestCollapse?: () => void;
  headerActionSlot?: ReactNode;
  topSlot?: ReactNode;
}

export interface GeneralWorkbenchSidebarWorkflowContract {
  onNewTopic: () => void;
  onSwitchTopic: (topicId: string) => void;
  onDeleteTopic: (topicId: string) => void;
  branchItems: TopicBranchItem[];
  onSetBranchStatus: (topicId: string, status: TopicBranchStatus) => void;
  workflowSteps: Array<{ id: string; title: string; status: StepStatus }>;
  onAddImage?: () => Promise<void> | void;
  onImportDocument?: () => Promise<void> | void;
  activityLogs: SidebarActivityLog[];
  creationTaskEvents?: GeneralWorkbenchCreationTaskEvent[];
  onViewRunDetail?: (runId: string) => void;
  activeRunDetail?: AgentRun | null;
  activeRunDetailLoading?: boolean;
}

export interface GeneralWorkbenchSidebarContextContract {
  contextSearchQuery: string;
  onContextSearchQueryChange: (value: string) => void;
  contextSearchMode: "web" | "social";
  onContextSearchModeChange: (value: "web" | "social") => void;
  contextSearchLoading: boolean;
  contextSearchError?: string | null;
  contextSearchBlockedReason?: string | null;
  onSubmitContextSearch: () => Promise<void> | void;
  onAddTextContext?: GeneralWorkbenchAddTextContextAction;
  onAddLinkContext?: GeneralWorkbenchAddLinkContextAction;
  onAddFileContext?: GeneralWorkbenchAddFileContextAction;
  contextItems: GeneralWorkbenchContextItem[];
  onToggleContextActive: (contextId: string) => void;
  onViewContextDetail?: (contextId: string) => void;
  contextBudget: GeneralWorkbenchContextBudget;
}

export interface GeneralWorkbenchSidebarExecLogContract {
  historyHasMore?: boolean;
  historyLoading?: boolean;
  onLoadMoreHistory?: () => void;
  skillDetailMap?: Record<string, SkillDetailInfo | null>;
  messages?: Message[];
}

export interface GeneralWorkbenchSidebarProps
  extends
    GeneralWorkbenchSidebarShellContract,
    GeneralWorkbenchSidebarWorkflowContract,
    GeneralWorkbenchSidebarContextContract,
    GeneralWorkbenchSidebarExecLogContract {}
