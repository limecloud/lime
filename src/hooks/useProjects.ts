/**
 * @file useProjects.ts
 * @description 项目管理 Hook，提供项目列表获取、创建、更新、删除、筛选功能
 * @module hooks/useProjects
 * @requirements 12.1, 12.2, 12.3, 12.4
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  Project,
  CreateProjectRequest,
  ProjectUpdate,
  ProjectFilter,
} from "@/types/project";
import {
  createProject,
  deleteProject,
  ensureWorkspaceReady,
  getDefaultProject as getDefaultApiProject,
  getOrCreateDefaultProject,
  listProjects,
  resolveProjectRootPath,
  updateProject,
} from "@/lib/api/project";
import { toProjectView } from "@/lib/projectView";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
// WorkspaceType 用于类型定义，暂未使用
// import type { WorkspaceType } from '@/types/workspace';

/** Hook 返回类型 */
export interface UseProjectsReturn {
  /** 项目列表 */
  projects: Project[];
  /** 筛选后的项目列表 */
  filteredProjects: Project[];
  /** 默认项目 */
  defaultProject: Project | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前筛选条件 */
  filter: ProjectFilter;
  /** 设置筛选条件 */
  setFilter: (filter: ProjectFilter) => void;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 创建项目 */
  create: (request: CreateProjectRequest) => Promise<Project>;
  /** 更新项目 */
  update: (id: string, update: ProjectUpdate) => Promise<Project>;
  /** 删除项目 */
  remove: (id: string) => Promise<boolean>;
  /** 获取或创建默认项目 */
  getOrCreateDefault: () => Promise<Project>;
}

/**
 * 项目管理 Hook
 */
export function useProjects(): UseProjectsReturn {
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultProject, setDefaultProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>({});

  /** 刷新项目列表 */
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [list, defaultProj] = await Promise.all([
        listProjects(),
        getDefaultApiProject(),
      ]);

      if (defaultProj?.id) {
        const ensureResult = await ensureWorkspaceReady(defaultProj.id);
        if (ensureResult.repaired) {
          recordWorkspaceRepair({
            workspaceId: ensureResult.workspaceId,
            rootPath: ensureResult.rootPath,
            source: "projects_refresh",
          });
          console.info(
            "[Projects] 默认项目目录缺失，已自动修复:",
            ensureResult.rootPath,
          );
        }
      }

      setProjects(list.map(toProjectView));
      setDefaultProject(defaultProj ? toProjectView(defaultProj) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 筛选后的项目列表 */
  const filteredProjects = useMemo(() => {
    let result = projects;

    // 按 workspaceType 筛选
    if (filter.workspaceType) {
      result = result.filter((p) => p.workspaceType === filter.workspaceType);
    }

    // 按归档状态筛选
    if (filter.isArchived !== undefined) {
      result = result.filter((p) => p.isArchived === filter.isArchived);
    }

    // 按收藏状态筛选
    if (filter.isFavorite !== undefined) {
      result = result.filter((p) => p.isFavorite === filter.isFavorite);
    }

    // 按搜索关键词筛选
    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [projects, filter]);

  /** 创建项目 */
  const create = useCallback(
    async (request: CreateProjectRequest): Promise<Project> => {
      const rootPath = await resolveProjectRootPath(request.name);

      const project = await createProject({
        name: request.name,
        rootPath,
        workspaceType: request.workspaceType,
      });
      await refresh();
      return toProjectView(project);
    },
    [refresh],
  );

  /** 更新项目 */
  const update = useCallback(
    async (id: string, updateData: ProjectUpdate): Promise<Project> => {
      const project = await updateProject(id, updateData);
      await refresh();
      return toProjectView(project);
    },
    [refresh],
  );

  /** 删除项目 */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await deleteProject(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  /** 获取或创建默认项目 */
  const getOrCreateDefault = useCallback(async (): Promise<Project> => {
    const project = await getOrCreateDefaultProject();
    await refresh();
    return toProjectView(project);
  }, [refresh]);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    projects,
    filteredProjects,
    defaultProject,
    loading,
    error,
    filter,
    setFilter,
    refresh,
    create,
    update,
    remove,
    getOrCreateDefault,
  };
}

export default useProjects;
