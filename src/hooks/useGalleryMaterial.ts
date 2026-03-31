/**
 * @file useGalleryMaterial.ts
 * @description 素材库管理 Hook，提供素材元数据的 CRUD 和筛选功能
 * @module hooks/useGalleryMaterial
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  createGalleryMetadata as createGalleryMetadataApi,
  deleteGalleryMetadata as deleteGalleryMetadataApi,
  getGalleryMaterial,
  listGalleryMaterialsByImageCategory,
  listGalleryMaterialsByLayoutCategory,
  listGalleryMaterialsByMood,
  updateGalleryMetadata as updateGalleryMetadataApi,
} from "@/lib/api/galleryMaterials";
import type {
  GalleryMaterial,
  GalleryMaterialMetadata,
  CreateGalleryMetadataRequest,
  GalleryMaterialFilter,
  ImageCategory,
  LayoutCategory,
  ColorMood,
} from "@/types/gallery-material";

/** Hook 返回类型 */
export interface UseGalleryMaterialReturn {
  /** 素材列表 */
  materials: GalleryMaterial[];
  /** 筛选后的素材列表 */
  filteredMaterials: GalleryMaterial[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 当前筛选条件 */
  filter: GalleryMaterialFilter;
  /** 设置筛选条件 */
  setFilter: (filter: GalleryMaterialFilter) => void;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 获取单个素材 */
  get: (materialId: string) => Promise<GalleryMaterial | null>;
  /** 创建素材元数据 */
  createMetadata: (
    request: CreateGalleryMetadataRequest,
  ) => Promise<GalleryMaterialMetadata>;
  /** 更新素材元数据 */
  updateMetadata: (
    materialId: string,
    request: CreateGalleryMetadataRequest,
  ) => Promise<GalleryMaterialMetadata>;
  /** 删除素材元数据 */
  deleteMetadata: (materialId: string) => Promise<void>;
  /** 按图片分类获取素材 */
  listByImageCategory: (category?: ImageCategory) => Promise<GalleryMaterial[]>;
  /** 按布局分类获取素材 */
  listByLayoutCategory: (
    category?: LayoutCategory,
  ) => Promise<GalleryMaterial[]>;
  /** 按配色氛围获取素材 */
  listByMood: (mood?: ColorMood) => Promise<GalleryMaterial[]>;
}

/**
 * 素材库管理 Hook
 *
 * @param projectId - 项目 ID
 * @param initialFilter - 初始筛选条件
 */
export function useGalleryMaterial(
  projectId: string | null,
  initialFilter?: GalleryMaterialFilter,
): UseGalleryMaterialReturn {
  const [materials, setMaterials] = useState<GalleryMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GalleryMaterialFilter>(
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
      let list: GalleryMaterial[] = [];

      if (filter.type === "image") {
        list = await listGalleryMaterialsByImageCategory(
          projectId,
          filter.imageCategory,
        );
      } else if (filter.type === "layout") {
        list = await listGalleryMaterialsByLayoutCategory(
          projectId,
          filter.layoutCategory,
        );
      } else if (filter.type === "color") {
        list = await listGalleryMaterialsByMood(projectId, filter.mood);
      } else {
        // 获取所有素材类型
        const [images, layouts, colors] = await Promise.all([
          listGalleryMaterialsByImageCategory(projectId),
          listGalleryMaterialsByLayoutCategory(projectId),
          listGalleryMaterialsByMood(projectId),
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

  /** 获取单个素材 */
  const get = useCallback(
    async (materialId: string): Promise<GalleryMaterial | null> => {
      try {
        return await getGalleryMaterial(materialId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  /** 创建素材元数据 */
  const createMetadata = useCallback(
    async (
      request: CreateGalleryMetadataRequest,
    ): Promise<GalleryMaterialMetadata> => {
      const metadata = await createGalleryMetadataApi(request);
      await refresh();
      return metadata;
    },
    [refresh],
  );

  /** 更新素材元数据 */
  const updateMetadata = useCallback(
    async (
      materialId: string,
      request: CreateGalleryMetadataRequest,
    ): Promise<GalleryMaterialMetadata> => {
      const metadata = await updateGalleryMetadataApi(materialId, request);
      await refresh();
      return metadata;
    },
    [refresh],
  );

  /** 删除素材元数据 */
  const deleteMetadata = useCallback(
    async (materialId: string): Promise<void> => {
      await deleteGalleryMetadataApi(materialId);
      await refresh();
    },
    [refresh],
  );

  /** 按图片分类获取素材 */
  const listByImageCategory = useCallback(
    async (category?: ImageCategory): Promise<GalleryMaterial[]> => {
      if (!projectId) return [];
      return listGalleryMaterialsByImageCategory(projectId, category);
    },
    [projectId],
  );

  /** 按布局分类获取素材 */
  const listByLayoutCategory = useCallback(
    async (category?: LayoutCategory): Promise<GalleryMaterial[]> => {
      if (!projectId) return [];
      return listGalleryMaterialsByLayoutCategory(projectId, category);
    },
    [projectId],
  );

  /** 按配色氛围获取素材 */
  const listByMood = useCallback(
    async (mood?: ColorMood): Promise<GalleryMaterial[]> => {
      if (!projectId) return [];
      return listGalleryMaterialsByMood(projectId, mood);
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

export default useGalleryMaterial;
