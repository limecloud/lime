import type { Project as ApiProject, ProjectType } from "@/lib/api/project";
import type { Project } from "@/types/project";

export function toProjectView(project: ApiProject): Project {
  return {
    id: project.id,
    name: project.name,
    workspaceType: project.workspaceType as ProjectType,
    rootPath: project.rootPath,
    isDefault: project.isDefault,
    settings: project.settings,
    icon: project.icon,
    color: project.color,
    isFavorite: project.isFavorite,
    isArchived: project.isArchived,
    tags: project.tags,
    defaultPersonaId: project.defaultPersonaId,
    stats: project.stats
      ? {
          contentCount: project.stats.content_count,
          totalWords: project.stats.total_words,
          completedCount: project.stats.completed_count,
          lastAccessed: project.stats.last_accessed,
        }
      : undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
