import { useCallback, type MutableRefObject, type ReactNode } from "react";
import type { WorkspaceHandleSend } from "./useWorkspaceSendActions";
import {
  renderWorkspaceGeneralWorkbenchSidebarRuntime,
  type RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams,
} from "./WorkspaceGeneralWorkbenchSidebarRuntime";
import { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./useWorkspaceGeneralWorkbenchSidebarRuntime";
import type { useWorkspaceGeneralWorkbenchScaffoldRuntime } from "./useWorkspaceGeneralWorkbenchScaffoldRuntime";
import type { WorkspaceConversationRightSurfaceChromeRuntime } from "./workspaceConversationRightSurfaceChrome";

type GeneralWorkbenchScaffoldRuntime = ReturnType<
  typeof useWorkspaceGeneralWorkbenchScaffoldRuntime
>;
type RenderGeneralWorkbenchSidebarNodeParams = {
  rightSurfaceChrome: Pick<
    WorkspaceConversationRightSurfaceChromeRuntime,
    "harnessPanelVisible" | "onToggleHarnessPanel"
  >;
};

interface UseWorkspaceGeneralWorkbenchSidebarHostRuntimeParams {
  generalWorkbenchHarnessSummary: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["generalWorkbenchHarnessSummary"];
  generalWorkbenchScaffoldRuntime: GeneralWorkbenchScaffoldRuntime;
  handleSendRef: MutableRefObject<WorkspaceHandleSend>;
  historyPageSize: number;
  isSending: boolean;
  isThemeWorkbench: boolean;
  messages: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["messages"];
  onAddImage: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onAddImage"];
  onApplyFollowUpAction: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onApplyFollowUpAction"];
  onCreateVersionSnapshot: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onCreateVersionSnapshot"];
  onImportDocument: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onImportDocument"];
  onSetBranchStatus: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onSetBranchStatus"];
  onSwitchBranchVersion: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["onSwitchBranchVersion"];
  projectId?: RenderWorkspaceGeneralWorkbenchSidebarRuntimeParams["projectId"];
  sessionId?: string | null;
  sidebarVisible: boolean;
  themeWorkbenchBackendRunState: Parameters<
    typeof useWorkspaceGeneralWorkbenchSidebarRuntime
  >[0]["themeWorkbenchBackendRunState"];
}

export function useWorkspaceGeneralWorkbenchSidebarHostRuntime({
  generalWorkbenchHarnessSummary,
  generalWorkbenchScaffoldRuntime,
  handleSendRef,
  historyPageSize,
  isSending,
  isThemeWorkbench,
  messages,
  onAddImage,
  onApplyFollowUpAction,
  onCreateVersionSnapshot,
  onImportDocument,
  onSetBranchStatus,
  onSwitchBranchVersion,
  projectId,
  sessionId,
  sidebarVisible,
  themeWorkbenchBackendRunState,
}: UseWorkspaceGeneralWorkbenchSidebarHostRuntimeParams) {
  const generalWorkbenchSidebarRuntime =
    useWorkspaceGeneralWorkbenchSidebarRuntime({
      isThemeWorkbench,
      sidebarVisible,
      sessionId,
      messages,
      isSending,
      themeWorkbenchBackendRunState,
      historyPageSize,
    });
  const handleDeleteGeneralWorkbenchVersion = useCallback(() => undefined, []);
  const handleCollapseGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(true);
  }, [generalWorkbenchScaffoldRuntime]);
  const handleExpandGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(false);
  }, [generalWorkbenchScaffoldRuntime]);
  const handleIgnoreHarnessToggle = useCallback(() => undefined, []);
  const handleSubmitCodeFixPrompt = useCallback(
    async (prompt: string) => {
      const normalizedPrompt = prompt.trim();
      if (!normalizedPrompt) {
        return;
      }

      await handleSendRef.current(
        [],
        undefined,
        undefined,
        normalizedPrompt,
        "react",
        undefined,
        {
          skipSceneCommandRouting: true,
          displayContent: normalizedPrompt,
          requestMetadata: {
            harness: {
              code_fix: {
                source: "failed_output",
              },
            },
          },
        },
      );
    },
    [handleSendRef],
  );

  const renderGeneralWorkbenchSidebarNode = useCallback(
    ({
      rightSurfaceChrome,
    }: RenderGeneralWorkbenchSidebarNodeParams): ReactNode =>
      renderWorkspaceGeneralWorkbenchSidebarRuntime({
        generalWorkbenchHarnessSummary,
        generalWorkbenchScaffoldRuntime,
        generalWorkbenchSidebarRuntime,
        harnessPanelVisible: rightSurfaceChrome.harnessPanelVisible,
        isThemeWorkbench,
        messages,
        projectId,
        sessionId,
        visible: sidebarVisible,
        onAddImage,
        onApplyFollowUpAction,
        onCreateVersionSnapshot,
        onDeleteTopic: handleDeleteGeneralWorkbenchVersion,
        onImportDocument,
        onRequestCollapse: handleCollapseGeneralWorkbenchSidebar,
        onSetBranchStatus,
        onSwitchBranchVersion,
        onToggleHarnessPanel:
          rightSurfaceChrome.onToggleHarnessPanel ?? handleIgnoreHarnessToggle,
      }),
    [
      generalWorkbenchHarnessSummary,
      generalWorkbenchScaffoldRuntime,
      generalWorkbenchSidebarRuntime,
      handleCollapseGeneralWorkbenchSidebar,
      handleDeleteGeneralWorkbenchVersion,
      handleIgnoreHarnessToggle,
      isThemeWorkbench,
      messages,
      onAddImage,
      onApplyFollowUpAction,
      onCreateVersionSnapshot,
      onImportDocument,
      onSetBranchStatus,
      onSwitchBranchVersion,
      projectId,
      sessionId,
      sidebarVisible,
    ],
  );

  return {
    generalWorkbenchActivityLogs:
      generalWorkbenchSidebarRuntime.generalWorkbenchActivityLogs,
    generalWorkbenchWorkflowSteps:
      generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
    handleExpandGeneralWorkbenchSidebar,
    handleSubmitCodeFixPrompt,
    renderGeneralWorkbenchSidebarNode,
  };
}
