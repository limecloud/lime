import { useCallback, type ComponentProps, type ReactNode } from "react";
import { WorkspaceGeneralWorkbenchSidebar } from "./WorkspaceGeneralWorkbenchSidebar";
import { GeneralWorkbenchHarnessDialogSection } from "./WorkspaceHarnessDialogs";

type WorkspaceGeneralWorkbenchSidebarProps = ComponentProps<
  typeof WorkspaceGeneralWorkbenchSidebar
>;

type GeneralWorkbenchSidebarWorkflowParams = Omit<
  WorkspaceGeneralWorkbenchSidebarProps["workflow"],
  "onDeleteTopic"
>;

interface UseGeneralWorkbenchSidebarPresentationParams {
  showChatPanel: boolean;
  showSidebar: boolean;
  hasPendingA2UIForm: boolean;
  isThemeWorkbench: boolean;
  shouldUseCompactGeneralWorkbench: boolean;
  enablePanelCollapse: boolean;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  sidebar: Omit<
    WorkspaceGeneralWorkbenchSidebarProps,
    | "visible"
    | "isThemeWorkbench"
    | "enablePanelCollapse"
    | "onRequestCollapse"
    | "workflow"
  > & {
    workflow: GeneralWorkbenchSidebarWorkflowParams;
  };
  harnessDialog: ComponentProps<typeof GeneralWorkbenchHarnessDialogSection>;
}

interface GeneralWorkbenchSidebarPresentationResult {
  generalWorkbenchHarnessDialog: ReactNode;
  generalWorkbenchSidebarNode: ReactNode;
  showGeneralWorkbenchLeftExpandButton: boolean;
  onExpandGeneralWorkbenchSidebar: () => void;
}

export function useGeneralWorkbenchSidebarPresentation({
  showChatPanel,
  showSidebar,
  hasPendingA2UIForm,
  isThemeWorkbench,
  shouldUseCompactGeneralWorkbench,
  enablePanelCollapse,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  sidebar,
  harnessDialog,
}: UseGeneralWorkbenchSidebarPresentationParams): GeneralWorkbenchSidebarPresentationResult {
  const shouldShowGeneralWorkbenchSidebarForTheme =
    !shouldUseCompactGeneralWorkbench;
  const showGeneralWorkbenchSidebar =
    showChatPanel &&
    showSidebar &&
    !hasPendingA2UIForm &&
    isThemeWorkbench &&
    shouldShowGeneralWorkbenchSidebarForTheme &&
    (!enablePanelCollapse || !sidebarCollapsed);
  const showGeneralWorkbenchLeftExpandButton =
    showChatPanel &&
    showSidebar &&
    !hasPendingA2UIForm &&
    isThemeWorkbench &&
    shouldShowGeneralWorkbenchSidebarForTheme &&
    enablePanelCollapse &&
    sidebarCollapsed;

  const handleGeneralWorkbenchDeleteTopic = useCallback(() => undefined, []);
  const handleGeneralWorkbenchSidebarCollapse = useCallback(() => {
    onSidebarCollapsedChange(true);
  }, [onSidebarCollapsedChange]);
  const handleExpandGeneralWorkbenchSidebar = useCallback(() => {
    onSidebarCollapsedChange(false);
  }, [onSidebarCollapsedChange]);

  return {
    generalWorkbenchHarnessDialog: (
      <GeneralWorkbenchHarnessDialogSection {...harnessDialog} />
    ),
    generalWorkbenchSidebarNode: (
      <WorkspaceGeneralWorkbenchSidebar
        {...sidebar}
        visible={showGeneralWorkbenchSidebar}
        isThemeWorkbench={isThemeWorkbench}
        enablePanelCollapse={enablePanelCollapse}
        onRequestCollapse={handleGeneralWorkbenchSidebarCollapse}
        workflow={{
          ...sidebar.workflow,
          onDeleteTopic: handleGeneralWorkbenchDeleteTopic,
        }}
      />
    ),
    showGeneralWorkbenchLeftExpandButton,
    onExpandGeneralWorkbenchSidebar: handleExpandGeneralWorkbenchSidebar,
  };
}
