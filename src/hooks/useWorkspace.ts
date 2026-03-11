/**
 * @file useWorkspace.ts
 * @description Workspace 管理 Hook，提供 Workspace CRUD 操作
 * @module hooks/useWorkspace
 */

import { useState, useEffect, useCallback } from "react";
import {
  createProject,
  deleteProject,
  ensureWorkspaceReady,
  getDefaultProject,
  getProjectByRootPath,
  listProjects,
  setDefaultProject,
  updateProject,
  type Project as ApiProject,
  type ProjectType,
} from "@/lib/api/project";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import type { WorkspaceSettings } from "@/types/workspace";

export type { WorkspaceSettings } from "@/types/workspace";

/** Workspace 列表项 */
export interface Workspace {
  id: string;
  name: string;
  workspaceType: ProjectType;
  rootPath: string;
  isDefault: boolean;
  settings?: WorkspaceSettings;
  createdAt: number;
  updatedAt: number;
}

/** 创建 Workspace 请求 */
export interface CreateWorkspaceRequest {
  name: string;
  rootPath: string;
  workspaceType?: ProjectType;
}

/** 更新 Workspace 请求 */
export interface UpdateWorkspaceRequest {
  name?: string;
  settings?: WorkspaceSettings;
  rootPath?: string;
}

/** Hook 返回类型 */
export interface UseWorkspaceReturn {
  /** Workspace 列表 */
  workspaces: Workspace[];
  /** 当前默认 Workspace */
  currentWorkspace: Workspace | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 创建 Workspace */
  create: (request: CreateWorkspaceRequest) => Promise<Workspace>;
  /** 更新 Workspace */
  update: (id: string, request: UpdateWorkspaceRequest) => Promise<Workspace>;
  /** 删除 Workspace */
  remove: (id: string) => Promise<boolean>;
  /** 设置默认 Workspace */
  setDefault: (id: string) => Promise<void>;
  /** 通过路径获取 Workspace */
  getByPath: (rootPath: string) => Promise<Workspace | null>;
}

const toWorkspace = (project: ApiProject): Workspace => ({
  id: project.id,
  name: project.name,
  workspaceType: project.workspaceType,
  rootPath: project.rootPath,
  isDefault: project.isDefault,
  settings: project.settings,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});

/**
 * Workspace 管理 Hook
 */
export function useWorkspace(): UseWorkspaceReturn {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 刷新 Workspace 列表 */
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [list, defaultWs] = await Promise.all([
        listProjects(),
        getDefaultProject(),
      ]);

      setWorkspaces(list.map(toWorkspace));
      setCurrentWorkspace(defaultWs ? toWorkspace(defaultWs) : null);

      if (defaultWs?.id) {
        const ensureResult = await ensureWorkspaceReady(defaultWs.id);
        if (ensureResult.repaired) {
          recordWorkspaceRepair({
            workspaceId: ensureResult.workspaceId,
            rootPath: ensureResult.rootPath,
            source: "workspace_refresh",
          });
          console.info(
            "[Workspace] 默认工作区目录缺失，已自动修复:",
            ensureResult.rootPath,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 创建 Workspace */
  const create = useCallback(
    async (request: CreateWorkspaceRequest): Promise<Workspace> => {
      const workspace = await createProject({
        name: request.name,
        rootPath: request.rootPath,
        workspaceType: request.workspaceType,
      });
      await refresh();
      return toWorkspace(workspace);
    },
    [refresh],
  );

  /** 更新 Workspace */
  const update = useCallback(
    async (id: string, request: UpdateWorkspaceRequest): Promise<Workspace> => {
      const workspace = await updateProject(id, request);
      await refresh();
      return toWorkspace(workspace);
    },
    [refresh],
  );

  /** 删除 Workspace */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await deleteProject(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  /** 设置默认 Workspace */
  const setDefault = useCallback(
    async (id: string): Promise<void> => {
      await setDefaultProject(id);
      const ensureResult = await ensureWorkspaceReady(id);
      if (ensureResult.repaired) {
        recordWorkspaceRepair({
          workspaceId: ensureResult.workspaceId,
          rootPath: ensureResult.rootPath,
          source: "workspace_set_default",
        });
        console.info(
          "[Workspace] 切换默认工作区时检测到目录缺失，已自动修复:",
          ensureResult.rootPath,
        );
      }
      await refresh();
    },
    [refresh],
  );

  /** 通过路径获取 Workspace */
  const getByPath = useCallback(
    async (rootPath: string): Promise<Workspace | null> => {
      const workspace = await getProjectByRootPath(rootPath);
      return workspace ? toWorkspace(workspace) : null;
    },
    [],
  );

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    workspaces,
    currentWorkspace,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    setDefault,
    getByPath,
  };
}

export default useWorkspace;
