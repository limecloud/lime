import type { CreationMode } from "./components/types";
import type { MessageImage } from "./types";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { Page, PageParams } from "@/types/page";
import type {
  AgentInitialInputCapabilityParams,
  AgentInitialKnowledgePackSelectionParams,
  AgentPendingServiceSkillLaunchParams,
  AgentProjectFileOpenTarget,
  AgentSiteSkillLaunchParams,
} from "@/types/page";
import type { SceneAppExecutionSummaryViewModel } from "@/lib/sceneapp/product";

export interface WorkflowProgressSnapshot {
  steps: Array<{
    id: string;
    title: string;
    status: StepStatus;
  }>;
  currentIndex: number;
}

export interface AgentChatWorkspaceProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  initialSessionId?: string;
  initialSceneAppExecutionSummary?: SceneAppExecutionSummaryViewModel;
  initialRequestMetadata?: Record<string, unknown>;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  autoRunInitialPromptOnMount?: boolean;
  agentEntry?: "new-task" | "claw";
  immersiveHome?: boolean;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
  fromResources?: boolean;
  hideHistoryToggle?: boolean;
  showChatPanel?: boolean;
  hideTopBar?: boolean;
  topBarChrome?: "full" | "workspace-compact";
  onBackToProjectManagement?: () => void;
  hideInlineStepProgress?: boolean;
  onWorkflowProgressChange?: (
    snapshot: WorkflowProgressSnapshot | null,
  ) => void;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  initialSessionName?: string;
  entryBannerMessage?: string;
  onInitialUserPromptConsumed?: () => void;
  newChatAt?: number;
  onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
  onSessionChange?: (sessionId: string | null) => void;
  preferContentReviewInRightRail?: boolean;
  openBrowserAssistOnMount?: boolean;
  initialSiteSkillLaunch?: AgentSiteSkillLaunchParams;
  initialPendingServiceSkillLaunch?: AgentPendingServiceSkillLaunchParams;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  initialKnowledgePackSelection?: AgentInitialKnowledgePackSelectionParams;
  initialProjectFileOpenTarget?: AgentProjectFileOpenTarget;
}
