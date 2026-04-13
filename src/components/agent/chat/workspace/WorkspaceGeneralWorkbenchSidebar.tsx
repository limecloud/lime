import type { ComponentProps } from "react";
import type { useThemeContextWorkspace } from "../hooks";
import { GeneralWorkbenchHarnessCard } from "../components/GeneralWorkbenchHarnessCard";
import { GeneralWorkbenchSidebar } from "../components/GeneralWorkbenchSidebar";
import type {
  GeneralWorkbenchSidebarExecLogContract,
  GeneralWorkbenchSidebarProps,
} from "../components/generalWorkbenchSidebarContract";
import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { Message } from "../types";

type GeneralWorkbenchSidebarWorkflowProps = Pick<
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
type GeneralWorkbenchSidebarHistoryProps = {
  hasMore?: boolean;
  loading?: boolean;
  onLoadMore?: GeneralWorkbenchSidebarExecLogContract["onLoadMoreHistory"];
  skillDetailMap?: Record<string, SkillDetailInfo | null>;
  messages?: Message[];
};
type GeneralWorkbenchHarnessSummary = Pick<
  ComponentProps<typeof GeneralWorkbenchHarnessCard>,
  | "runState"
  | "stageTitle"
  | "stageDescription"
  | "runTitle"
  | "artifactCount"
  | "updatedAt"
  | "pendingCount"
>;

interface WorkspaceGeneralWorkbenchSidebarProps {
  visible: boolean;
  isThemeWorkbench: boolean;
  enablePanelCollapse: boolean;
  onRequestCollapse: NonNullable<
    GeneralWorkbenchSidebarProps["onRequestCollapse"]
  >;
  generalWorkbenchHarnessSummary: GeneralWorkbenchHarnessSummary | null;
  harnessPanelVisible: boolean;
  onToggleHarnessPanel: NonNullable<
    ComponentProps<typeof GeneralWorkbenchHarnessCard>["onToggleHarnessPanel"]
  >;
  workflow: {
    branchItems: GeneralWorkbenchSidebarWorkflowProps["branchItems"];
    onCreateVersionSnapshot: GeneralWorkbenchSidebarWorkflowProps["onNewTopic"];
    onSwitchBranchVersion: GeneralWorkbenchSidebarWorkflowProps["onSwitchTopic"];
    onDeleteTopic: GeneralWorkbenchSidebarWorkflowProps["onDeleteTopic"];
    onSetBranchStatus: GeneralWorkbenchSidebarWorkflowProps["onSetBranchStatus"];
    workflowSteps: GeneralWorkbenchSidebarWorkflowProps["workflowSteps"];
    onAddImage: GeneralWorkbenchSidebarWorkflowProps["onAddImage"];
    onImportDocument: GeneralWorkbenchSidebarWorkflowProps["onImportDocument"];
    activityLogs: GeneralWorkbenchSidebarWorkflowProps["activityLogs"];
    creationTaskEvents: GeneralWorkbenchSidebarWorkflowProps["creationTaskEvents"];
    onViewRunDetail: GeneralWorkbenchSidebarWorkflowProps["onViewRunDetail"];
    activeRunDetail: GeneralWorkbenchSidebarWorkflowProps["activeRunDetail"];
    activeRunDetailLoading: GeneralWorkbenchSidebarWorkflowProps["activeRunDetailLoading"];
  };
  contextWorkspace: ReturnType<typeof useThemeContextWorkspace>;
  onViewContextDetail?: GeneralWorkbenchSidebarProps["onViewContextDetail"];
  history?: {
    hasMore?: GeneralWorkbenchSidebarHistoryProps["hasMore"];
    loading?: GeneralWorkbenchSidebarHistoryProps["loading"];
    onLoadMore?: GeneralWorkbenchSidebarHistoryProps["onLoadMore"];
    skillDetailMap?: GeneralWorkbenchSidebarHistoryProps["skillDetailMap"];
    messages?: GeneralWorkbenchSidebarHistoryProps["messages"];
  };
}

export function WorkspaceGeneralWorkbenchSidebar({
  visible,
  isThemeWorkbench,
  enablePanelCollapse,
  onRequestCollapse,
  generalWorkbenchHarnessSummary,
  harnessPanelVisible,
  onToggleHarnessPanel,
  workflow,
  contextWorkspace,
  onViewContextDetail,
  history,
}: WorkspaceGeneralWorkbenchSidebarProps) {
  const headerActionSlot =
    isThemeWorkbench && generalWorkbenchHarnessSummary ? (
      <GeneralWorkbenchHarnessCard
        runState={generalWorkbenchHarnessSummary.runState}
        stageTitle={generalWorkbenchHarnessSummary.stageTitle}
        stageDescription={generalWorkbenchHarnessSummary.stageDescription}
        runTitle={generalWorkbenchHarnessSummary.runTitle}
        artifactCount={generalWorkbenchHarnessSummary.artifactCount}
        updatedAt={generalWorkbenchHarnessSummary.updatedAt}
        pendingCount={generalWorkbenchHarnessSummary.pendingCount}
        harnessPanelVisible={harnessPanelVisible}
        layout="icon"
        onToggleHarnessPanel={onToggleHarnessPanel}
      />
    ) : null;

  if (!visible) {
    return null;
  }

  return (
    <GeneralWorkbenchSidebar
      branchMode="version"
      onNewTopic={workflow.onCreateVersionSnapshot}
      onSwitchTopic={workflow.onSwitchBranchVersion}
      onDeleteTopic={workflow.onDeleteTopic}
      branchItems={workflow.branchItems}
      onSetBranchStatus={workflow.onSetBranchStatus}
      workflowSteps={workflow.workflowSteps}
      onAddImage={workflow.onAddImage}
      onImportDocument={workflow.onImportDocument}
      activityLogs={workflow.activityLogs}
      creationTaskEvents={workflow.creationTaskEvents}
      onViewRunDetail={workflow.onViewRunDetail}
      activeRunDetail={workflow.activeRunDetail}
      activeRunDetailLoading={workflow.activeRunDetailLoading}
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
      onRequestCollapse={enablePanelCollapse ? onRequestCollapse : undefined}
      headerActionSlot={headerActionSlot}
      historyHasMore={history?.hasMore}
      historyLoading={history?.loading}
      onLoadMoreHistory={history?.hasMore ? history.onLoadMore : undefined}
      skillDetailMap={history?.skillDetailMap}
      messages={history?.messages}
    />
  );
}
