/**
 * @file useProject.ts
 * @description 单个项目管理 Hook，提供项目获取、更新功能
 * @module hooks/useProject
 * @requirements 5.1, 11.1, 11.4, 11.5
 */

import { useState, useEffect, useCallback } from "react";
import {
  getProject as getApiProject,
  updateProject as updateApiProject,
} from "@/lib/api/project";
import { toProjectView } from "@/lib/projectView";
import type { Project, ProjectUpdate } from "@/types/project";

/** Hook 返回类型 */
export interface UseProjectReturn {
  /** 项目数据 */
  project: Project | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新项目 */
  refresh: () => Promise<void>;
  /** 更新项目 */
  update: (updateData: ProjectUpdate) => Promise<Project>;
  /** 归档项目 */
  archive: () => Promise<void>;
  /** 取消归档 */
  unarchive: () => Promise<void>;
  /** 切换收藏状态 */
  toggleFavorite: () => Promise<void>;
}

/**
 * 单个项目管理 Hook
 *
 * @param projectId - 项目 ID
 */
export function useProject(projectId: string | null): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 刷新项目 */
  const refresh = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const result = await getApiProject(projectId);
      setProject(result ? toProjectView(result) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** 更新项目 */
  const update = useCallback(
    async (updateData: ProjectUpdate): Promise<Project> => {
      if (!projectId) {
        throw new Error("项目 ID 不能为空");
      }

      const result = await updateApiProject(projectId, updateData);
      const nextProject = toProjectView(result);
      setProject(nextProject);
      return nextProject;
    },
    [projectId],
  );

  /** 归档项目 */
  const archive = useCallback(async () => {
    if (!projectId) return;
    await update({ isArchived: true });
  }, [projectId, update]);

  /** 取消归档 */
  const unarchive = useCallback(async () => {
    if (!projectId) return;
    await update({ isArchived: false });
  }, [projectId, update]);

  /** 切换收藏状态 */
  const toggleFavorite = useCallback(async () => {
    if (!projectId || !project) return;
    await update({ isFavorite: !project.isFavorite });
  }, [projectId, project, update]);

  // 初始加载和 projectId 变化时刷新
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    project,
    loading,
    error,
    refresh,
    update,
    archive,
    unarchive,
    toggleFavorite,
  };
}

export default useProject;
