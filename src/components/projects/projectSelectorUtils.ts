import type { Project } from "@/types/project";

/**
 * 计算可选项目列表
 *
 * 规则：
 * 1. 始终排除归档项目
 * 2. 提供 workspaceType 时仅显示该类型项目 + 默认项目
 * 3. 默认项目固定置顶
 */
export function getAvailableProjects(
  projects: Project[],
  workspaceType?: string,
): Project[] {
  // 防御性编程：确保 projects 是数组
  const safeProjects = Array.isArray(projects) ? projects : [];
  let filtered = safeProjects.filter((project) => !project.isArchived);

  if (workspaceType) {
    filtered = filtered.filter(
      (project) => project.isDefault || project.workspaceType === workspaceType,
    );
  }

  return [...filtered].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function canRenameProject(project: Project | null | undefined): boolean {
  return Boolean(project && !project.isDefault);
}

export function canDeleteProject(project: Project | null | undefined): boolean {
  return Boolean(project && !project.isDefault);
}

export function resolveProjectDeletionFallback(
  projects: Project[],
  defaultProject: Project | null,
  deletedProjectId?: string | null,
): string | null {
  if (defaultProject && defaultProject.id !== deletedProjectId) {
    return defaultProject.id;
  }

  const nextProject = projects.find(
    (project) => project.id !== deletedProjectId,
  );
  return nextProject?.id || null;
}

export function resolveSelectedProject(
  projects: Project[],
  selectedProjectId: string | null | undefined,
  defaultProject: Project | null,
): Project | null {
  if (selectedProjectId) {
    const matchedProject = projects.find(
      (project) => project.id === selectedProjectId,
    );
    if (matchedProject) {
      return matchedProject;
    }
  }

  if (defaultProject) {
    const matchedDefault = projects.find(
      (project) => project.id === defaultProject.id,
    );
    if (matchedDefault) {
      return matchedDefault;
    }
  }

  if (!selectedProjectId) {
    return null;
  }

  return projects[0] || null;
}
