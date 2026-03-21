/**
 * 项目选择器组件
 *
 * 在 EmptyState 中显示项目列表，支持搜索和快速创建
 */

import { useState, useEffect, useMemo } from "react";
import { Search, Plus, FileText, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Project,
  ProjectType,
  createProject,
  getCreateProjectErrorMessage,
  extractErrorMessage,
  listProjects,
  resolveProjectRootPath,
  TYPE_CONFIGS,
} from "@/lib/api/project";
import { toast } from "sonner";
import { CreateProjectDialog } from "@/components/projects/CreateProjectDialog";
import { notifyProjectCreatedWithRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";

interface ProjectSelectorProps {
  /** 当前激活的主题（用于过滤项目） */
  activeTheme?: string;
  /** 选择项目回调 */
  onSelectProject: (projectId: string) => void;
  /** 创建项目回调 */
  onCreateProject?: () => void;
}

export function ProjectSelector({
  activeTheme = "general",
  onSelectProject,
  onCreateProject: _onCreateProject,
}: ProjectSelectorProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // 加载项目列表
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const allProjects = await listProjects();
      setProjects(allProjects);
    } catch (error) {
      console.error("加载项目失败:", error);
      toast.error("加载项目失败");
    } finally {
      setLoading(false);
    }
  };

  // 过滤项目（按主题和搜索关键词）
  const filteredProjects = useMemo(() => {
    let result = projects;

    // 按主题过滤
    if (activeTheme !== "general") {
      result = result.filter((p) => p.workspaceType === activeTheme);
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

    // 排除归档项目
    result = result.filter((p) => !p.isArchived);

    // 按更新时间排序
    result.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    return result;
  }, [projects, activeTheme, searchQuery]);

  const defaultProjectType = useMemo(() => {
    const themeType = activeTheme as ProjectType;
    if (Object.prototype.hasOwnProperty.call(TYPE_CONFIGS, themeType)) {
      return themeType;
    }
    return "general" as ProjectType;
  }, [activeTheme]);

  const handleCreateProject = async (name: string, type: ProjectType) => {
    try {
      const projectPath = await resolveProjectRootPath(name);

      const newProject = await createProject({
        name,
        rootPath: projectPath,
        workspaceType: type,
      });

      notifyProjectCreatedWithRuntimeAgentsGuide(newProject, "项目创建成功");
      await loadProjects();
      onSelectProject(newProject.id);
    } catch (error) {
      console.error("创建项目失败:", error);
      const errorMessage = extractErrorMessage(error);
      const friendlyMessage = getCreateProjectErrorMessage(errorMessage);
      toast.error(`创建项目失败: ${friendlyMessage}`);
      throw error;
    }
  };

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 7) return `${days} 天前`;
    if (days < 30) return `${Math.floor(days / 7)} 周前`;
    return `${Math.floor(days / 30)} 月前`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* 搜索和快速创建 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          新建项目
        </Button>
      </div>

      {/* 项目列表 */}
      <ScrollArea className="h-[400px] rounded-lg border bg-card">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-sm text-muted-foreground">加载中...</div>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <FileText className="h-12 w-12 mb-2 opacity-20" />
            <p className="text-sm mb-4">
              {searchQuery ? "没有找到匹配的项目" : "还没有项目"}
            </p>
            {!searchQuery && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                创建第一个项目
              </Button>
            )}
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={cn(
                  "w-full p-4 rounded-lg border bg-background",
                  "hover:bg-accent hover:border-primary/50",
                  "transition-all duration-200",
                  "text-left",
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">
                        {TYPE_CONFIGS[project.workspaceType].icon}
                      </span>
                      <h3 className="font-medium truncate">{project.name}</h3>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        <span>{project.stats?.content_count || 0} 个内容</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(project.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_CONFIGS[project.workspaceType].label}
                    </Badge>
                    {project.stats?.total_words && (
                      <span className="text-xs text-muted-foreground">
                        {project.stats.total_words.toLocaleString()} 字
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateProject}
        defaultType={defaultProjectType}
        defaultName={`${TYPE_CONFIGS[defaultProjectType].label}项目`}
      />
    </div>
  );
}
