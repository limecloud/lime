/**
 * @file useProjects.ts
 * @description 项目管理 Hook，提供项目列表获取、创建、更新、删除、筛选功能
 * @module hooks/useProjects
 * @requirements 12.1, 12.2, 12.3, 12.4
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  type ProjectType,
} from "@/lib/api/project";
import { toProjectView } from "@/lib/projectView";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
// WorkspaceType 用于类型定义，暂未使用
// import type { WorkspaceType } from '@/types/workspace';

/** Hook 返回类型 */
export interface UseProjectsReturn {
  /** 项目列表 */
  projects: Project[];
  /** 通用对话项目列表 */
  generalProjects: Project[];
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
  /** 重命名项目 */
  rename: (id: string, name: string) => Promise<Project>;
  /** 删除项目 */
  remove: (id: string) => Promise<boolean>;
  /** 获取或创建默认项目 */
  getOrCreateDefault: () => Promise<Project>;
}

interface UseProjectsOptions {
  /** 是否跳过默认项目目录健康检查 */
  skipDefaultWorkspaceReadyCheck?: boolean;
  /** 是否自动在挂载时拉取项目列表 */
  autoLoad?: boolean;
}

const DEV_BRIDGE_RETRY_BASE_DELAY_MS = 1200;
const DEV_BRIDGE_RETRY_MAX_DELAY_MS = 5000;
const DEV_BRIDGE_RETRY_MAX_ATTEMPTS = 4;

function isDevBridgeUnavailableErrorMessage(message: string): boolean {
  return (
    message.includes("[DevBridge] 浏览器模式无法连接后端桥接") ||
    message.includes("Failed to fetch") ||
    message.includes("ERR_CONNECTION_REFUSED")
  );
}

/**
 * 项目管理 Hook
 */
export function useProjects(
  options: UseProjectsOptions = {},
): UseProjectsReturn {
  const { autoLoad = true, skipDefaultWorkspaceReadyCheck = false } = options;
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultProject, setDefaultProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>({});
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const clearRetryTimer = useCallback(() => {
    if (!retryTimerRef.current) {
      return;
    }

    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  /** 刷新项目列表 */
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [list, defaultProj] = await Promise.all([
        listProjects(),
        getDefaultApiProject(),
      ]);

      setProjects(list.map(toProjectView));
      setDefaultProject(defaultProj ? toProjectView(defaultProj) : null);
      clearRetryTimer();
      retryAttemptRef.current = 0;

      if (!skipDefaultWorkspaceReadyCheck && defaultProj?.id) {
        void ensureWorkspaceReady(defaultProj.id)
          .then((ensureResult) => {
            if (!ensureResult.repaired) {
              return;
            }

            recordWorkspaceRepair({
              workspaceId: ensureResult.workspaceId,
              rootPath: ensureResult.rootPath,
              source: "projects_refresh",
            });
            console.info(
              "[Projects] 默认项目目录缺失，已自动修复:",
              ensureResult.rootPath,
            );
          })
          .catch((ensureError) => {
            console.warn("[Projects] 默认项目目录健康检查失败:", ensureError);
          });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [clearRetryTimer, skipDefaultWorkspaceReadyCheck]);

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

  const generalProjects = useMemo(
    () => projects.filter((project) => project.workspaceType === "general"),
    [projects],
  );

  /** 创建项目 */
  const create = useCallback(
    async (request: CreateProjectRequest): Promise<Project> => {
      const rootPath = await resolveProjectRootPath(request.name);

      const project = await createProject({
        name: request.name,
        rootPath,
        workspaceType: request.workspaceType as ProjectType,
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

  /** 重命名项目 */
  const rename = useCallback(
    async (id: string, name: string): Promise<Project> => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("项目名称不能为空");
      }

      const project = await updateProject(id, { name: trimmedName });
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
    if (!autoLoad) {
      return;
    }
    refresh();
  }, [autoLoad, refresh]);

  useEffect(() => {
    if (
      !autoLoad ||
      !error ||
      !isDevBridgeUnavailableErrorMessage(error) ||
      retryAttemptRef.current >= DEV_BRIDGE_RETRY_MAX_ATTEMPTS ||
      retryTimerRef.current
    ) {
      return;
    }

    const delay = Math.min(
      DEV_BRIDGE_RETRY_MAX_DELAY_MS,
      DEV_BRIDGE_RETRY_BASE_DELAY_MS * 2 ** retryAttemptRef.current,
    );
    retryAttemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void refresh();
    }, delay);

    return () => {
      clearRetryTimer();
    };
  }, [autoLoad, clearRetryTimer, error, refresh]);

  useEffect(() => {
    return () => {
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  return {
    projects,
    generalProjects,
    filteredProjects,
    defaultProject,
    loading,
    error,
    filter,
    setFilter,
    refresh,
    create,
    update,
    rename,
    remove,
    getOrCreateDefault,
  };
}

export default useProjects;
