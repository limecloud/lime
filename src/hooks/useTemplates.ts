/**
 * @file useTemplates.ts
 * @description 模板管理 Hook，提供模板列表获取、创建、更新、删除、设置默认功能
 * @module hooks/useTemplates
 * @requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { useState, useEffect, useCallback } from "react";
import {
  createTemplate,
  deleteTemplate,
  getDefaultTemplate,
  listTemplates,
  setDefaultTemplate as setDefaultTemplateApi,
  updateTemplate,
} from "@/lib/api/templates";
import type {
  Template,
  CreateTemplateRequest,
  TemplateUpdate,
} from "@/types/template";

/** Hook 返回类型 */
export interface UseTemplatesReturn {
  /** 模板列表 */
  templates: Template[];
  /** 默认模板 */
  defaultTemplate: Template | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 刷新列表 */
  refresh: () => Promise<void>;
  /** 创建模板 */
  create: (request: CreateTemplateRequest) => Promise<Template>;
  /** 更新模板 */
  update: (id: string, update: TemplateUpdate) => Promise<Template>;
  /** 删除模板 */
  remove: (id: string) => Promise<void>;
  /** 设置默认模板 */
  setDefault: (templateId: string) => Promise<void>;
}

/**
 * 模板管理 Hook
 *
 * @param projectId - 项目 ID
 */
export function useTemplates(projectId: string | null): UseTemplatesReturn {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [defaultTemplate, setDefaultTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 刷新模板列表 */
  const refresh = useCallback(async () => {
    if (!projectId) {
      setTemplates([]);
      setDefaultTemplate(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [list, defaultT] = await Promise.all([
        listTemplates(projectId),
        getDefaultTemplate(projectId),
      ]);

      setTemplates(list);
      setDefaultTemplate(defaultT);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** 创建模板 */
  const create = useCallback(
    async (request: CreateTemplateRequest): Promise<Template> => {
      const template = await createTemplate(request);
      await refresh();
      return template;
    },
    [refresh],
  );

  /** 更新模板 */
  const update = useCallback(
    async (id: string, updateData: TemplateUpdate): Promise<Template> => {
      const template = await updateTemplate(id, updateData);
      await refresh();
      return template;
    },
    [refresh],
  );

  /** 删除模板 */
  const remove = useCallback(
    async (id: string): Promise<void> => {
      await deleteTemplate(id);
      await refresh();
    },
    [refresh],
  );

  /** 设置默认模板 */
  const setDefault = useCallback(
    async (templateId: string): Promise<void> => {
      if (!projectId) return;
      await setDefaultTemplateApi(projectId, templateId);
      await refresh();
    },
    [projectId, refresh],
  );

  // 初始加载
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    templates,
    defaultTemplate,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
    setDefault,
  };
}

export default useTemplates;
