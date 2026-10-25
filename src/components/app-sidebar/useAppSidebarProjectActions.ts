import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Page, PageParams } from "@/types/page";
import {
  deleteProject,
  ensureProjectWorkspace,
  extractErrorMessage,
  updateProject,
} from "@/lib/api/project";
import { createProjectGitWorktree } from "@/lib/api/projectGit";
import { readLocalEnvironmentSelection } from "@/lib/api/localEnvironmentSelection";
import { worktreeSetupErrorOptions } from "@/components/agent/chat/workspace/worktreeSetupRecovery";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import {
  clearPersistedProjectId,
  closeProjectOpened,
  LAST_PROJECT_ID_KEY,
  markProjectOpened,
} from "@/components/agent/chat/hooks/agentProjectStorage";
import type { SidebarOpenedProjectSummary } from "@/components/app-sidebar/sidebarConversationGroups";

interface UseAppSidebarProjectActionsParams {
  currentProjectId?: string | null;
  onNavigate: (page: Page, params?: PageParams) => void;
  refreshSidebarSessions: () => Promise<void>;
}

function normalizeProjectId(projectId?: string | null): string {
  return projectId?.trim() ?? "";
}

function resolveDirectoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop()?.trim() || path.trim();
}

function resolveProjectName(project: SidebarOpenedProjectSummary): string {
  return project.name.trim() || project.id;
}

export function useAppSidebarProjectActions({
  currentProjectId,
  onNavigate,
  refreshSidebarSessions,
}: UseAppSidebarProjectActionsParams) {
  const { t } = useTranslation("navigation");
  const missingRootPathLabel = t(
    "navigation.sidebar.conversations.projectMenu.noRootPath",
    "当前项目没有可用目录",
  );
  const pinSuccessLabel = t(
    "navigation.sidebar.conversations.projectMenu.pin.success",
    "已置顶项目",
  );
  const unpinSuccessLabel = t(
    "navigation.sidebar.conversations.projectMenu.unpin.success",
    "已取消置顶项目",
  );
  const pinFailedLabel = t(
    "navigation.sidebar.conversations.projectMenu.pin.error",
    "更新项目置顶失败",
  );
  const revealFailedLabel = t(
    "navigation.sidebar.conversations.projectMenu.reveal.error",
    "打开项目位置失败",
  );
  const worktreeCreatedLabel = t(
    "navigation.sidebar.conversations.projectMenu.worktree.success",
    "工作树已创建",
  );
  const worktreeCreateFailedLabel = t(
    "navigation.sidebar.conversations.projectMenu.worktree.error",
    "创建工作树失败",
  );
  const renamePromptLabel = t(
    "navigation.sidebar.conversations.projectMenu.rename.prompt",
    "重命名项目",
  );
  const renameSuccessLabel = t(
    "navigation.sidebar.conversations.projectMenu.rename.success",
    "已重命名项目",
  );
  const renameFailedLabel = t(
    "navigation.sidebar.conversations.projectMenu.rename.error",
    "重命名项目失败",
  );
  const removeConfirmLabel = useCallback(
    (name: string) =>
      t("navigation.sidebar.conversations.projectMenu.remove.confirm", {
        name,
        defaultValue:
          "确定要移除“{{name}}”吗？本地目录不会被删除，后续仍可重新打开。",
      }),
    [t],
  );
  const removeSuccessLabel = t(
    "navigation.sidebar.conversations.projectMenu.remove.success",
    "已移除项目",
  );
  const removeFailedLabel = t(
    "navigation.sidebar.conversations.projectMenu.remove.error",
    "移除项目失败",
  );

  const handleToggleProjectPin = useCallback(
    async (project: SidebarOpenedProjectSummary) => {
      const nextFavorite = !project.isFavorite;
      try {
        await updateProject(project.id, { isFavorite: nextFavorite });
        toast.success(nextFavorite ? pinSuccessLabel : unpinSuccessLabel);
        await refreshSidebarSessions();
      } catch (error) {
        toast.error(`${pinFailedLabel}: ${extractErrorMessage(error)}`);
      }
    },
    [
      pinFailedLabel,
      pinSuccessLabel,
      refreshSidebarSessions,
      unpinSuccessLabel,
    ],
  );

  const handleRevealProject = useCallback(
    async (project: SidebarOpenedProjectSummary) => {
      const rootPath = project.rootPath?.trim();
      if (!rootPath) {
        toast.error(missingRootPathLabel);
        return;
      }

      try {
        await revealPathInFinder(rootPath);
      } catch (error) {
        toast.error(`${revealFailedLabel}: ${extractErrorMessage(error)}`);
      }
    },
    [missingRootPathLabel, revealFailedLabel],
  );

  const handleCreateProjectWorktree = useCallback(
    async (project: SidebarOpenedProjectSummary) => {
      const rootPath = project.rootPath?.trim();
      if (!rootPath) {
        toast.error(missingRootPathLabel);
        return;
      }

      try {
        const localEnvironmentConfigPath =
          await readLocalEnvironmentSelection(rootPath);
        const worktree = await createProjectGitWorktree(rootPath, {
          localEnvironmentConfigPath,
        });
        const nextProject = await ensureProjectWorkspace({
          name:
            resolveDirectoryName(worktree.worktreePath) ||
            resolveProjectName(project),
          rootPath: worktree.worktreePath,
          workspaceType: "general",
        });
        markProjectOpened(nextProject.id);
        toast.success(worktreeCreatedLabel);
        onNavigate("agent", {
          agentEntry: "conversation",
          projectId: nextProject.id,
        });
      } catch (error) {
        toast.error(
          `${worktreeCreateFailedLabel}: ${extractErrorMessage(error)}`,
          worktreeSetupErrorOptions(
            error,
            t("agent:agentChat.navbar.appSwitcher.openWorktree"),
            (projectId) =>
              onNavigate("agent", { agentEntry: "conversation", projectId }),
          ),
        );
      }
    },
    [
      missingRootPathLabel,
      onNavigate,
      worktreeCreateFailedLabel,
      worktreeCreatedLabel,
      t,
    ],
  );

  const handleRenameProject = useCallback(
    async (project: SidebarOpenedProjectSummary) => {
      const currentName = resolveProjectName(project);
      const nextName = window.prompt(renamePromptLabel, currentName)?.trim();
      if (!nextName || nextName === currentName) {
        return;
      }

      try {
        await updateProject(project.id, { name: nextName });
        toast.success(renameSuccessLabel);
        await refreshSidebarSessions();
      } catch (error) {
        toast.error(`${renameFailedLabel}: ${extractErrorMessage(error)}`);
      }
    },
    [
      refreshSidebarSessions,
      renameFailedLabel,
      renamePromptLabel,
      renameSuccessLabel,
    ],
  );

  const handleRemoveProject = useCallback(
    async (project: SidebarOpenedProjectSummary) => {
      const projectId = normalizeProjectId(project.id);
      if (!projectId) {
        return;
      }

      const confirmed = window.confirm(
        removeConfirmLabel(resolveProjectName(project)),
      );
      if (!confirmed) {
        return;
      }

      try {
        await deleteProject(projectId, false);
        closeProjectOpened(projectId);
        toast.success(removeSuccessLabel);
        if (projectId === normalizeProjectId(currentProjectId)) {
          clearPersistedProjectId(LAST_PROJECT_ID_KEY);
          onNavigate("agent", { agentEntry: "new-task" });
          return;
        }
        await refreshSidebarSessions();
      } catch (error) {
        toast.error(`${removeFailedLabel}: ${extractErrorMessage(error)}`);
      }
    },
    [
      currentProjectId,
      onNavigate,
      refreshSidebarSessions,
      removeConfirmLabel,
      removeFailedLabel,
      removeSuccessLabel,
    ],
  );

  return {
    handleCreateProjectWorktree,
    handleRemoveProject,
    handleRenameProject,
    handleRevealProject,
    handleToggleProjectPin,
  };
}
