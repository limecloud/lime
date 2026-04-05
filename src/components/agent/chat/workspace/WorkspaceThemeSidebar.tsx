import type { ComponentProps } from "react";
import type { useThemeContextWorkspace } from "../hooks";
import { ThemeWorkbenchHarnessCard } from "../components/ThemeWorkbenchHarnessCard";
import { ThemeWorkbenchSidebarSection } from "./ThemeWorkbenchSidebarSection";

type ThemeWorkbenchSidebarSectionProps = ComponentProps<
  typeof ThemeWorkbenchSidebarSection
>;
type ThemeWorkbenchSidebarWorkflowProps =
  ThemeWorkbenchSidebarSectionProps["workflowProps"];
type ThemeWorkbenchSidebarHistoryProps = NonNullable<
  ThemeWorkbenchSidebarSectionProps["historyProps"]
>;
type ThemeWorkbenchHarnessSummary = Pick<
  ComponentProps<typeof ThemeWorkbenchHarnessCard>,
  | "runState"
  | "stageTitle"
  | "stageDescription"
  | "runTitle"
  | "artifactCount"
  | "updatedAt"
  | "pendingCount"
>;

interface WorkspaceThemeSidebarProps {
  visible: boolean;
  isThemeWorkbench: boolean;
  enablePanelCollapse: boolean;
  onRequestCollapse: NonNullable<
    ThemeWorkbenchSidebarSectionProps["onRequestCollapse"]
  >;
  themeWorkbenchHarnessSummary: ThemeWorkbenchHarnessSummary | null;
  harnessPanelVisible: boolean;
  onToggleHarnessPanel: NonNullable<
    ComponentProps<typeof ThemeWorkbenchHarnessCard>["onToggleHarnessPanel"]
  >;
  workflow: {
    branchItems: ThemeWorkbenchSidebarWorkflowProps["branchItems"];
    onCreateVersionSnapshot: ThemeWorkbenchSidebarWorkflowProps["onNewTopic"];
    onSwitchBranchVersion: ThemeWorkbenchSidebarWorkflowProps["onSwitchTopic"];
    onDeleteTopic: ThemeWorkbenchSidebarWorkflowProps["onDeleteTopic"];
    onSetBranchStatus: ThemeWorkbenchSidebarWorkflowProps["onSetBranchStatus"];
    workflowSteps: ThemeWorkbenchSidebarWorkflowProps["workflowSteps"];
    onAddImage: ThemeWorkbenchSidebarWorkflowProps["onAddImage"];
    onImportDocument: ThemeWorkbenchSidebarWorkflowProps["onImportDocument"];
    activityLogs: ThemeWorkbenchSidebarWorkflowProps["activityLogs"];
    creationTaskEvents: ThemeWorkbenchSidebarWorkflowProps["creationTaskEvents"];
    onViewRunDetail: ThemeWorkbenchSidebarWorkflowProps["onViewRunDetail"];
    activeRunDetail: ThemeWorkbenchSidebarWorkflowProps["activeRunDetail"];
    activeRunDetailLoading: ThemeWorkbenchSidebarWorkflowProps["activeRunDetailLoading"];
  };
  contextWorkspace: ReturnType<typeof useThemeContextWorkspace>;
  onViewContextDetail?: ThemeWorkbenchSidebarSectionProps["onViewContextDetail"];
  history?: {
    hasMore?: ThemeWorkbenchSidebarHistoryProps["hasMore"];
    loading?: ThemeWorkbenchSidebarHistoryProps["loading"];
    onLoadMore?: ThemeWorkbenchSidebarHistoryProps["onLoadMore"];
    skillDetailMap?: ThemeWorkbenchSidebarHistoryProps["skillDetailMap"];
    messages?: ThemeWorkbenchSidebarHistoryProps["messages"];
  };
}

export function WorkspaceThemeSidebar({
  visible,
  isThemeWorkbench,
  enablePanelCollapse,
  onRequestCollapse,
  themeWorkbenchHarnessSummary,
  harnessPanelVisible,
  onToggleHarnessPanel,
  workflow,
  contextWorkspace,
  onViewContextDetail,
  history,
}: WorkspaceThemeSidebarProps) {
  const headerActionSlot =
    isThemeWorkbench && themeWorkbenchHarnessSummary ? (
      <ThemeWorkbenchHarnessCard
        runState={themeWorkbenchHarnessSummary.runState}
        stageTitle={themeWorkbenchHarnessSummary.stageTitle}
        stageDescription={themeWorkbenchHarnessSummary.stageDescription}
        runTitle={themeWorkbenchHarnessSummary.runTitle}
        artifactCount={themeWorkbenchHarnessSummary.artifactCount}
        updatedAt={themeWorkbenchHarnessSummary.updatedAt}
        pendingCount={themeWorkbenchHarnessSummary.pendingCount}
        harnessPanelVisible={harnessPanelVisible}
        layout="icon"
        onToggleHarnessPanel={onToggleHarnessPanel}
      />
    ) : null;

  return (
    <ThemeWorkbenchSidebarSection
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
