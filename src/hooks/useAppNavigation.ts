import { useCallback, useState } from "react";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type {
  Page,
  PageParams,
  ProjectDetailPageParams,
  ThemeWorkspacePage,
  WorkspaceTheme,
} from "@/types/page";
import {
  getDefaultThemeWorkspacePage,
  getThemeWorkspacePage,
  isThemeWorkspacePage,
  LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY,
} from "@/types/page";

function resolveWorkspacePage(
  workspaceTheme?: WorkspaceTheme,
): ThemeWorkspacePage {
  if (workspaceTheme) {
    return getThemeWorkspacePage(workspaceTheme);
  }

  if (typeof window !== "undefined") {
    const savedPage = localStorage.getItem(LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY);
    if (savedPage && isThemeWorkspacePage(savedPage as Page)) {
      return savedPage as ThemeWorkspacePage;
    }
  }

  return getDefaultThemeWorkspacePage();
}

function persistWorkspacePage(page: ThemeWorkspacePage): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(LAST_THEME_WORKSPACE_PAGE_STORAGE_KEY, page);
}

export interface UseAppNavigationResult {
  currentPage: Page;
  pageParams: PageParams;
  handleNavigate: (page: Page, params?: PageParams) => void;
}

export function useAppNavigation(): UseAppNavigationResult {
  const [currentPage, setCurrentPage] = useState<Page>("agent");
  const [pageParams, setPageParams] = useState<PageParams>(() =>
    buildHomeAgentParams(),
  );

  const handleNavigate = useCallback((page: Page, params?: PageParams) => {
    if (page === "projects") {
      const projectParams = params as
        | {
            projectId?: string;
            workspaceTheme?: WorkspaceTheme;
          }
        | undefined;
      const targetWorkspacePage = resolveWorkspacePage(
        projectParams?.workspaceTheme,
      );

      persistWorkspacePage(targetWorkspacePage);
      setCurrentPage(targetWorkspacePage);
      setPageParams({
        ...(projectParams?.projectId
          ? { projectId: projectParams.projectId }
          : {}),
        workspaceViewMode: "project-management",
      });
      return;
    }

    if (page === "project-detail") {
      const projectParams = params as ProjectDetailPageParams | undefined;
      const targetWorkspacePage = resolveWorkspacePage(
        projectParams?.workspaceTheme,
      );
      const workspaceViewMode = projectParams?.projectId
        ? "workspace"
        : "project-management";

      persistWorkspacePage(targetWorkspacePage);
      setCurrentPage(targetWorkspacePage);
      setPageParams({
        ...(projectParams?.projectId
          ? { projectId: projectParams.projectId }
          : {}),
        workspaceViewMode,
      });
      return;
    }

    if (isThemeWorkspacePage(page)) {
      persistWorkspacePage(page);
    }

    setCurrentPage(page);
    setPageParams(params ? { ...params } : {});
  }, []);

  return {
    currentPage,
    pageParams,
    handleNavigate,
  };
}
