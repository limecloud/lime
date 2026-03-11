/**
 * @file useBrandPersona.ts
 * @description 品牌人设管理 Hook，提供品牌人设扩展的 CRUD 操作
 * @module hooks/useBrandPersona
 */

import { useState, useEffect, useCallback } from "react";
import {
  deleteBrandExtension,
  getBrandExtension,
  getBrandPersona,
  listBrandPersonaTemplates,
  saveBrandExtension,
  updateBrandExtension,
} from "@/lib/api/brandPersona";
import type {
  BrandPersona,
  BrandPersonaExtension,
  BrandPersonaTemplate,
  CreateBrandExtensionRequest,
  UpdateBrandExtensionRequest,
} from "@/types/brand-persona";

/** Hook 返回类型 */
export interface UseBrandPersonaReturn {
  /** 品牌人设（完整视图） */
  brandPersona: BrandPersona | null;
  /** 品牌人设扩展 */
  extension: BrandPersonaExtension | null;
  /** 品牌人设模板列表 */
  templates: BrandPersonaTemplate[];
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新数据 */
  refresh: () => Promise<void>;
  /** 保存品牌扩展 */
  save: (req: CreateBrandExtensionRequest) => Promise<BrandPersonaExtension>;
  /** 更新品牌扩展 */
  update: (
    update: UpdateBrandExtensionRequest,
  ) => Promise<BrandPersonaExtension>;
  /** 删除品牌扩展 */
  remove: () => Promise<void>;
  /** 加载模板列表 */
  loadTemplates: () => Promise<void>;
  /** 应用模板 */
  applyTemplate: (
    template: BrandPersonaTemplate,
  ) => Promise<BrandPersonaExtension>;
}

/**
 * 品牌人设管理 Hook
 *
 * @param personaId - 人设 ID
 */
export function useBrandPersona(
  personaId: string | null,
): UseBrandPersonaReturn {
  const [brandPersona, setBrandPersona] = useState<BrandPersona | null>(null);
  const [extension, setExtension] = useState<BrandPersonaExtension | null>(
    null,
  );
  const [templates, setTemplates] = useState<BrandPersonaTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 刷新品牌人设数据 */
  const refresh = useCallback(async () => {
    if (!personaId) {
      setBrandPersona(null);
      setExtension(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [brandPersonaData, extensionData] = await Promise.all([
        getBrandPersona(personaId),
        getBrandExtension(personaId),
      ]);

      setBrandPersona(brandPersonaData);
      setExtension(extensionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  /** 保存品牌扩展 */
  const save = useCallback(
    async (
      req: CreateBrandExtensionRequest,
    ): Promise<BrandPersonaExtension> => {
      const result = await saveBrandExtension(req);
      await refresh();
      return result;
    },
    [refresh],
  );

  /** 更新品牌扩展 */
  const update = useCallback(
    async (
      updateData: UpdateBrandExtensionRequest,
    ): Promise<BrandPersonaExtension> => {
      if (!personaId) {
        throw new Error("人设 ID 不能为空");
      }
      const result = await updateBrandExtension(personaId, updateData);
      await refresh();
      return result;
    },
    [personaId, refresh],
  );

  /** 删除品牌扩展 */
  const remove = useCallback(async (): Promise<void> => {
    if (!personaId) {
      throw new Error("人设 ID 不能为空");
    }
    await deleteBrandExtension(personaId);
    await refresh();
  }, [personaId, refresh]);

  /** 加载模板列表 */
  const loadTemplates = useCallback(async () => {
    try {
      const list = await listBrandPersonaTemplates();
      setTemplates(list);
    } catch (err) {
      console.error("加载品牌人设模板失败:", err);
    }
  }, []);

  /** 应用模板 */
  const applyTemplate = useCallback(
    async (template: BrandPersonaTemplate): Promise<BrandPersonaExtension> => {
      if (!personaId) {
        throw new Error("人设 ID 不能为空");
      }

      const req: CreateBrandExtensionRequest = {
        personaId,
        brandTone: template.brandTone,
        design: template.design,
        visual: template.visual,
      };

      return save(req);
    },
    [personaId, save],
  );

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    brandPersona,
    extension,
    templates,
    loading,
    error,
    refresh,
    save,
    update,
    remove,
    loadTemplates,
    applyTemplate,
  };
}

export default useBrandPersona;
