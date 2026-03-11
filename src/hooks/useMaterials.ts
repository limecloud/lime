/**
 * @file useMaterials.ts
 * @description 素材管理 Hook，提供素材列表获取、上传、更新、删除、预览功能
 * @module hooks/useMaterials
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  deleteMaterial,
  getMaterialContent,
  getMaterialCount,
  listMaterials,
  updateMaterial,
  uploadMaterial,
} from "@/lib/api/materials";
import type {
  Material,
  UploadMaterialRequest,
  MaterialUpdate,
  MaterialFilter,
} from "@/types/material";

/** Hook 返回类型 */
export interface UseMaterialsReturn {
  /** 素材列表 */
  materials: Material[];
  /** 筛选后的素材列表 */
  filteredMaterials: Material[];
  /** 素材数量 */
  count: number;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前筛选条件 */
  filter: MaterialFilter;
  /** 设置筛选条件 */
  setFilter: (filter: MaterialFilter) => void;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 上传素材 */
  upload: (request: UploadMaterialRequest) => Promise<Material>;
  /** 更新素材 */
  update: (id: string, update: MaterialUpdate) => Promise<Material>;
  /** 删除素材 */
  remove: (id: string) => Promise<void>;
  /** 获取素材内容 */
  getContent: (id: string) => Promise<string>;
}

/**
 * 素材管理 Hook
 *
 * @param projectId - 项目 ID
 */
export function useMaterials(projectId: string | null): UseMaterialsReturn {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MaterialFilter>({});

  /** 刷新素材列表 */
  const refresh = useCallback(async () => {
    if (!projectId) {
      setMaterials([]);
      setCount(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [list, total] = await Promise.all([
        listMaterials(projectId),
        getMaterialCount(projectId),
      ]);

      setMaterials(list);
      setCount(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** 筛选后的素材列表 */
  const filteredMaterials = useMemo(() => {
    let result = materials;

    // 按类型筛选
    if (filter.type) {
      result = result.filter((m) => m.type === filter.type);
    }

    // 按标签筛选
    if (filter.tags && filter.tags.length > 0) {
      result = result.filter((m) =>
        filter.tags!.some((tag) => m.tags.includes(tag)),
      );
    }

    // 按搜索关键词筛选
    if (filter.searchQuery) {
      const query = filter.searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query) ||
          m.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [materials, filter]);

  /** 上传素材 */
  const upload = useCallback(
    async (request: UploadMaterialRequest): Promise<Material> => {
      const material = await uploadMaterial(request);
      await refresh();
      return material;
    },
    [refresh],
  );

  /** 更新素材 */
  const update = useCallback(
    async (id: string, updateData: MaterialUpdate): Promise<Material> => {
      const material = await updateMaterial(id, updateData);
      await refresh();
      return material;
    },
    [refresh],
  );

  /** 删除素材 */
  const remove = useCallback(
    async (id: string): Promise<void> => {
      await deleteMaterial(id);
      await refresh();
    },
    [refresh],
  );

  /** 获取素材内容 */
  const getContent = useCallback(async (id: string): Promise<string> => {
    return getMaterialContent(id);
  }, []);

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    materials,
    filteredMaterials,
    count,
    loading,
    error,
    filter,
    setFilter,
    refresh,
    upload,
    update,
    remove,
    getContent,
  };
}

export default useMaterials;
