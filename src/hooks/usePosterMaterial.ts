/**
 * @file usePosterMaterial.ts
 * @description 海报素材管理 Hook，提供海报素材的 CRUD 和筛选功能
 * @module hooks/usePosterMaterial
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  createPosterMetadata as createPosterMetadataApi,
  deletePosterMetadata as deletePosterMetadataApi,
  getPosterMaterial,
  listPosterMaterialsByImageCategory,
  listPosterMaterialsByLayoutCategory,
  listPosterMaterialsByMood,
  updatePosterMetadata as updatePosterMetadataApi,
} from "@/lib/api/posterMaterials";
import type {
  PosterMaterial,
  PosterMaterialMetadata,
  CreatePosterMetadataRequest,
  PosterMaterialFilter,
  ImageCategory,
  LayoutCategory,
  ColorMood,
} from "@/types/poster-material";

/** Hook 返回类型 */
export interface UsePosterMaterialReturn {
  /** 海报素材列表 */
  materials: PosterMaterial[];
  /** 筛选后的素材列表 */
  filteredMaterials: PosterMaterial[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前筛选条件 */
  filter: PosterMaterialFilter;
  /** 设置筛选条件 */
  setFilter: (filter: PosterMaterialFilter) => void;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 获取单个海报素材 */
  get: (materialId: string) => Promise<PosterMaterial | null>;
  /** 创建海报素材元数据 */
  createMetadata: (
    request: CreatePosterMetadataRequest,
  ) => Promise<PosterMaterialMetadata>;
  /** 更新海报素材元数据 */
  updateMetadata: (
    materialId: string,
    request: CreatePosterMetadataRequest,
  ) => Promise<PosterMaterialMetadata>;
  /** 删除海报素材元数据 */
  deleteMetadata: (materialId: string) => Promise<void>;
  /** 按图片分类获取素材 */
  listByImageCategory: (category?: ImageCategory) => Promise<PosterMaterial[]>;
  /** 按布局分类获取素材 */
  listByLayoutCategory: (
    category?: LayoutCategory,
  ) => Promise<PosterMaterial[]>;
  /** 按配色氛围获取素材 */
  listByMood: (mood?: ColorMood) => Promise<PosterMaterial[]>;
}

/**
 * 海报素材管理 Hook
 *
 * @param projectId - 项目 ID
 * @param initialFilter - 初始筛选条件
 */
export function usePosterMaterial(
  projectId: string | null,
  initialFilter?: PosterMaterialFilter,
): UsePosterMaterialReturn {
  const [materials, setMaterials] = useState<PosterMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PosterMaterialFilter>(
    initialFilter || {},
  );

  /** 刷新素材列表 */
  const refresh = useCallback(async () => {
    if (!projectId) {
      setMaterials([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 根据筛选条件获取不同类型的素材
      let list: PosterMaterial[] = [];

      if (filter.type === "image") {
        list = await listPosterMaterialsByImageCategory(
          projectId,
          filter.imageCategory,
        );
      } else if (filter.type === "layout") {
        list = await listPosterMaterialsByLayoutCategory(
          projectId,
          filter.layoutCategory,
        );
      } else if (filter.type === "color") {
        list = await listPosterMaterialsByMood(projectId, filter.mood);
      } else {
        // 获取所有海报素材类型
        const [images, layouts, colors] = await Promise.all([
          listPosterMaterialsByImageCategory(projectId),
          listPosterMaterialsByLayoutCategory(projectId),
          listPosterMaterialsByMood(projectId),
        ]);
        list = [...images, ...layouts, ...colors];
      }

      setMaterials(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    projectId,
    filter.type,
    filter.imageCategory,
    filter.layoutCategory,
    filter.mood,
  ]);

  /** 筛选后的素材列表 */
  const filteredMaterials = useMemo(() => {
    let result = materials;

    // 按搜索关键词筛选
    if (filter.query) {
      const query = filter.query.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.description?.toLowerCase().includes(query) ||
          m.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    // 按标签筛选
    if (filter.tags && filter.tags.length > 0) {
      result = result.filter((m) =>
        filter.tags!.some((tag) => m.tags.includes(tag)),
      );
    }

    return result;
  }, [materials, filter.query, filter.tags]);

  /** 获取单个海报素材 */
  const get = useCallback(
    async (materialId: string): Promise<PosterMaterial | null> => {
      try {
        return await getPosterMaterial(materialId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  /** 创建海报素材元数据 */
  const createMetadata = useCallback(
    async (
      request: CreatePosterMetadataRequest,
    ): Promise<PosterMaterialMetadata> => {
      const metadata = await createPosterMetadataApi(request);
      await refresh();
      return metadata;
    },
    [refresh],
  );

  /** 更新海报素材元数据 */
  const updateMetadata = useCallback(
    async (
      materialId: string,
      request: CreatePosterMetadataRequest,
    ): Promise<PosterMaterialMetadata> => {
      const metadata = await updatePosterMetadataApi(materialId, request);
      await refresh();
      return metadata;
    },
    [refresh],
  );

  /** 删除海报素材元数据 */
  const deleteMetadata = useCallback(
    async (materialId: string): Promise<void> => {
      await deletePosterMetadataApi(materialId);
      await refresh();
    },
    [refresh],
  );

  /** 按图片分类获取素材 */
  const listByImageCategory = useCallback(
    async (category?: ImageCategory): Promise<PosterMaterial[]> => {
      if (!projectId) return [];
      return listPosterMaterialsByImageCategory(projectId, category);
    },
    [projectId],
  );

  /** 按布局分类获取素材 */
  const listByLayoutCategory = useCallback(
    async (category?: LayoutCategory): Promise<PosterMaterial[]> => {
      if (!projectId) return [];
      return listPosterMaterialsByLayoutCategory(projectId, category);
    },
    [projectId],
  );

  /** 按配色氛围获取素材 */
  const listByMood = useCallback(
    async (mood?: ColorMood): Promise<PosterMaterial[]> => {
      if (!projectId) return [];
      return listPosterMaterialsByMood(projectId, mood);
    },
    [projectId],
  );

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    materials,
    filteredMaterials,
    loading,
    error,
    filter,
    setFilter,
    refresh,
    get,
    createMetadata,
    updateMetadata,
    deleteMetadata,
    listByImageCategory,
    listByLayoutCategory,
    listByMood,
  };
}

export default usePosterMaterial;
