/**
 * 项目列表页面
 *
 * 显示所有项目，支持卡片/列表视图切换和分类过滤
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, LayoutGrid, List, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Project,
  ProjectType,
  ContentListItem,
  listProjects,
  createProject,
  resolveProjectRootPath,
  updateProject,
  deleteProject,
  isUserProjectType,
  getContentStats,
  getCreateProjectErrorMessage,
  extractErrorMessage,
} from "@/lib/api/project";
import { ProjectCard } from "./ProjectCard";
import { NewProjectCard } from "./NewProjectCard";
import { ProjectCategories, ProjectFilter } from "./ProjectCategories";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ContentListPage } from "./ContentListPage";
import { toast } from "sonner";
import { Page, PageParams } from "@/types/page";
import { notifyProjectCreatedWithRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";

interface ProjectsPageProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function ProjectsPage({ onNavigate }: ProjectsPageProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentFilter, setCurrentFilter] = useState<ProjectFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const allProjects = await listProjects();
      // 只显示用户级项目类型的 workspace
      const projectList = allProjects.filter((p) =>
        isUserProjectType(p.workspaceType),
      );

      // 加载每个项目的统计信息
      const projectsWithStats = await Promise.all(
        projectList.map(async (project) => {
          try {
            const [contentCount, totalWords, completedCount] =
              await getContentStats(project.id);
            return {
              ...project,
              stats: {
                content_count: contentCount,
                total_words: totalWords,
                completed_count: completedCount,
              },
            };
          } catch {
            return project;
          }
        }),
      );

      setProjects(projectsWithStats);
    } catch (error) {
      console.error("加载项目失败:", error);
      toast.error("加载项目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 过滤项目
  const filteredProjects = useMemo(() => {
    let result = projects;

    // 按类型过滤
    if (currentFilter === "all") {
      // 默认不显示归档的项目
      result = result.filter((p) => !p.isArchived);
    } else if (currentFilter === "favorites") {
      // 收藏：显示所有收藏的非归档项目
      result = result.filter((p) => p.isFavorite && !p.isArchived);
    } else if (currentFilter === "archived") {
      // 归档：只显示归档的项目
      result = result.filter((p) => p.isArchived);
    } else {
      // 其他情况都是具体的项目类型（UserType）
      result = result.filter(
        (p) => p.workspaceType === currentFilter && !p.isArchived,
      );
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.tags.some((t) => t.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [projects, currentFilter, searchQuery]);

  // 计算各分类数量
  const filterCounts = useMemo(() => {
    const nonArchived = projects.filter((p) => !p.isArchived);
    return {
      all: nonArchived.length,
      general: projects.filter(
        (p) => p.workspaceType === "general" && !p.isArchived,
      ).length,
      "social-media": projects.filter(
        (p) => p.workspaceType === "social-media" && !p.isArchived,
      ).length,
      knowledge: projects.filter(
        (p) => p.workspaceType === "knowledge" && !p.isArchived,
      ).length,
      planning: projects.filter(
        (p) => p.workspaceType === "planning" && !p.isArchived,
      ).length,
      document: projects.filter(
        (p) => p.workspaceType === "document" && !p.isArchived,
      ).length,
      video: projects.filter(
        (p) => p.workspaceType === "video" && !p.isArchived,
      ).length,
      favorites: projects.filter((p) => p.isFavorite && !p.isArchived).length,
      archived: projects.filter((p) => p.isArchived).length,
    };
  }, [projects]);

  // 创建项目
  const handleCreateProject = async (name: string, type: ProjectType) => {
    try {
      const projectPath = await resolveProjectRootPath(name);

      const createdProject = await createProject({
        name,
        rootPath: projectPath,
        workspaceType: type,
      });

      notifyProjectCreatedWithRuntimeAgentsGuide(createdProject, "项目创建成功");
      loadProjects();
    } catch (error) {
      console.error("创建项目失败:", error);
      const errorMessage = extractErrorMessage(error);
      const friendlyMessage = getCreateProjectErrorMessage(errorMessage);
      toast.error(`创建项目失败: ${friendlyMessage}`);
      throw error;
    }
  };

  // 切换收藏
  const handleToggleFavorite = async (project: Project) => {
    try {
      await updateProject(project.id, {
        isFavorite: !project.isFavorite,
      });
      loadProjects();
    } catch (error) {
      console.error("更新收藏状态失败:", error);
      toast.error("操作失败");
    }
  };

  // 切换归档
  const handleToggleArchive = async (project: Project) => {
    try {
      await updateProject(project.id, {
        isArchived: !project.isArchived,
      });
      toast.success(project.isArchived ? "已取消归档" : "已归档");
      loadProjects();
    } catch (error) {
      console.error("更新归档状态失败:", error);
      toast.error("操作失败");
    }
  };

  // 删除项目
  const handleDeleteProject = async (project: Project) => {
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  // 确认删除项目
  const handleConfirmDelete = async (deleteDirectory: boolean) => {
    if (!projectToDelete) return;

    try {
      await deleteProject(projectToDelete.id, deleteDirectory);
      toast.success(deleteDirectory ? "项目和目录已删除" : "项目已删除");
      loadProjects();
    } catch (error) {
      console.error("删除项目失败:", error);
      toast.error("删除失败");
      throw error;
    }
  };

  // 点击项目
  const handleProjectClick = (project: Project) => {
    // 如果提供了 onNavigate，导航到项目详情页
    if (onNavigate) {
      onNavigate("project-detail", { projectId: project.id });
    } else {
      // 否则使用内部状态显示内容列表
      setSelectedProject(project);
    }
  };

  // 点击内容时跳转到创作界面
  const handleContentClick = (content: ContentListItem) => {
    if (selectedProject && onNavigate) {
      onNavigate("agent", {
        projectId: selectedProject.id,
        contentId: content.id,
      });
    }
  };

  // 如果选中了项目，显示内容列表页
  if (selectedProject) {
    return (
      <ContentListPage
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
        onSelectContent={handleContentClick}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">项目</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={loadProjects}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* 搜索和过滤 */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 分类过滤 */}
      <div className="mb-6">
        <ProjectCategories
          currentFilter={currentFilter}
          onFilterChange={setCurrentFilter}
          counts={filterCounts}
        />
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProjects.length === 0 && !searchQuery ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <p className="mb-4">还没有项目</p>
            <Button
              onClick={() => {
                setCreateDialogOpen(true);
              }}
            >
              创建第一个项目
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === "grid"
                ? "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
                : "flex flex-col gap-2",
            )}
          >
            {/* 新建项目卡片 */}
            {(currentFilter as string) !== "archived" && (
              <NewProjectCard
                onClick={() => {
                  setCreateDialogOpen(true);
                }}
              />
            )}

            {/* 项目卡片 */}
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => handleProjectClick(project)}
                onFavorite={() => handleToggleFavorite(project)}
                onArchive={() => handleToggleArchive(project)}
                onDelete={() => handleDeleteProject(project)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 创建项目对话框 */}
      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateProject}
        defaultType={
          // 将当前过滤器转换为项目类型
          // "all", "favorites", "archived" 映射到 "general"
          // 其他过滤器直接对应项目类型
          (["all", "favorites", "archived"].includes(currentFilter)
            ? "general"
            : currentFilter) as ProjectType
        }
      />

      {/* 删除项目对话框 */}
      <DeleteProjectDialog
        project={projectToDelete}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
