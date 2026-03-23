import { useCallback, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { updateProject as updateProjectById } from "@/lib/api/project";
import { notifyProjectRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import type { WorkspacePathMissingState } from "../hooks/agentChatShared";

interface UseWorkspaceNavigationActionsParams {
  applyProjectSelection: (projectId: string) => void;
  compactSession: () => Promise<void>;
  dismissWorkspacePathError: () => void;
  fixWorkspacePathAndRetry: (newPath: string) => Promise<void>;
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  setEntryBannerVisible: Dispatch<SetStateAction<boolean>>;
  setWorkspaceHealthError: Dispatch<SetStateAction<boolean>>;
  workspacePathMissing: WorkspacePathMissingState | boolean | null;
}

export function useWorkspaceNavigationActions({
  applyProjectSelection,
  compactSession,
  dismissWorkspacePathError,
  fixWorkspacePathAndRetry,
  onNavigate,
  projectId,
  setEntryBannerVisible,
  setWorkspaceHealthError,
  workspacePathMissing,
}: UseWorkspaceNavigationActionsParams) {
  const handleManageProviders = useCallback(() => {
    onNavigate?.("settings", {
      tab: SettingsTabs.Providers,
    });
  }, [onNavigate]);

  const handleBackToResources = useCallback(() => {
    onNavigate?.("resources");
  }, [onNavigate]);

  const handleProjectChange = useCallback(
    (newProjectId: string) => {
      applyProjectSelection(newProjectId);
    },
    [applyProjectSelection],
  );

  const handleSelectWorkspaceDirectory = useCallback(async () => {
    const newPath = await openDialog({ directory: true, multiple: false });
    if (!newPath) {
      return;
    }

    if (workspacePathMissing) {
      await fixWorkspacePathAndRetry(newPath);
      return;
    }

    if (!projectId) {
      return;
    }

    try {
      await updateProjectById(projectId, { rootPath: newPath });
      setWorkspaceHealthError(false);
      notifyProjectRuntimeAgentsGuide(
        {
          id: projectId,
          rootPath: newPath,
        },
        {
          successMessage: "工作区目录已更新",
        },
      );
    } catch (error) {
      toast.error(
        `更新路径失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [
    fixWorkspacePathAndRetry,
    projectId,
    setWorkspaceHealthError,
    workspacePathMissing,
  ]);

  const handleOpenAppearanceSettings = useCallback(() => {
    onNavigate?.("settings", {
      tab: SettingsTabs.Appearance,
    });
  }, [onNavigate]);

  const handleCompactContext = useCallback(() => {
    void compactSession();
  }, [compactSession]);

  const handleDismissEntryBanner = useCallback(() => {
    setEntryBannerVisible(false);
  }, [setEntryBannerVisible]);

  const handleWorkspaceAlertSelectDirectory = useCallback(() => {
    void handleSelectWorkspaceDirectory();
  }, [handleSelectWorkspaceDirectory]);

  const handleDismissWorkspaceAlert = useCallback(() => {
    setWorkspaceHealthError(false);
    dismissWorkspacePathError();
  }, [dismissWorkspacePathError, setWorkspaceHealthError]);

  return {
    handleBackToResources,
    handleCompactContext,
    handleDismissEntryBanner,
    handleDismissWorkspaceAlert,
    handleManageProviders,
    handleOpenAppearanceSettings,
    handleProjectChange,
    handleWorkspaceAlertSelectDirectory,
  };
}
