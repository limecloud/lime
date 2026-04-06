import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import { GeneralWorkbenchSidebar } from "../components/GeneralWorkbenchSidebar";
import type {
  GeneralWorkbenchSidebarExecLogContract,
  GeneralWorkbenchSidebarProps,
} from "../components/generalWorkbenchSidebarContract";
import type { Message } from "../types";

type GeneralWorkbenchWorkflowProps = Pick<
  GeneralWorkbenchSidebarProps,
  | "branchMode"
  | "onNewTopic"
  | "onSwitchTopic"
  | "onDeleteTopic"
  | "branchItems"
  | "onSetBranchStatus"
  | "workflowSteps"
  | "onAddImage"
  | "onImportDocument"
  | "activityLogs"
  | "creationTaskEvents"
  | "onViewRunDetail"
  | "activeRunDetail"
  | "activeRunDetailLoading"
>;

type GeneralWorkbenchContextWorkspaceProps = {
  contextSearchQuery: GeneralWorkbenchSidebarProps["contextSearchQuery"];
  setContextSearchQuery: GeneralWorkbenchSidebarProps["onContextSearchQueryChange"];
  contextSearchMode: GeneralWorkbenchSidebarProps["contextSearchMode"];
  setContextSearchMode: GeneralWorkbenchSidebarProps["onContextSearchModeChange"];
  contextSearchLoading: GeneralWorkbenchSidebarProps["contextSearchLoading"];
  contextSearchError?: GeneralWorkbenchSidebarProps["contextSearchError"];
  contextSearchBlockedReason?: GeneralWorkbenchSidebarProps["contextSearchBlockedReason"];
  submitContextSearch: GeneralWorkbenchSidebarProps["onSubmitContextSearch"];
  addTextContext?: GeneralWorkbenchSidebarProps["onAddTextContext"];
  addLinkContext?: GeneralWorkbenchSidebarProps["onAddLinkContext"];
  addFileContext?: GeneralWorkbenchSidebarProps["onAddFileContext"];
  sidebarContextItems: GeneralWorkbenchSidebarProps["contextItems"];
  toggleContextActive: GeneralWorkbenchSidebarProps["onToggleContextActive"];
  contextBudget: GeneralWorkbenchSidebarProps["contextBudget"];
};

interface GeneralWorkbenchHistoryProps {
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: GeneralWorkbenchSidebarExecLogContract["onLoadMoreHistory"];
  skillDetailMap?: Record<string, SkillDetailInfo | null>;
  messages?: Message[];
}

interface GeneralWorkbenchSidebarSectionProps {
  visible: boolean;
  workflowProps: GeneralWorkbenchWorkflowProps;
  contextWorkspace: GeneralWorkbenchContextWorkspaceProps;
  onViewContextDetail?: GeneralWorkbenchSidebarProps["onViewContextDetail"];
  onRequestCollapse?: GeneralWorkbenchSidebarProps["onRequestCollapse"];
  headerActionSlot?: GeneralWorkbenchSidebarProps["headerActionSlot"];
  topSlot?: GeneralWorkbenchSidebarProps["topSlot"];
  historyProps?: GeneralWorkbenchHistoryProps;
}

export function GeneralWorkbenchSidebarSection({
  visible,
  workflowProps,
  contextWorkspace,
  onViewContextDetail,
  onRequestCollapse,
  headerActionSlot,
  topSlot,
  historyProps,
}: GeneralWorkbenchSidebarSectionProps) {
  if (!visible) {
    return null;
  }

  return (
    <GeneralWorkbenchSidebar
      {...workflowProps}
      branchMode={workflowProps.branchMode ?? "version"}
      contextSearchQuery={contextWorkspace.contextSearchQuery}
      onContextSearchQueryChange={contextWorkspace.setContextSearchQuery}
      contextSearchMode={contextWorkspace.contextSearchMode}
      onContextSearchModeChange={contextWorkspace.setContextSearchMode}
      contextSearchLoading={contextWorkspace.contextSearchLoading}
      contextSearchError={contextWorkspace.contextSearchError}
      contextSearchBlockedReason={contextWorkspace.contextSearchBlockedReason}
      onSubmitContextSearch={contextWorkspace.submitContextSearch}
      onAddTextContext={contextWorkspace.addTextContext}
      onAddLinkContext={contextWorkspace.addLinkContext}
      onAddFileContext={contextWorkspace.addFileContext}
      contextItems={contextWorkspace.sidebarContextItems}
      onToggleContextActive={contextWorkspace.toggleContextActive}
      onViewContextDetail={onViewContextDetail}
      contextBudget={contextWorkspace.contextBudget}
      onRequestCollapse={onRequestCollapse}
      headerActionSlot={headerActionSlot}
      topSlot={topSlot}
      historyHasMore={historyProps?.hasMore}
      historyLoading={historyProps?.loading}
      onLoadMoreHistory={historyProps?.onLoadMore}
      skillDetailMap={historyProps?.skillDetailMap}
      messages={historyProps?.messages}
    />
  );
}
