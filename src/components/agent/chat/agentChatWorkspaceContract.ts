import type { CreationMode } from "./components/types";
import type { MessageImage } from "./types";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import type { AgentLocation, Page, PageParams } from "@/types/page";
import type {
  AgentInitialInputCapabilityParams,
  ExpertAgentLaunchParams,
  AgentPendingServiceSkillLaunchParams,
  AgentProjectFileOpenTarget,
  AgentSiteSkillLaunchParams,
} from "@/types/page";

export interface WorkflowProgressSnapshot {
  steps: Array<{
    id: string;
    title: string;
    status: StepStatus;
  }>;
  currentIndex: number;
}

export type AgentBackgroundSessionRuntimeStatus =
  | "running"
  | "queued"
  | "waiting";

export interface AgentBackgroundSessionRuntimeSnapshot {
  sessionId: string;
  status: AgentBackgroundSessionRuntimeStatus;
}

export interface AgentChatWorkspaceProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  initialSessionId?: string;
  initialRequestMetadata?: Record<string, unknown>;
  initialAutoSendRequestMetadata?: Record<string, unknown>;
  autoRunInitialPromptOnMount?: boolean;
  agentEntry?: "new-task" | "conversation";
  immersiveHome?: boolean;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
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
  newConversationRequest?: import("@/lib/workspace/navigation").NewConversationRequest;
  onStartNewConversation?: import("@/lib/workspace/navigation").StartNewConversation;
  expertAgentLaunch?: ExpertAgentLaunchParams;
  onHasMessagesChange?: (hasMessages: boolean) => void;
  onLocationChange?: (location: AgentLocation) => void;
  onAgentStreamingChange?: (isStreaming: boolean) => void;
  onBackgroundSessionRuntimeChange?: (
    snapshot: AgentBackgroundSessionRuntimeSnapshot | null,
  ) => void;
  preferContentReviewInRightRail?: boolean;
  openBrowserAssistOnMount?: boolean;
  initialSiteSkillLaunch?: AgentSiteSkillLaunchParams;
  initialPendingServiceSkillLaunch?: AgentPendingServiceSkillLaunchParams;
  initialInputCapability?: AgentInitialInputCapabilityParams;
  preferHomeForInitialInputCapability?: boolean;
  initialProjectFileOpenTarget?: AgentProjectFileOpenTarget;
}
