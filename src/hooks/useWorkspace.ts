/**
 * @file useWorkspace.ts
 * @description Workspace 管理 Hook，提供 Workspace CRUD 操作
 * @module hooks/useWorkspace
 */

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectType } from "@/lib/api/project";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";

/** Workspace 列表项 */
export interface Workspace {
  id: string;
  name: string;
  workspaceType: ProjectType;
  rootPath: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Workspace 设置 */
export interface WorkspaceSettings {
  mcpConfig?: Record<string, unknown>;
  defaultProvider?: string;
  autoCompact?: boolean;
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

interface WorkspaceEnsureResult {
  workspaceId: string;
  rootPath: string;
  existed: boolean;
  created: boolean;
  repaired: boolean;
}

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
        invoke<Workspace[]>("workspace_list"),
        invoke<Workspace | null>("workspace_get_default"),
      ]);

      setWorkspaces(list);
      setCurrentWorkspace(defaultWs);

      if (defaultWs?.id) {
        const ensureResult = await invoke<WorkspaceEnsureResult>(
          "workspace_ensure_ready",
          { id: defaultWs.id },
        );
        if (ensureResult.created) {
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
      const workspace = await invoke<Workspace>("workspace_create", {
        request,
      });
      await refresh();
      return workspace;
    },
    [refresh],
  );

  /** 更新 Workspace */
  const update = useCallback(
    async (id: string, request: UpdateWorkspaceRequest): Promise<Workspace> => {
      const workspace = await invoke<Workspace>("workspace_update", {
        id,
        request,
      });
      await refresh();
      return workspace;
    },
    [refresh],
  );

  /** 删除 Workspace */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await invoke<boolean>("workspace_delete", { id });
      await refresh();
      return result;
    },
    [refresh],
  );

  /** 设置默认 Workspace */
  const setDefault = useCallback(
    async (id: string): Promise<void> => {
      await invoke("workspace_set_default", { id });
      const ensureResult = await invoke<WorkspaceEnsureResult>(
        "workspace_ensure_ready",
        { id },
      );
      if (ensureResult.created) {
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
      return invoke<Workspace | null>("workspace_get_by_path", { rootPath });
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
