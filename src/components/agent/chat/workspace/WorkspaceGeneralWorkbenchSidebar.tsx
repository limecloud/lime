import type { ComponentProps } from "react";
import type { useThemeContextWorkspace } from "../hooks";
import { GeneralWorkbenchHarnessCard } from "../components/GeneralWorkbenchHarnessCard";
import { GeneralWorkbenchSidebarSection } from "./GeneralWorkbenchSidebarSection";

type GeneralWorkbenchSidebarSectionProps = ComponentProps<
  typeof GeneralWorkbenchSidebarSection
>;
type GeneralWorkbenchSidebarWorkflowProps =
  GeneralWorkbenchSidebarSectionProps["workflowProps"];
type GeneralWorkbenchSidebarHistoryProps = NonNullable<
  GeneralWorkbenchSidebarSectionProps["historyProps"]
>;
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
    GeneralWorkbenchSidebarSectionProps["onRequestCollapse"]
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
  onViewContextDetail?: GeneralWorkbenchSidebarSectionProps["onViewContextDetail"];
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

  return (
    <GeneralWorkbenchSidebarSection
      visible={visible}
      workflowProps={{
        branchMode: "version",
        onNewTopic: workflow.onCreateVersionSnapshot,
        onSwitchTopic: workflow.onSwitchBranchVersion,
        onDeleteTopic: workflow.onDeleteTopic,
        branchItems: workflow.branchItems,
        onSetBranchStatus: workflow.onSetBranchStatus,
        workflowSteps: workflow.workflowSteps,
        onAddImage: workflow.onAddImage,
        onImportDocument: workflow.onImportDocument,
        activityLogs: workflow.activityLogs,
        creationTaskEvents: workflow.creationTaskEvents,
        onViewRunDetail: workflow.onViewRunDetail,
        activeRunDetail: workflow.activeRunDetail,
        activeRunDetailLoading: workflow.activeRunDetailLoading,
      }}
      contextWorkspace={{
        contextSearchQuery: contextWorkspace.contextSearchQuery,
        setContextSearchQuery: contextWorkspace.setContextSearchQuery,
        contextSearchMode: contextWorkspace.contextSearchMode,
        setContextSearchMode: contextWorkspace.setContextSearchMode,
        contextSearchLoading: contextWorkspace.contextSearchLoading,
        contextSearchError: contextWorkspace.contextSearchError,
        contextSearchBlockedReason: contextWorkspace.contextSearchBlockedReason,
        submitContextSearch: contextWorkspace.submitContextSearch,
        addTextContext: contextWorkspace.addTextContext,
        addLinkContext: contextWorkspace.addLinkContext,
        addFileContext: contextWorkspace.addFileContext,
        sidebarContextItems: contextWorkspace.sidebarContextItems,
        toggleContextActive: contextWorkspace.toggleContextActive,
        contextBudget: contextWorkspace.contextBudget,
      }}
      onViewContextDetail={onViewContextDetail}
      onRequestCollapse={enablePanelCollapse ? onRequestCollapse : undefined}
      headerActionSlot={headerActionSlot}
      historyProps={{
        hasMore: history?.hasMore,
        loading: history?.loading,
        onLoadMore: history?.hasMore ? history.onLoadMore : undefined,
        skillDetailMap: history?.skillDetailMap,
        messages: history?.messages,
      }}
    />
  );
}
