/**
 * @file useProjects.ts
 * @description 项目管理 Hook，提供项目列表获取、创建、更新、删除、筛选功能
 * @module hooks/useProjects
 * @requirements 12.1, 12.2, 12.3, 12.4
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  Project,
  CreateProjectRequest,
  ProjectUpdate,
  ProjectFilter,
} from "@/types/project";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";

interface WorkspaceEnsureResult {
  workspaceId: string;
  rootPath: string;
  existed: boolean;
  created: boolean;
  repaired: boolean;
}
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
        invoke<Project[]>("workspace_list"),
        invoke<Project | null>("workspace_get_default"),
      ]);

      if (defaultProj?.id) {
        const ensureResult = await invoke<WorkspaceEnsureResult>(
          "workspace_ensure_ready",
          { id: defaultProj.id },
        );
        if (ensureResult.created) {
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

      setProjects(list);
      setDefaultProject(defaultProj);
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
      const rootPath = await invoke<string>("workspace_resolve_project_path", {
        name: request.name,
      });

      const project = await invoke<Project>("workspace_create", {
        request: {
          name: request.name,
          rootPath,
          workspaceType: request.workspaceType,
        },
      });
      await refresh();
      return project;
    },
    [refresh],
  );

  /** 更新项目 */
  const update = useCallback(
    async (id: string, updateData: ProjectUpdate): Promise<Project> => {
      const project = await invoke<Project>("workspace_update", {
        id,
        request: updateData,
      });
      await refresh();
      return project;
    },
    [refresh],
  );

  /** 删除项目 */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await invoke<boolean>("workspace_delete", { id });
      await refresh();
      return result;
    },
    [refresh],
  );

  /** 获取或创建默认项目 */
  const getOrCreateDefault = useCallback(async (): Promise<Project> => {
    const project = await invoke<Project>("get_or_create_default_project");
    await refresh();
    return project;
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
